package io.github.t1mothys.orbit

import android.content.Context
import java.net.URI

enum class ServerPreset(val id: String, val label: String) {
    PRODUCTION("production", "正式环境"), STAGING("staging", "测试环境");
    companion object {
        fun fromId(id: String?): ServerPreset = entries.firstOrNull { it.id == id } ?: PRODUCTION
    }
}

object ServerEnvironment {
    fun current(c: Context) = ServerPreset.fromId(c.getSharedPreferences("orbit_server", Context.MODE_PRIVATE).getString("selected", null))
    fun url(preset: ServerPreset) = if (preset == ServerPreset.PRODUCTION) BuildConfig.APP_URL else BuildConfig.STAGE_URL
    fun origin(preset: ServerPreset) = URI(url(preset)).let { "${it.scheme}://${it.host}" }
    fun select(c: Context, preset: ServerPreset): Boolean = c.getSharedPreferences("orbit_server", Context.MODE_PRIVATE).edit().putString("selected", preset.id).commit()
    fun pushEnabled(c: Context) = BuildConfig.FCM_CONFIGURED && current(c) == ServerPreset.PRODUCTION
}
