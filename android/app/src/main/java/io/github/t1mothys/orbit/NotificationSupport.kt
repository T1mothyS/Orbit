package io.github.t1mothys.orbit

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

object NotificationSupport {
    const val LOCAL_ID = 1001
    const val CHANNEL = "orbit_reminders"
    private const val LOCAL_CHANNEL = "orbit_local_test"
    fun prefs(c: Context) = c.getSharedPreferences("orbit_native", Context.MODE_PRIVATE)
    fun createChannels(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannels(listOf(
            NotificationChannel(CHANNEL, "Orbit 手机提醒", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(LOCAL_CHANNEL, "Orbit 本地通知试验", NotificationManager.IMPORTANCE_HIGH)))
    }
    fun permission(c: Context) = NotificationManagerCompat.from(c).areNotificationsEnabled()
    fun exactPermission(c: Context): Boolean = Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    private fun pending(c: Context) = PendingIntent.getBroadcast(c, LOCAL_ID, Intent(c, LocalTestReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun cancel(c: Context, result: String = "本地测试已取消") {
        c.getSystemService(AlarmManager::class.java).cancel(pending(c))
        prefs(c).edit().remove("local_due").remove("local_elapsed").remove("local_boot").putString("local_result", result).apply()
        c.getSystemService(NotificationManager::class.java).cancel(LOCAL_ID)
    }
    fun clearObsoleteTest(c: Context) {
        val p = prefs(c)
        val boot = Settings.Global.getInt(c.contentResolver, Settings.Global.BOOT_COUNT, -1)
        if (p.contains("local_due") && p.getInt("local_boot", -2) != boot) cancel(c, "手机已重启，旧测试未恢复")
        else if (p.contains("local_due") && p.getBoolean("local_exact", false) && !exactPermission(c)) cancel(c, "精确提醒权限已撤销，旧测试已清理")
    }
    fun schedule(c: Context, exact: Boolean) {
        require(permission(c)) { "请先授权系统通知" }
        require(!exact || exactPermission(c)) { "请先开启闹钟和提醒，或选择非精确测试" }
        cancel(c)
        val at = SystemClock.elapsedRealtime() + 60_000L
        val due = System.currentTimeMillis() + 60_000L
        val alarm = c.getSystemService(AlarmManager::class.java)
        if (exact) alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(c))
        else alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(c))
        prefs(c).edit().putLong("local_due", due).putLong("local_elapsed", at).putBoolean("local_exact", exact)
            .putInt("local_boot", Settings.Global.getInt(c.contentResolver, Settings.Global.BOOT_COUNT, -1))
            .putString("local_result", "${if (exact) "精确" else "非精确（可能延迟）"}测试已安排").apply()
    }
    fun pendingStatus(c: Context): Any {
        clearObsoleteTest(c)
        val p = prefs(c)
        if (!p.contains("local_due")) return JSONObject.NULL
        return JSONObject().put("dueAt", p.getLong("local_due", 0)).put("exact", p.getBoolean("local_exact", false))
    }
    fun show(c: Context, id: Int, title: String, body: String, notificationId: String? = null, accountId: String? = null, generation: String? = null) {
        if (!permission(c)) return
        val intent = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (notificationId != null) intent.putExtra("notificationId", notificationId).putExtra("accountId", accountId).putExtra("generation", generation)
        val click = PendingIntent.getActivity(c, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(c, if (id == LOCAL_ID) LOCAL_CHANNEL else CHANNEL)
            .setSmallIcon(io.github.t1mothys.orbit.R.drawable.ic_notification).setContentTitle(title).setContentText(body)
            .setContentIntent(click).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        c.getSystemService(NotificationManager::class.java).notify(id, notification)
    }
}
class LocalTestReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        NotificationSupport.clearObsoleteTest(context)
        val p = NotificationSupport.prefs(context)
        if (!p.contains("local_due")) return
        val delay = (SystemClock.elapsedRealtime() - p.getLong("local_elapsed", 0)) / 1000
        val status = if (NotificationSupport.permission(context)) "本地测试已提交系统展示" else "本地测试触发，通知权限已关闭"
        p.edit().remove("local_due").remove("local_elapsed").putString("local_result", "$status；${DateFormat.getTimeInstance().format(Date())}；延迟 ${delay.coerceAtLeast(0)} 秒").apply()
        NotificationSupport.show(context, NotificationSupport.LOCAL_ID, "Orbit 本地通知测试", "一分钟测试 · ${DateFormat.getTimeInstance().format(Date())}")
    }
}
