package io.github.t1mothys.orbit

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.URL
import java.security.KeyStore
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection

class TodayWidget : AppWidgetProvider() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == refreshAction || intent.action == AppWidgetManager.ACTION_APPWIDGET_UPDATE) {
            render(context)
            val pending = goAsync()
            refresh(context) { pending.finish() }
        } else super.onReceive(context, intent)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        render(context)
    }

    override fun onDisabled(context: Context) = clear(context)

    companion object {
        private const val refreshAction = "io.github.t1mothys.orbit.REFRESH_TODAY_WIDGET"
        const val openAction = "io.github.t1mothys.orbit.OPEN_TODAY_WIDGET"
        private const val keyName = "orbit-today-widget-v1"
        private const val staleMs = 45 * 60 * 1000L
        private val rows = intArrayOf(R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3, R.id.widget_task_4)
        private val worker = Executors.newSingleThreadExecutor()
        private val syncing = AtomicBoolean()
        private fun prefs(context: Context) = context.getSharedPreferences("orbit_today_widget", Context.MODE_PRIVATE)
        private fun ids(context: Context) = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
        private fun scope(context: Context, account: String) = ServerEnvironment.current(context).id + ":" + account
        private fun key(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(keyName, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(keyName, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        }

        @Synchronized
        fun observeAccount(context: Context, account: String?) {
            val stored = prefs(context).getString("scope", null)
            if (stored != null && stored != account?.let { scope(context, it) }) clear(context)
        }

        @Synchronized
        fun clear(context: Context) {
            prefs(context).edit().clear().apply()
            render(context)
        }

        fun status(context: Context, account: String): JSONObject {
            observeAccount(context, account)
            return JSONObject().put("installed", ids(context).isNotEmpty())
                .put("expiresAt", prefs(context).getLong("expiresAt", 0))
        }

        @Synchronized
        fun access(context: Context, account: String, credential: String, expiresAt: Long) {
            val now = System.currentTimeMillis()
            require(account.isNotBlank() && account.length <= 200 && credential.length in 32..2048 && expiresAt in (now + 1)..(now + 86_460_000)) {
                "小组件凭据已过期或无效"
            }
            if (ids(context).isEmpty()) return
            observeAccount(context, account)
            val scope = scope(context, account)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, key())
                updateAAD(scope.toByteArray())
            }
            prefs(context).edit().putString("scope", scope).putLong("expiresAt", expiresAt)
                .putString("credential", Base64.encodeToString(cipher.iv + cipher.doFinal(credential.toByteArray()), Base64.NO_WRAP)).apply()
            refresh(context)
        }

        fun refresh(context: Context, done: () -> Unit = {}) {
            if (ids(context).isEmpty() || !syncing.compareAndSet(false, true)) {
                done()
                return
            }
            val app = context.applicationContext
            worker.execute {
                try { fetch(app) }
                catch (_: Exception) { /* A failed request keeps the last valid snapshot. */ }
                finally {
                    syncing.set(false)
                    try { render(app) } finally { done() }
                }
            }
        }

        private fun fetch(context: Context) {
            val store = prefs(context)
            val preset = ServerEnvironment.current(context)
            val scope = store.getString("scope", null) ?: return
            if (!scope.startsWith(preset.id + ":")) return
            val encrypted = store.getString("credential", null) ?: return
            if (System.currentTimeMillis() >= store.getLong("expiresAt", 0)) return
            val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
            val credential = try {
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                    updateAAD(scope.toByteArray())
                    doFinal(bytes.copyOfRange(12, bytes.size)).decodeToString()
                }
            } catch (_: Exception) {
                synchronized(this) {
                    if (store.getString("credential", null) == encrypted) clear(context)
                }
                return
            }
            val connection = URL(ServerEnvironment.origin(preset) + "/api/action-center/widget").openConnection() as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 3500
                connection.readTimeout = 3500
                connection.setRequestProperty("Authorization", "OrbitWidget $credential")
                val status = connection.responseCode
                val snapshot = if (status == 200) {
                    val body = connection.inputStream.bufferedReader().use { reader ->
                        val buffer = CharArray(32769)
                        var length = 0
                        while (length < buffer.size) {
                            val read = reader.read(buffer, length, buffer.size - length)
                            if (read < 0) break
                            length += read
                        }
                        if (length >= buffer.size) return
                        String(buffer, 0, length)
                    }
                    JSONObject(body).takeIf { it.optJSONArray("items") != null && it.optLong("validUntil") > System.currentTimeMillis() }
                } else null
                synchronized(this) {
                    if (store.getString("credential", null) != encrypted || ServerEnvironment.current(context) != preset) return
                    if (status == 401 || status == 403) clear(context)
                    else if (snapshot != null) store.edit().putString("snapshot", snapshot.toString()).apply()
                }
            } finally { connection.disconnect() }
        }

        private fun snapshot(context: Context): JSONObject? {
            val store = prefs(context)
            if (store.getString("scope", null)?.startsWith(ServerEnvironment.current(context).id + ":") != true) return null
            return try { JSONObject(store.getString("snapshot", "") ?: "") } catch (_: Exception) { null }
        }

        fun target(context: Context, intent: Intent): String {
            val snap = snapshot(context) ?: return "/today"
            if (snap.optLong("validUntil") <= System.currentTimeMillis() ||
                snap.optLong("generatedAt") != intent.getLongExtra("widgetSnapshot", 0)) return "/today"
            val index = intent.getIntExtra("widgetRow", -1)
            val path = snap.optJSONArray("items")?.optJSONObject(index)?.optString("path").orEmpty()
            val url = Uri.parse(path)
            return if (path.startsWith('/') && !path.startsWith("//") && url.path in setOf("/schedule", "/reminders") &&
                url.scheme == null && url.authority == null && !path.contains('\\')) path else "/today"
        }

        private fun open(context: Context, id: Int, row: Int, timestamp: Long): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).setAction(openAction)
                .setData(Uri.parse("orbit-widget://today/$id/$row"))
                .putExtra("widgetRow", row).putExtra("widgetSnapshot", timestamp)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun render(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val now = System.currentTimeMillis()
            val snapshot = snapshot(context)
            val generated = snapshot?.optLong("generatedAt") ?: 0
            val current = snapshot?.takeIf { it.optLong("validUntil") > now }
            val installed = ids(context)
            for (id in installed) {
                val views = RemoteViews(context.packageName, R.layout.today_widget)
                val height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 120)
                val limit = when { height >= 240 -> 4; height >= 190 -> 3; height >= 145 -> 2; else -> 1 }
                views.setTextViewText(R.id.widget_count, if (current == null) "打开 Orbit 同步" else "今日待办  ${current.optInt("remaining")} 项未完成")
                views.setTextViewText(R.id.widget_time, when {
                    generated == 0L -> "等待首次同步"
                    current == null -> "上次同步 ${snapshot?.optString("date")} · 已过期"
                    else -> "更新 ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(generated))}" +
                        if (now - generated > staleMs) " · 可能过期" else ""
                })
                val items = current?.optJSONArray("items")
                rows.forEachIndexed { index, view ->
                    val item = if (index < limit) items?.optJSONObject(index) else null
                    views.setViewVisibility(view, if (item == null) View.GONE else View.VISIBLE)
                    if (item != null) {
                        val time = item.optString("time")
                        val label = if (item.optBoolean("completed")) listOf(time, "已完成").filter { it.isNotBlank() }.joinToString(" · ") else time.ifBlank { "待办" }
                        views.setTextViewText(view, "$label  ${item.optString("title")}")
                        views.setOnClickPendingIntent(view, open(context, id, index, generated))
                    }
                }
                views.setOnClickPendingIntent(R.id.widget_open, open(context, id, -1, generated))
                val refresh = Intent(context, TodayWidget::class.java).setAction(refreshAction)
                views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, 0, refresh, PendingIntent.FLAG_IMMUTABLE))
                manager.updateAppWidget(id, views)
            }
        }
    }
}
