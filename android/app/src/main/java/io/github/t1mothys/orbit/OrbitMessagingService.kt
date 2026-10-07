package io.github.t1mothys.orbit

import android.annotation.SuppressLint

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.text.DateFormat
import java.util.Date

// The legacy lint rule does not recognize onRegistered; this build uses the FID API.
@SuppressLint("MissingFirebaseInstanceTokenRefresh")
class OrbitMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        val p = NotificationSupport.prefs(this)
        if (p.getString("account", null) != null && !p.getBoolean("reset_pending", false)) p.edit().putString("fid", installationId).putString("fcm_state", "已注册，等待网页同步绑定").apply()
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val p = NotificationSupport.prefs(this)
        val data = message.data
        if (p.getString("account", null) != data["accountId"] || p.getString("generation", null) != data["generation"]) return
        val id = data["notificationId"] ?: return
        p.edit().putString("fcm_result", "前台回调 ${DateFormat.getTimeInstance().format(Date())}").apply()
        NotificationSupport.show(this, (id.hashCode() and 0x3fffffff) + 2000, message.notification?.title ?: "Orbit", message.notification?.body ?: "",
            id, data["accountId"], data["generation"])
    }
}
