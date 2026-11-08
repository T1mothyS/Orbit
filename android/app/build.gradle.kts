import java.util.Properties
import java.net.URI
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins { id("com.android.application") }
val firebaseConfigured = file("google-services.json").exists()
if (firebaseConfigured) apply(plugin = "com.google.gms.google-services")
val personal = providers.gradleProperty("orbitPersonal").orNull == "true"
val orbitConfig = Properties().apply {
    val configFile = rootProject.file("orbit.local.properties")
    if (configFile.exists()) configFile.inputStream().use { load(it) }
}
val appUrl = providers.gradleProperty("orbitAppUrl").orNull ?: orbitConfig.getProperty("appUrl")
    ?: error("Set appUrl in android/orbit.local.properties (fixed public HTTPS URL, no credentials)")
val parsedUrl = URI(appUrl)
require(parsedUrl.scheme == "https" && parsedUrl.host != null && parsedUrl.userInfo == null && parsedUrl.port == -1 && parsedUrl.query == null && parsedUrl.fragment == null) { "appUrl must be a public HTTPS URL without credentials, port, query or fragment" }
val releaseSigningFile = rootProject.file(if (personal) "signing.personal.local.properties" else "signing.local.properties")
val releaseSigning = Properties().apply {
    if (releaseSigningFile.isFile) releaseSigningFile.inputStream().use { load(it) }
}
val releaseRequested = gradle.startParameter.taskNames.any {
    it.substringAfterLast(':') in setOf("assembleRelease", "bundleRelease")
}
require(!releaseRequested || releaseSigningFile.isFile) {
    "Release requires the matching keystore configuration in ${releaseSigningFile.name}"
}
require(!releaseRequested || !personal || firebaseConfigured) { "Personal release requires its Firebase client configuration" }
val orbitVersion = groovy.json.JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
android {
    namespace = "io.github.t1mothys.orbit"
    compileSdk = 36
    defaultConfig {
        applicationId = if (personal) "io.github.t1mothys.orbit.personal" else "io.github.t1mothys.orbit"
        minSdk = 26
        targetSdk = 36
        versionCode = 68000
        versionName = orbitVersion["version"] as String
        manifestPlaceholders["orbitAppLabel"] = if (personal) "orbit 个人版" else "orbit"
        buildConfigField("String", "APP_URL", "\"${appUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
        buildConfigField("boolean", "FCM_CONFIGURED", firebaseConfigured.toString())
        buildConfigField("boolean", "DEVELOPER_TOOLS", "false")
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    signingConfigs {
        if (releaseSigningFile.isFile) create("orbitRelease") {
            fun read(key: String): String = releaseSigning.getProperty(key)?.takeIf { it.isNotBlank() }
                ?: error("Missing signing setting: $key")
            storeFile = rootProject.file(read("storeFile"))
            storePassword = read("storePassword")
            keyAlias = read("keyAlias")
            keyPassword = read("keyPassword")
        }
    }
    buildTypes {
        getByName("debug") { buildConfigField("boolean", "DEVELOPER_TOOLS", (providers.gradleProperty("orbitDeveloperTools").orNull == "true").toString()) }
        getByName("release") {
            isMinifyEnabled = false
            signingConfigs.findByName("orbitRelease")?.let { signingConfig = it }
        }
    }
}
kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.google.firebase:firebase-messaging:25.1.3")
    implementation("com.google.firebase:firebase-installations:19.1.2")
    testImplementation("junit:junit:4.13.2")
}
