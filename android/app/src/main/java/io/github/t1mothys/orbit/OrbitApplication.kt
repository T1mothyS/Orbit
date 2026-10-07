package io.github.t1mothys.orbit

import android.app.Application
import com.google.firebase.FirebaseApp

class OrbitApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationSupport.createChannels(this)
        if (BuildConfig.FCM_CONFIGURED) FirebaseApp.initializeApp(this)
        // Reboot discards tests: elapsedRealtime must never be reinterpreted after boot.
        NotificationSupport.clearObsoleteTest(this)
    }
}
