package io.github.t1mothys.orbit

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var offline: LinearLayout
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val appUrl = ServerEnvironment.url
    private val policy = WebOriginPolicy(appUrl)
    private val origin = ServerEnvironment.origin
    private var widgetTarget: String? = null
    private var mainFrameFailed = false
    private var localStatus: TextView? = null
    // ComponentActivity only: there are no Fragment classes or an old Fragment dependency to upgrade.
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { NativeSession.register(this); refreshLocalStatus(); notifyWebStatus() }
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    private val files = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val value = if (result.resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data) else null
        chooser?.onReceiveValue(value); chooser = null
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeSession.initialize(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (BuildConfig.DEVELOPER_TOOLS) root.addView(Button(this).apply { text = "本地通知试验"; setOnClickListener { localDialog() } })
        offline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; visibility = View.GONE; setPadding(24, 20, 24, 20)
            addView(TextView(this@MainActivity).apply { text = "orbit 暂时无法连接。检查网络后重试。" })
            addView(Button(this@MainActivity).apply { text = "重试 orbit"; setOnClickListener { loadOrbit() } })
            if (BuildConfig.DEVELOPER_TOOLS) addView(Button(this@MainActivity).apply { text = "本地通知试验"; setOnClickListener { localDialog() } })
        }
        root.addView(offline)
        web = WebView(this)
        root.addView(web, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom)); insets
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEVELOPER_TOOLS)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false
            userAgentString += " OrbitAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (trusted(url)) return false
                if (request.isForMainFrame && url.scheme in listOf("https", "http", "mailto", "tel")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) {}
                }
                return true
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel(); mainFrameFailed = true; offline.visibility = View.VISIBLE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { mainFrameFailed = true; offline.visibility = View.VISIBLE }
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (trusted(Uri.parse(url))) mainFrameFailed = false
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, error: WebResourceResponse) {
                if (request.isForMainFrame) { mainFrameFailed = true; offline.visibility = View.VISIBLE }
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!mainFrameFailed && trusted(Uri.parse(url)) && view.progress == 100) {
                    offline.visibility = View.GONE
                    // The error overlay is dismissed only after a successful main-frame response.
                    // Hide the retired selector when connected to an older hosted frontend.
                    view.evaluateJavascript("""
                        document.documentElement.dataset.orbitAndroid = 'true';
                        if (!document.getElementById('orbit-retired-server-settings')) {
                            const style = document.createElement('style');
                            style.id = 'orbit-retired-server-settings';
                            style.textContent = '#settings-android-server, #setting-result-android-server-settings { display: none !important; }';
                            document.head.appendChild(style);
                        }
                    """.trimIndent(), null)
                    view.evaluateJavascript("""(()=>{let accountId=null;try{const token=localStorage.getItem('aicalendar_token');if(token){const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(typeof payload.userId==='string')accountId=payload.userId;}}catch{}window.OrbitNative?.postMessage(JSON.stringify({version:1,id:'native-auth-observer',method:'webAuth',params:{accountId}}));})()""", null)
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!trusted(Uri.parse(view.url ?: ""))) { callback.onReceiveValue(null); return true }
                chooser?.onReceiveValue(null); chooser = callback
                try { files.launch(params.createIntent()) } catch (_: Exception) { chooser?.onReceiveValue(null); chooser = null }
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "OrbitNative", setOf(origin)) { _, message, source, main, reply ->
                if (!policy.permits(source.toString(), main)) return@addWebMessageListener
                val request = try { JSONObject(message.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
                val id = request.optString("id")
                val response = JSONObject().put("id", id)
                try {
                    require(request.optInt("version") == 1) { "客户端桥接版本不兼容" }
                    val params = request.optJSONObject("params") ?: JSONObject()
                    var result: JSONObject? = null
                    when (request.optString("method")) {
                        "status" -> Unit
                        "account" -> NativeSession.account(this, params.getString("accountId"))
                        "binding" -> NativeSession.bind(this, params)
                        "logout" -> { TodayWidget.clear(this); NativeSession.logout(this) }
                        "todayWidgetStatus" -> result = TodayWidget.status(this, params.getString("accountId"))
                        "todayWidgetAccess" -> TodayWidget.access(this, params.getString("accountId"), params.getString("credential"), params.getLong("expiresAt"))
                        "todayWidgetRefresh" -> {
                            TodayWidget.observeAccount(this, params.getString("accountId"))
                            TodayWidget.refresh(this)
                        }
                        "webAuth" -> {
                            val account = if (params.isNull("accountId")) null else params.getString("accountId")
                            TodayWidget.observeAccount(this, account)
                            NativeSession.observeWebAccount(this, account)
                        }
                        "abandonBinding" -> NativeSession.abandon(this, params)
                        "permission" -> askPermission()
                        "exactPermission" -> { require(BuildConfig.DEVELOPER_TOOLS) { "通知试验仅在开发者构建中开放" }; if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))) }
                        "scheduleLocal" -> { require(BuildConfig.DEVELOPER_TOOLS) { "通知试验仅在开发者构建中开放" }; NotificationSupport.schedule(this, params.getBoolean("exact")) }
                        "cancelLocal" -> { require(BuildConfig.DEVELOPER_TOOLS) { "通知试验仅在开发者构建中开放" }; NotificationSupport.cancel(this) }
                        "consumeNotification" -> if (params.optString("id") == NotificationSupport.prefs(this).getString("pending_notification", null)) NotificationSupport.prefs(this).edit().remove("pending_notification").apply()
                        else -> error("未知 Android 操作")
                    }
                    response.put("result", result ?: NativeSession.status(this))
                } catch (e: Exception) { response.put("error", e.message ?: "Android 操作失败") }
                reply.postMessage(response.toString())
            }
        } else {
            AlertDialog.Builder(this).setMessage("请更新 Android System WebView 以启用网页通知设置。" + if (BuildConfig.DEVELOPER_TOOLS) "本地测试仍可通过原生入口操作。" else "")
                .setPositiveButton("继续", null).show()
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        handleNotification(intent)
        handleWidget(intent)
        loadOrbit()
    }
    private fun loadOrbit() {
        val target = widgetTarget
        widgetTarget = null
        web.loadUrl(if (target != null) origin + target else appUrl)
    }
    private fun trusted(uri: Uri): Boolean = policy.permits(uri.toString(), true)
    private fun askPermission() {
        val p = NotificationSupport.prefs(this)
        if (Build.VERSION.SDK_INT >= 33 && !NotificationSupport.permission(this) && !p.getBoolean("permission_requested", false)) {
            p.edit().putBoolean("permission_requested", true).apply()
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        else if (!NotificationSupport.permission(this)) startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }
    private fun refreshLocalStatus() {
        val p = NotificationSupport.prefs(this)
        localStatus?.text = "通知权限：${NotificationSupport.permission(this)}\n精确权限：${NotificationSupport.exactPermission(this)}\n${p.getString("local_result", "尚未安排") }"
    }
    private fun localDialog() {
        if (!BuildConfig.DEVELOPER_TOOLS) return
        val padding = (16 * resources.displayMetrics.density).toInt()
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(padding, padding, padding, padding)
        }
        localStatus = TextView(this).also { content.addView(it); it.setPadding(0, 0, 0, padding) }
        refreshLocalStatus()
        arrayOf("授权系统通知", "开启闹钟和提醒", "一分钟后精确测试", "非精确测试（可能延迟）", "取消本地测试").forEachIndexed { index, label ->
            content.addView(Button(this).apply {
                text = label; minHeight = (48 * resources.displayMetrics.density).toInt()
                setOnClickListener {
                try { when (index) {
                    0 -> askPermission()
                    1 -> if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
                    2 -> NotificationSupport.schedule(this@MainActivity, true)
                    3 -> NotificationSupport.schedule(this@MainActivity, false)
                    4 -> NotificationSupport.cancel(this@MainActivity)
                } } catch (e: Exception) { AlertDialog.Builder(this@MainActivity).setMessage(e.message).setPositiveButton("确定", null).show() }
                refreshLocalStatus()
                }
            })
        }
        AlertDialog.Builder(this).setTitle("Orbit 本地通知试验")
            .setView(ScrollView(this).apply { addView(content) })
            .setNegativeButton("关闭", null).create().apply {
                setOnDismissListener { localStatus = null }; show()
            }
    }
    private fun handleNotification(intent: Intent?) {
        val p = NotificationSupport.prefs(this)
        val id = intent?.getStringExtra("notificationId") ?: return
        if (p.getString("account", null) == intent.getStringExtra("accountId") && p.getString("generation", null) == intent.getStringExtra("generation")) {
            p.edit().putString("pending_notification", id).putString("fcm_result", "通知已点击 ${DateFormat.getTimeInstance().format(Date())}").apply()
        }
    }
    private fun handleWidget(intent: Intent) {
        if (intent.action == TodayWidget.openAction) widgetTarget = TodayWidget.target(this, intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleNotification(intent); handleWidget(intent); loadOrbit() }
    private fun notifyWebStatus() {
        if (::web.isInitialized && trusted(Uri.parse(web.url ?: ""))) web.evaluateJavascript("window.dispatchEvent(new Event('orbit:android-state'))", null)
    }
    override fun onResume() { super.onResume(); NativeSession.compensate(this); NativeSession.retryReset(this); NativeSession.register(this, true); NotificationSupport.clearObsoleteTest(this); refreshLocalStatus(); notifyWebStatus() }
    override fun onDestroy() { chooser?.onReceiveValue(null); web.destroy(); super.onDestroy() }
}
