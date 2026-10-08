package io.github.t1mothys.orbit

import android.content.Context
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

object NativeSession {
    private val executor = Executors.newSingleThreadExecutor()
    private var registering = false
    private var resetting = false
    private val queueLock = Any()
    fun initialize(c: Context) {
        val p = NotificationSupport.prefs(c)
        if (!p.contains("installation")) p.edit().putString("installation", UUID.randomUUID().toString())
            .putString("key", UUID.randomUUID().toString() + UUID.randomUUID().toString()).apply()
    }
    fun status(c: Context): JSONObject {
        initialize(c)
        val p = NotificationSupport.prefs(c)
        val binding = p.getString("device", null)?.let { JSONObject().put("id", it).put("accountId", p.getString("account", null)).put("generation", p.getString("generation", null)) } ?: JSONObject.NULL
        return JSONObject().put("developerTools", BuildConfig.DEVELOPER_TOOLS).put("version", BuildConfig.VERSION_NAME).put("installationId", p.getString("installation", ""))
            .put("installationKey", p.getString("key", "")).put("fid", p.getString("fid", null) ?: JSONObject.NULL)
            .put("notificationPermission", NotificationSupport.permission(c)).put("exactAlarmPermission", NotificationSupport.exactPermission(c))
            .put("fcmConfigured", BuildConfig.FCM_CONFIGURED).put("fcmState", p.getString("fcm_state", if (BuildConfig.FCM_CONFIGURED) "尚未注册" else "未配置"))
            .put("binding", binding).put("pendingLocal", NotificationSupport.pendingStatus(c))
            .put("localResult", p.getString("local_result", "尚未安排本地测试")).put("fcmResult", p.getString("fcm_result", "未记录"))
            .put("pendingNotification", p.getString("pending_notification", null) ?: JSONObject.NULL)
            .put("pendingRevocations", JSONArray(p.getString("revocations", "[]")).length())
    }
    fun account(c: Context, id: String) {
        require(id.isNotBlank() && id.length <= 128) { "账号格式不正确" }
        val p = NotificationSupport.prefs(c)
        require(JSONArray(p.getString("revocations", "[]")).length() < 32) { "待补偿解绑较多，请联网完成解绑后重试" }
        if (p.getString("account", null) != id) {
            logout(c)
            p.edit().putString("account", id).apply()
        }
        compensate(c)
        register(c)
    }
    fun observeWebAccount(c: Context, id: String?) {
        require(id == null || (id.isNotBlank() && id.length <= 128)) { "账号格式不正确" }
        val p = NotificationSupport.prefs(c)
        val previous = p.getString("web_account", null)
        // Legacy web builds reload on logout. Observe only the public account claim, never retain JWT.
        if (previous != null && previous != id && (id == null || p.getString("account", null) != id)) logout(c)
        p.edit().putString("web_account", id).apply()
    }
    fun register(c: Context, force: Boolean = false) {
        if (!BuildConfig.FCM_CONFIGURED || registering || resetting || NotificationSupport.prefs(c).getBoolean("reset_pending", false) || NotificationSupport.prefs(c).getString("account", null) == null) return
        if (!force && NotificationSupport.prefs(c).getString("fid", null) != null) return
        registering = true
        val account = NotificationSupport.prefs(c).getString("account", null)
        NotificationSupport.prefs(c).edit().putString("fcm_state", "注册中").apply()
        FirebaseMessaging.getInstance().register().addOnCompleteListener {
            registering = false
            if (NotificationSupport.prefs(c).getString("account", null) != account) return@addOnCompleteListener
            if (!it.isSuccessful) NotificationSupport.prefs(c).edit().putString("fcm_state", "注册失败，请检查 GMS 与 Google 网络").apply()
        }
    }
    fun bind(c: Context, input: JSONObject) {
        val p = NotificationSupport.prefs(c)
        require(input.getString("accountId") == p.getString("account", null)) { "账号已切换，请重新绑定" }
        val fid = if (input.isNull("fid")) null else input.optString("fid")
        require(fid == p.getString("fid", null)) { "FCM 身份已更新，请刷新注册" }
        p.edit().putString("device", input.getString("id")).putString("generation", input.getString("generation")).apply()
    }
    fun logout(c: Context) {
        val p = NotificationSupport.prefs(c)
        val id = p.getString("device", null)
        val hadRegistration = p.getString("account", null) != null || p.getString("fid", null) != null || p.getBoolean("reset_pending", false)
        synchronized(queueLock) {
            val queue = JSONArray(p.getString("revocations", "[]"))
            if (id != null) queue.put(JSONObject().put("id", id).put("generation", p.getString("generation", "")).put("key", p.getString("key", "")))
            p.edit().putString("revocations", queue.toString()).remove("device").remove("generation").remove("account").remove("fid").remove("pending_notification").apply()
        }
        NotificationSupport.cancel(c, "退出或换账号，已清理本地测试")
        c.getSystemService(android.app.NotificationManager::class.java).cancelAll()
        compensate(c)
        if (BuildConfig.FCM_CONFIGURED && hadRegistration && !resetting) {
            resetting = true
            p.edit().putBoolean("reset_pending", true).apply()
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
            FirebaseMessaging.getInstance().unregister().continueWithTask { FirebaseInstallations.getInstance().delete() }.addOnCompleteListener {
                resetting = false
                p.edit().putString("fcm_state", if (it.isSuccessful) "已撤销注册" else "撤销注册未完成，下次启动重试")
                    .putBoolean("reset_pending", !it.isSuccessful).apply()
                if (it.isSuccessful) register(c)
            }
        }
    }
    fun abandon(c: Context, input: JSONObject) {
        synchronized(queueLock) {
            val p = NotificationSupport.prefs(c)
            val queue = JSONArray(p.getString("revocations", "[]"))
            queue.put(JSONObject().put("id", input.getString("id")).put("generation", input.getString("generation")).put("key", p.getString("key", "")))
            p.edit().putString("revocations", queue.toString()).apply()
        }
        compensate(c)
    }
    fun retryReset(c: Context) {
        if (!BuildConfig.FCM_CONFIGURED || resetting || !NotificationSupport.prefs(c).getBoolean("reset_pending", false)) return
        resetting = true
        FirebaseMessaging.getInstance().unregister().continueWithTask { FirebaseInstallations.getInstance().delete() }.addOnCompleteListener {
            resetting = false
            NotificationSupport.prefs(c).edit().putBoolean("reset_pending", !it.isSuccessful).apply()
            if (it.isSuccessful) register(c)
        }
    }
    fun compensate(c: Context) {
        executor.execute {
            val p = NotificationSupport.prefs(c)
            val queue = synchronized(queueLock) { JSONArray(p.getString("revocations", "[]")) }
            val remaining = JSONArray()
            for (i in 0 until queue.length()) {
                val value = queue.getJSONObject(i)
                try {
                    val origin = URI(BuildConfig.APP_URL).let { "${it.scheme}://${it.host}" }
                    val connection = URL("$origin/api/android-push/revoke").openConnection() as HttpURLConnection
                    connection.requestMethod = "POST"; connection.instanceFollowRedirects = false
                    connection.connectTimeout = 5000; connection.readTimeout = 5000; connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(value.toString().toByteArray(Charsets.UTF_8)) }
                    val success = connection.responseCode in 200..299
                    connection.disconnect()
                    if (!success) remaining.put(value)
                } catch (_: Exception) { remaining.put(value) }
            }
            // This executor is the only writer that drains the queue. Appends are synchronized below by merging unseen entries.
            synchronized(queueLock) {
                val current = JSONArray(p.getString("revocations", "[]"))
                val known = (0 until queue.length()).map { queue.getJSONObject(it).toString() }.toSet()
                for (i in 0 until current.length()) if (current.getJSONObject(i).toString() !in known) remaining.put(current.getJSONObject(i))
                p.edit().putString("revocations", remaining.toString()).apply()
            }
        }
    }
}
