package io.github.t1mothys.orbit

import java.net.URI

/** One fixed HTTPS origin, with no credentials, port aliases or privileged subframes. */
class WebOriginPolicy(appUrl: String) {
    private val allowed = URI(appUrl)
    fun permits(value: String, mainFrame: Boolean): Boolean {
        if (!mainFrame) return false
        return try {
            val uri = URI(value)
            uri.scheme == "https" && uri.host?.equals(allowed.host, ignoreCase = true) == true && uri.port == -1 && uri.rawUserInfo == null
        } catch (_: Exception) { false }
    }
}
