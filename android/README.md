# Orbit Android 构建

状态：一期试验。Kotlin / Android WebView 在线壳，包名 `io.github.t1mothys.orbit`。行为和设备验收合同见 [架构](../docs/ARCHITECTURE.md#android-客户端与-push) 与 [测试矩阵](../docs/TEST-MATRIX.md#android-一期)。没有离线业务同步或厂商 Push。

## 工具链

使用 JDK 17、Android SDK Platform 36 / Build Tools 36.0.0、Gradle Wrapper 9.6.0、AGP 9.4.0（内置 Kotlin）。工具链放在项目级或用户缓存目录，不修改全局 PATH。首次运行需要访问 Google Maven、Maven Central 和 Gradle 下载站。原仓库在 Windows 非 ASCII 路径内，`android.overridePathCheck=true` 只关闭 AGP 路径预检查；实际构建和 lint 仍需通过。

1. 在被忽略的 `android/local.properties` 填入 `sdk.dir=C\:/path/to/AndroidSdk`，Windows 盘符冒号需要转义。
2. 在被忽略的 `android/orbit.local.properties` 填入 `appUrl=https://your-public-site.example/today`。只允许无端口、凭据、query、fragment 的 HTTPS URL；壳内固定站点，安装后不能由网页改变。
3. 按需配置 Firebase。未配置也可以编译、安装、登录、聊天和测试本地通知。

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-17'
.\android\gradlew.bat -p android :app:assembleDebug :app:lintDebug :app:testDebugUnitTest --no-daemon
# Windows 非 ASCII 路径：使用用户缓存中的独立 ASCII 副本验证，再把 APK 放回原输出路径。
.\scripts\build-android.ps1 -JavaHome $env:JAVA_HOME
# 生成 android/app/build/outputs/apk/debug/app-debug.apk
& 'C:\path\to\AndroidSdk\platform-tools\adb.exe' install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

`versionName` 直接读取根 `package.json`；`versionCode` 在 `app/build.gradle.kts` 维护，发布新安装包时递增。调试 APK 仅适用于本轮试验；正式 release 需要独立签名、禁用 WebView 调试并单独授权发布。禁止提交签名文件和密码。

## Firebase 配置

客户端锁定 Firebase Messaging `25.1.3` / Installations `19.1.2`；服务端锁定 `firebase-admin` `14.5.0`（Node >=22）。按官方 FID API 使用 `register` / `onRegistered` / `unregister` 和 Admin `fid` 目标，不使用已弃用的 token 注册链路。

- 用户自建 Firebase 项目，注册上述包名、开启 Cloud Messaging，下载配置到被忽略的 `android/app/google-services.json`。
- `google-services.json` 存在时构建才启用 Google Services 插件；没有它时移除自动初始化 Provider，不调用 Firebase。改动配置后重新构建 APK。
- 服务端使用专用服务账号，只授予 `roles/firebasecloudmessaging.admin`（FCM 发送及订阅管理，不授予数据库或存储权限）。账号 JSON 放在服务器 release 目录之外的私有安全目录，目录 700、文件 600，通过 `FIREBASE_SERVICE_ACCOUNT_FILE` 指向绝对路径。开发时可放在被忽略的 `.local-secrets/firebase-service-account.json`。不要上传到 APK、对话、Git 或日志。
- `ANDROID_PUSH_ENABLED=true` 仅在唯一 worker 启动独立扫描；默认 `false`。不需要启用 SMTP 或 AI 任务。账号的“Android 手机提醒”也默认关闭。
- 发送端必须能访问 Google 的认证与 FCM 服务。配置路径存在不证明凭据权限和网络有效；点击测试的结果与真机后台观察分别记录。
- 若复用既有选择性出网代理，仅将 `oauth2.googleapis.com` 和 `fcm.googleapis.com` 两个发送端域名加入已验证线路；备份并校验代理配置，保留其他分流与 TLS 验证。Node 22 原生环境代理必须在进程启动前设置，单独 SSH 探针不会自动继承应用的 PM2 环境。先验证凭据交换及 `dryRun` 请求，明确记录没有投递，再接入扫描；这些结果不证明手机的 Google 长连接可达。

退出或换账号会取消本地测试、清理系统通知、解绑当前设备并撤销 FCM 注册/FID。离线时保留仅能解绑的补偿凭据，下次启动或回到前台联网时自动重试，不把登录 JWT 交给原生存储。已经发送的后台系统通知无法保证撤回。

## 不依赖网页发布的本地试验入口

APK 顶部的“本地通知试验”可直接查看权限、授权通知、开启“闹钟和提醒”、安排精确/非精确一分钟测试或取消。这样在旧网页、断网和 Firebase 未配置时仍可试验。每台设备仅一个待触发测试；非精确按钮明确标注可能延迟；重启后不恢复。网页更新后，设置 → 通知与提醒显示完整 Android 状态和 FCM 测试按钮。

试验对话框使用可滚动的自定义视图，状态文字、五项操作和关闭按钮同时显示；权限回调、操作后和回到前台均刷新状态，不再组合平台的 message/items 内容分支。Web UI 通过线上页面进入现有 WebView，网页变更无需重新打包；原生、桥接、Firebase 配置或安装版本变化时重建 APK。部署 Android 服务端代码前，须按依赖变更流程准备 Linux 运行依赖，不复用缺少 firebase-admin 的旧 node_modules。

实际展示、声音、锁屏、划掉 App、强行停止、国内无代理网络及键盘仍按 [真机矩阵](../docs/TEST-MATRIX.md#android-一期) 验证。构建或 JVM 测试不证明手机送达。

### 后台与延迟排查

本地试验由系统 `AlarmManager` 和清单注册的 `LocalTestReceiver` 触发，不依赖 WebView 的计时器；`onResume` 不补发本地通知，回桌面和 Activity 销毁也不取消预约。退出账号、换账号、点击取消或再次安排测试会清理或替换原预约，每次只测试一种模式。

非精确测试使用 `setAndAllowWhileIdle`，系统可批处理和延后；一次实测延迟不能当作固定等待时间。Android 12 起，在没有省电限制时官方允许预约时间后一小时内触发，Doze/省电限制另有边界。精确测试使用 `setExactAndAllowWhileIdle`，仍需单独验证设备后台策略。

安排精确测试后先只按 Home 回桌面或锁屏，不划掉任务、不退出账号、不强行停止。到时先看系统通知栏，再打开试验面板对照触发时间、延迟与预约状态：面板显示“已提交系统展示”只证明接收器调用了系统通知，实际展示/声音/点击须另记；如果仍待触发，继续排查闹钟权限与后台唤醒。正常回桌面、最近任务划掉、系统回收与强行停止分别记录，不能统称“关闭”。Android 15 的强行停止会撤销 PendingIntent，本轮不绕过系统停止语义。

FCM 是独立的联网推送链路，配置成功也不证明本地后台问题已解决；设备仍需要兼容的 Google Play 服务和可达的 Google 推送网络。网页正常联网不能替代 FCM 长连接证据。客户端配置与服务端私钥分开存储；改配置后生成新的试验 APK并记录文件 hash，不能仅凭相同应用版本推断是否已带 Firebase 配置。

官方资料：[FID 注册](https://firebase.google.com/docs/cloud-messaging/android/get-started)、[Admin 发送](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)、[前后台行为](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)、[网络要求](https://firebase.google.com/docs/cloud-messaging/network-configuration)、[系统定时](https://developer.android.com/develop/background-work/services/alarms)、[Android 15 强行停止](https://developer.android.com/about/versions/15/behavior-changes-all#enhanced-stop-states)。
