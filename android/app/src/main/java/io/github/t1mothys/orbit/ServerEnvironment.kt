package io.github.t1mothys.orbit

import java.net.URI

object ServerEnvironment {
    val url = BuildConfig.APP_URL
    val origin = URI(url).let { "${it.scheme}://${it.host}" }
}
