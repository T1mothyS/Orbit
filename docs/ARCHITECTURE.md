# Orbit 架构

- Status: LIVING
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last local verification: 2026-10-08，设置归属、显式通知上下文、知识库阅读与 Android 试验面板；版本源为 package.json，验证入口/结果见 TEST-MATRIX。不包含真机送达、真实 AI、生产、自然定时与收件箱；其他历史证据按各节日期使用。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本文档记录当前源码和测试能够证明的结构，不记录密钥、真实生产数据、用户邮件或服务器凭据。发生行为变化时，先以源码和测试为准，再更新本文档。

## Android 客户端与 Push

`android/` 是 Kotlin + WebView 在线壳，复用 Web 登录、聊天、路由与账号数据。构建时固定一个 HTTPS 来源，原生 `WebMessageListener` 只允许该来源的主框架和协议版本 1；未知方法拒绝，外部链接打开系统应用，不忽略 TLS 错误，不允许明文/混合内容、文件 URL 和第三方 Cookie。返回、键盘/系统栏安全区、文件选择及通知点击由原生负责。没有业务离线数据库和手机常驻轮询。

客户端缺少 `google-services.json` 时不初始化 Firebase；本地测试仍可用。FCM 注册使用 `register/onRegistered` 的 FID，退出使用 `unregister` 与 Installations `delete`。原生不保存登录 JWT，账号与设备绑定由当前登录网页提交。Android 通知权限共用；拒绝不会阻断 Web 页面。本地 AlarmManager 一分钟试验与 FCM 独立：精确测试检查 `SCHEDULE_EXACT_ALARM`，另提供明确标注可能延迟的非精确测试，每台设备仅保留一个，取消/退出/换账号清理，重启不恢复，不创建服务器 Reminder。

`server/android-push.ts` 在 chat.db 的三个新增表维护独立默认关闭的账号偏好、私有设备/FID 和每设备持久投递。已存在安装 ID 更新要求安装密钥证明；同一物理设备用该证明换账号时轮换 generation 并阻止旧队列。读取接口不返回 FID、安装密钥或密钥 hash；解绑补偿能力仅能撤销匹配 device/generation，不能登录或发送，旧补偿不能解绑新账号。账号禁用、认证版本变化、设备权限关闭或撤销均阻止发送。

| 接口 | 边界 |
| --- | --- |
| `GET /api/android-push` | 当前账号开关、发送端配置状态、扫描开关、脱敏设备列表 |
| `PUT /api/android-push/preferences` | 当前账号独立手机 Push 开关 |
| `POST /api/android-push/devices` | 认证 + 安装密钥证明，注册/更新/切换绑定 |
| `DELETE /api/android-push/devices/:id` | 认证 + 当前账号所有权，撤销指定设备 |
| `POST /api/android-push/revoke` | 仅解绑能力；匹配设备、generation 与安装密钥，供离线退出补偿 |
| `POST /api/android-push/devices/:id/test` | 认证 + 所有权，30 秒频率限制，只处理该次当前设备测试 |
| `GET /api/android-push/notifications/:id` | 认证 + 通知所有权，脱敏投递状态及安全对象路由 |

唯一 worker 的 `ANDROID_PUSH_ENABLED=true` 每 15 秒运行独立扫描，不依赖 SMTP、站内开关或 AI 增强。复用 `proactiveCandidates` 与周期投影、逐事项规则和 snooze；待完成、未删除、时间/fingerprint/账号开关/设备状态/免打扰均在发送前复核，最多保留五分钟有效窗口。提前提醒不得在事项已经开始后补发；免打扰期间不推送，超过窗口不追发。消息只包含标题与时间，以及用于当前账号点击定位的通知 ID 和 generation，不带备注、位置或 AI 提示。

每设备独立去重；FID 轮换只重新定位尚未发送的记录，已接受的同一事项/触发时间不重复发送，generation 负责绑定有效性。领取 CAS、持久 attempts、15/30/60/120 秒重试，最大四次；单设备失败不回滚其他设备。`sent` 仅证明 Admin SDK 接受发送，不证明手机展示。FCM 使用 `notification + data`：后台系统展示，前台原生展示；点击由账号/generation 检查后用已认证的目标读取接口定位。已经接受的后台通知可能在退出、改期后出现，无法保证撤回，必须区分此边界与发送前保护。

Push 使用独立表和消费者；旧通知消费者明确排除 `push`，不会替手机渠道提前标 `sent`。没有为正式事项同时安排本地闹钟。设备/投递不进入账号备份，chat.db 启用 secure_delete 以清除已删除身份的空闲页残留；sql.js 导出会重置连接 PRAGMA，因此每次导出及内存恢复后都重新开启。全站备份在副本中安全清理并压缩，旧全站快照恢复也清理手机状态；恢复后重新授权开关并绑定。新增 schema 前保留数据库迁移快照，维护恢复拒绝开启 Push 扫描。构建配置/凭据方式见 [Android 构建](../android/README.md)，真机结论仅见 [验收矩阵](TEST-MATRIX.md#android-一期)。

事项的通俗分类、字段解释及历史占位时间边界见 [日历数据人话版](CALENDAR-DATA-GUIDE.md)；该说明不改变现有数据模型。

2026-09-19 本地 0.27.2 增量：活动库 `daily_reports.media_receipt_json` 是可空的媒体诊断扩展列，初始化幂等添加；旧记录保持空值，无正文重写。该字段随原子数据库写回及导出/恢复保存，旧程序可忽略额外列。字段合同见 [Cloud 日报](CHATGPT-WORK-CLOUD.md#markdown-合同与解析诊断)。

## 1. 运行时边界

浏览器或 Electron renderer 进入 React/Vite 前端。前端通过同源的 /api 请求访问 Express 服务；开发环境由 Vite 代理到 Node 服务，生产环境由 HTTPS/Nginx 转发到 Node 服务。

React/Vite 与 Electron 壳都使用同一套前端页面。Electron 主进程和 preload 只负责桌面窗口、安全桥接和通知等壳能力，不复制服务器端业务。

## 2. 前端

SettingsLayout 在正文滚动容器中测量章节位置，使用帧节流及尺寸观察更新导航高亮；导航自身只滚动到当前分类，不移动键盘焦点。知识库手机阅读页以专用样式覆盖通用页面顶部留白，箭头返回及章节控制条铺满阅读区域并覆盖后方正文。

项目成长 `/project` 从头像菜单打开，页面及样式按路由懒加载。只读 `GET /api/project-evolution` 使用现有 Bearer 认证，读取服务端校验后的 `project-evolution/generated.json`；有效账号共享项目事实，不读取业务数据库，不在运行时调用 Git 或 AI。合同见 [项目成长维护说明](../project-evolution/README.md)。

入口和主要页面：

| 入口 | 职责 |
| --- | --- |
| src/main.tsx | 创建 React 根节点并加载全局样式 |
| src/App.tsx | 登录态、顶层路由和登录后页面组合 |
| src/pages/LoginPage.tsx | 登录、注册和验证码 |
| src/components/AppShell.tsx | 登录后产品壳、导航、主题、设置和退出 |
| src/components/ActionCenterPage.tsx | 今日行动中心 |
| src/components/ScheduleView.tsx、CalendarView.tsx、ScheduleSidebar.tsx | 日历、日程和分类 |
| src/components/ReminderPage.tsx | 周期事务、完成和提醒历史 |
| src/components/AiSchedulePanel.tsx、AiImportPage.tsx | 普通 AI、天气和待确认导入 |
| src/components/NoteBoard.tsx | AI 记事的 CRUD、颜色、完成、原位提示词优化/撤回、事务合并和导出 |
| src/components/DailyReportsPage.tsx | 日报列表、独立阅读页和显式重发 |
| src/components/ResearchPage.tsx | 研究历史、观点提案与用户确认界面；不启动真实 Agent |
| src/components/LibraryPage.tsx、library/LibraryDetailPage.tsx | 知识库列表与异步阅读、评论、版本 |
| src/pages/ToolsPage.tsx | 登录后的挂载应用菜单；不加入产品顶部导航 |
| src/components/settings/ | Settings V2 的 Dialog、Layout、Section、Row 和领域设置 |

当前登录后页面路由是 /today、/schedule、/assistant、/reminders、/reports、/reports/:date、/research、/library、/library/:id、/tools 和 /project；/import 重定向到 /assistant?tool=email-import；未登录时使用 /login。设置通过产品壳按钮打开 SettingsDialog，没有独立 /settings 路由；Tools 可从头像菜单或设置“挂载工具”分区进入，不加入产品顶部导航。

### 前端加载边界（Phase 2，0.21.1-260915.1408）

App 保留登录、产品壳和 Today；SchedulePage、AiAssistantPage、ReminderPage、日报页面、LibraryPage、SettingsDialog、AdminModal 通过 React.lazy 加载，FeatureBoundary 提供等待、失败与刷新入口。弹窗等待状态可取消、Escape 关闭并恢复焦点。

- CalendarView 与 Today 共用 calendar/ScheduleFormModal、ScheduleDetailModal、schedule-types、schedule-presentation；共享层不得反向引用 CalendarView 或 lunar。
- LibraryPage 负责列表；library/LibraryDetailPage 负责阅读、评论和版本。仅出现公式节点才导入 katex-renderer（含 KaTeX CSS）；Mermaid 仍按内容动态导入，保留源码和异步取消保护。
- Library/Admin 专属 CSS 跟随功能加载；Settings 沿用自己的样式。Phase 5 将其余样式按原顺序拆到 src/styles/，index.css 仅负责导入；这些公共及混合规则继续全局加载。
- 路由、API、数据库和业务确认合同保持原有语义。证据与边界见 [Phase 2 验收](archive/engineering/PHASE2-FRONTEND-LOADING.md)。

## 3. 后端

Phase 4（`0.21.3-260915.1936`）后，server/index.ts 保留 CLI 与测试兼容入口；直接执行时先加载配置，再交给 runtime 启动。server/app.ts 的 createApp(deps) 是无配置/数据/定时器/监听副作用的独立工厂，负责 HTTP 中间件顺序。server/runtime/ 拥有配置、四库初始化、监听端口与六组后台任务的 start/stop（原五组加 CalDAV）。

Phase 5 后，server/routes/ 拥有全部领域 HTTP 处理器，包括日程、周期事务、完成、AI、settings/admin 和备份。server/application.ts 仅组合中间件、路由、健康检查及运行时依赖。四 store 仍是进程级单例；多数据目录测试使用独立进程。

认证中间件先解析登录身份；业务接口使用当前用户 ID 查询或写入数据。管理员接口额外检查管理员角色。外部日报接口使用独立的按账号绑定令牌，权限与登录会话分开。

挂载工具保留现有 API 的 Bearer JWT 认证，同时为原始 HTML 页面和资源使用同一 JWT 派生的 `HttpOnly`、`SameSite=Lax` 页面 Cookie。登录/注册写入该 Cookie，`/api/auth/me` 为已有 Bearer 会话补写，退出接口清理；Cookie 校验仍检查账号禁用状态和 `auth_version`，不会替代 API 鉴权。

领域路由保持已有认证、所有权及 Phase 3 可靠写入协议；固定路径先于参数路由，SPA fallback 最后安装。关闭 runtime 会停止新调度并等待在途 HTTP 与后台 Promise；外部服务超时和强制终止的边界见 [Phase 4 验证记录](archive/engineering/PHASE4-APP-RUNTIME-ROUTERS.md)。

Phase 5 的所有权、等价性和迁移验收见 [Phase 5 验证记录](archive/engineering/PHASE5-DOMAIN-BOUNDARIES.md)。

### 挂载工具边界

`protected-tools/manifest.json` 是工具菜单的清单来源；`GET /api/tools` 只在 Bearer 认证后返回当前启用工具的 `slug`、标题、说明、路径和 `kind=mounted`。原始 HTML 放在 `protected-tools/<slug>/index.html`，由 `/tools/<slug>/` 的专用门禁在主站静态资源和 SPA fallback 之前交付。未知 slug、路径遍历、资源目录和 fallback 均不能绕过门禁；工具响应使用 `private, no-store`。

工具路径使用独立 CSP profile：默认挂载工具允许其受审阅 HTML 所需的内联脚本；支付宝规划器额外允许 `https://cdn.plot.ly` 和 `https://render.alipay.com` iframe。主站的 CSP 不放宽。三个初始应用继续使用浏览器 `localStorage`，扑克牌档案和支付宝参数不会按账号同步。

这条路径只适合本人控制或已经审阅的 HTML。由于它们仍处于同域，受信任的应用脚本可以看到浏览器本地存储；它不是第三方插件沙箱。未来若要挂载不受信任的代码，必须改用独立 origin 或更严格的沙箱边界。

## 4. 持久化

Daily Digest V2.5 使用原活动库中的 `digest_v2_runs`（账号/日期/输入快照/版本与诊断）和 `digest_v2_artifacts`（账号/日期/模式/内容哈希唯一的冻结产物）。`daily_reports`、通知、认证与备份入口复用；Shadow 不写正式表。快照七天过期，长期诊断不保留邮箱正文。媒体采用内容寻址字节：独立隔离服务的 Shadow 经测试 R2 并留本地镜像；正式服务可显式让 Shadow 与 production 使用原媒体目录的持久公开路径，另有 R2 选项。文章来源/许可保留在账号产物引用中。账号恢复重映射运行与产物 ID，跨账号恢复不允许沿用旧输入运行。具体发布状态、失败恢复、媒体生命周期及限制见 [V2.5 合同](CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同)。

Daily Digest V3 Core 的四类事件记忆实体、三个引用表和 D09 本地冻结引用表已增量加入同一个 `activity.db`，由 `activity-store.ts` 接入 `digest-v3-store.ts`；D07 登录态路由提供受控提交、按截点分页历史和精确预览，D09 增加按本地日报具体版本的冻结和读取，没有 Work/MCP 写入、自动分类或正式发布接入。D13 研究详情可按登录账号读取其绑定的精确修订和来源。账号引用使用复合外键，封存版本和冻结记录禁止原位更新。全站数据库快照包含 V3 表；账号级备份当前保存八组行，恢复时校验引用，同账号合并或替换，跨账号重映射 V3 ID、引用与日报版本键。旧七组备份可合并，但不能替换已有冻结记录；完全不含 V3 的旧备份不能替换已有 V3 数据。字段、迁移与验收边界见 [V3 Core 合同](DAILY-DIGEST-V3-CORE-CONTRACT.md#d09-第一步人工核验引用冻结2026-09-28)。

D13 Research/Thesis 在同一 `activity.db` 增量保存运行、草稿及用户确认版本，由 `digest-research-store.ts` 接入现有可靠写回和账号备份。`routes/research.ts` 仅提供登录态当前账号接口，`/research` 只读历史并提交明确观点决定；未对 Work OAuth 或日报只读令牌开放写权限。触发 Workspace Agent 目前只有合成协议测试，不在运行路径。合同与受限项见 [研究与观点](DAILY-DIGEST-RESEARCH-THESIS.md)。

server/db.ts 保留兼容导出；server/database/connection.ts 拥有连接与写回，schema.ts 和 migrations.ts 拥有按原顺序执行的建表/升级，queries/ 按领域拥有查询。其余三个 store 保持既有领域边界。

数据层使用 sql.js。服务启动时把 SQLite 文件加载到内存，业务修改后导出并写回 data/。当前主要文件为：

- chat.db：用户、会话、消息、AI 配置、记事、账号私有知识库、偏好与令牌哈希，以及 OAuth、Cloud Context/活动输入和媒体批次元数据；经历复盘使用独立的 `library_experience_sessions/images`，知识版本可保存元数据快照。知识正文以 Markdown 为 source，HTML 按读取时安全渲染。日报正文不在此库。
- schedule.db：日历、分类和日程。
- reminder.db：周期事务和提醒配置。
- activity.db：`daily_reports` 日报正文和来源/投递状态、通知队列、完成记录、AI 导入草稿、附件元数据及 V3 事件记忆表，由 `activity-store.ts` 管理。

数据库文件、附件、日报媒体、备份和日志都是运行时资产，不能提交 Git。备份服务在导出和恢复时处理四个数据库及允许的附件/媒体内容；恢复前必须检查版本、冲突和快照路径。

系统快照包含四库、附件和日报媒体；用户备份包含账号范围记录、附件和所引用的新版日报媒体字节。部署配置由独立部署备份负责。Phase 3 为四库提供原子替换，并为完成、AI 确认和用户恢复提供同步跨库提交及启动 undo 恢复；系统恢复另有文件切换清单。chat.db 的 operation_results 保存按账号隔离的确认结果。未包装的其他多步业务不自动获得跨库事务保证。协议、故障证据、平台限制与降级步骤见 [Phase 3 验收](archive/engineering/PHASE3-PERSISTENCE-RECOVERY.md)。

## 5. 领域边界

### 记事图片与草稿合同

`chat.db` 的 `note_images` 登记账号图片，`note_item_images(user_id,note_id,image_id,position)` 保存有序关联；元数据和字节复用 `activity.db` 附件与现有内容寻址存储，不加入聊天的 `orbit_attachments`。增量建表前快照既有数据库。`POST /api/note-items/images` 接受 JPEG/PNG/WebP base64，检查签名、10MB/40Mpx上限，sharp 旋转/压缩至最长边2048并移除元数据；认证 GET/DELETE 检查账号。DELETE 只接受无人引用的图片。上传前独立清理超过24小时的未绑定图片，不使用聊天清理规则。

记事 POST/PATCH 接受 `imageIds`，一条最多3张、合计20MB，沿用账号配额。图文或仅图片为一条，纯文字保留逐行保存。图片编辑必须提供 `expectedRevision`；正文修订也覆盖图片，慢优化/编辑不得覆盖新图文。关联与正文跨库事务提交；废纸篓保留图片，合并目标在前、来源在后并去重，超限整笔拒绝。永久删除只清理没有任何记事引用的文件。清空/删除账号包含新表。

格式1加密用户备份增加 `noteImages` 有序关联及附件字节，跨账号重映射记事和文件ID，恢复缺图返回 `PARTIAL/missingNoteImages`；仅图片记事可恢复。合并保持已有卡片的图文编辑，旧备份缺少关联字段时禁止替换已有图文，只允许合并；恢复前保留安全副本。普通TXT/CSV不包含图片。

前端 `composer-draft.ts` 同步内存及按账号/会话的 `sessionStorage`，兼容旧文字缓存。提交捕获来源和修订，成功消费对应版本；较新的文字保留，已提交图片从新草稿移除。切走后的成功响应仍消费原草稿，列表刷新不决定保存成功。退出清理账号缓存。`note-clipboard.ts` 单个ClipboardItem提供经转义的HTML（图片内嵌字节）和纯文本，独立PNG复制另用image/png；不保证目标应用保留图片，失败使用原生模态预览复制。

ClipboardItem 的多种 MIME 是同一条内容的可选表示，目标应用决定读取哪种；设计参考 [W3C Clipboard 工作草案](https://www.w3.org/TR/clipboard-apis/) 和 [WebKit Async Clipboard 说明](https://webkit.org/blog/10855/async-clipboard-api/)。点击时立即调用 write，图片准备以 Promise 数据交付，避免先异步读取丢失用户激活；真实 Safari 兼容性仍需设备验收。

| 领域 | 前端入口 | 后端入口/服务 | 关键规则 |
| --- | --- | --- | --- |
| 认证与账号 | LoginPage、useAuth | auth 路由、db | JWT 与账号状态；所有数据按用户隔离 |
| 日程与分类 | ScheduleView、CalendarView | schedule-store、日历 API | 日期、时区、冲突和分类逻辑可测试 |
| 周期事务与通知 | ReminderPage、ActionCenterPage | reminder-store、notification-service、scheduler | 月末兜底、逾期完成、免打扰和失败重试 |
| AI | AiSchedulePanel、AiImportPage | AI 服务、ai-plan、ai-import-service | 生成计划不等于写入；必须用户确认 |
| AI 记事 | NoteBoard、NoteImages | note-item-service、note-image-service | 图文独立于聊天；有序图片关联和文字事务保存；废纸篓保留引用，合并超限原子拒绝；TXT/CSV 是文字导出 |
| 知识库 | LibraryPage | library-service、library-markdown、library publish API | 普通文章由 V2 本地加工、服务器只读呈现、评论、版本、关系原样保存和安全 Markdown |
| 经历记忆 | library/ExperiencePage、ExperienceDetails | experience-service、experience-ai、routes/experience | 独立复盘与按需联网、可编辑草稿、确认后存正式经历；普通 Chat 不召回，合同见 [知识库](LIBRARY.md#经历记忆) |
| 日报 | DailyReportsPage | daily-report API、模板、media service、delivery policy | Local/Cloud 按来源和内容哈希保存；媒体先校验/托管；来源设置决定 `RECEIVED` 或 `CANDIDATE` 及邮件入队 |
| 完成和附件 | ActionCenterPage | completion、attachment service | 所有权、大小、MIME 和恢复边界 |
| 备份与管理 | Settings、AdminModal | backup-service、admin API | 高风险操作确认、快照和回滚 |

## 6. 日报 V2 跨项目流程

新新闻信息图由 `digest-v2-visuals.ts` 使用现有 sharp 和随包中文字体绘制；`digest-v2-service.ts` 在账号/运行输入校验后保存原持久媒体与 run manifest 绑定。`daily_report.prepare_visuals_v2` 不发布或发信；后续发布仍检查正文/证据哈希、媒体文件哈希和逐条图门禁。外站照片审核不变，详见 [原创信息图合同](CHATGPT-WORK-CLOUD.md#每日新新闻的原创信息图准备)。

外部日报 V2 负责本地链路的采集、上下文、结构化生成、Validator、确定性渲染、本地媒体下载/校验和上传；Work Cloud 通过生产 MCP 读取输入并在服务端托管媒体。Orbit 负责令牌/OAuth 鉴权、根据调用身份固定 `local` 或 `cloud` 来源、媒体按内容哈希保存、日报按账号/日期/来源/内容版本幂等保存，以及按账号来源设置决定 `RECEIVED` 或 `CANDIDATE` 和邮件队列。Cloud `dry_run=true` 不写日报或邮件队列，`dry_run=false` 必须返回 `PUBLISHED` 才表示生产数据库已保存。

本地 NoSend、发布接口返回、QUEUED、SMTP accepted 和收件箱到达属于不同证据层级，不能相互替代。Local 发布阶段不抓取外站新闻图；Cloud 服务端可受控获取显式媒体，无批次时逐图 Best Effort，有批次时检查 READY、归属与完整性，正文完整性保持硬闸门。`dry_run=true` 不保存日报或队列，但可能托管媒体文件。不得把外部项目凭据或运行数据带入仓库。完整合同见 [Cloud 文档](CHATGPT-WORK-CLOUD.md)。

## CalDAV 全量单向边界（2026-09-19）

应用进程内纯读当前账号日历、已排期待办与权威当前周期，经共享服务手动/每5分钟投影到独立 CalDAV 集合；自动化默认暂停，需要范围确认与手机核心验证声明。原五组后台任务之外增加 caldav，复用唯一 worker 与关闭等待。账本v2分离目标身份/范围，保留既有资源键并备份迁移；只删除映射内对象。系统加密快照包含账本与控制状态，恢复事务包含桥接目录且恢复后暂停；Radicale 数据仍独立备份。完整配置、协议、恢复及未验证边界见 [CalDAV 合同](CALDAV-BRIDGE.md)。

## 7. 构建产物

Vite Web 构建写入 dist/；Electron TypeScript 编译写入 dist-electron/；build:electron 准备只含 main.js、preload.js、app-url.json、package.json 和桌面图标的 dist-desktop/；安装包写入 release/。部署包还必须保留受保护工具的 `protected-tools/` 目录，它不属于 `dist/`，不能只上传前端构建产物。构建需要合法 HTTPS 的 ELECTRON_APP_URL 或 APP_URL，但该值不应写入提交或覆盖 .env。

## Tools 与提示词优化（2026-09-20）

Tools 的正式来源是 `protected-tools/manifest.json` 及各 slug 的 `index.html`，默认纳入源码、完整发布包及整站版本和回滚生命周期；不采用 Knowledge Library 的独立内容发布模式。发布检查见 [部署路径](DEPLOYMENT-PATHS.md)。

`POST /api/ai/prompt-optimize` 仍保留为兼容性的纯优化接口：使用当前账号认证、凭据及首选模型，接收 `{ text }`，返回 `{ optimizedText }`；正文为 1–2000 字符，输出同上限，90 秒超时。该独立调用禁用工具、配置加载和会话持久化，不读取日程/知识库，不写业务或聊天历史。

记事板使用 `POST /api/note-items/:id/optimize` 和 `POST /api/note-items/:id/revert-optimization` 完成原位覆盖与单步撤回。`note_items` 的 `is_optimized`、`optimization_count`、`optimization_previous_content` 和 `content_revision` 分别记录当前撤回状态、成功优化累计次数、服务端私有的上一版正文和正文版本；对外 `NoteItem` 只返回前三者中的公开状态字段 `isOptimized`、`optimizationCount`、`contentRevision`，不暴露上一版正文。优化/撤回接口要求客户端提交 `expectedContent + expectedRevision`，并以单条条件 UPDATE 防止账号隔离、重复优化、重复撤回和异步慢响应覆盖新正文；每次优化尝试另有内部 `runId` 仅用于请求日志关联，不写入提示词或正文。`PATCH /api/note-items/:id` 的正文修改会清除当前优化状态、保留累计次数并递增版本；只改颜色或完成状态不会清除撤回。旧数据库和旧备份缺少这些字段时按未优化、次数 0、版本 0 迁移。

## Orbit 对话与操作合同

Orbit 使用现有 chat.db 和同步持久化事务，未增加数据库服务或框架。`orbit_conversations` 保存账号归属和会话标题；`ai_schedule_messages.conversation_id` 关联历史；旧记录首次访问时迁入默认会话。会话历史长期保留，模型仅使用最近 20 条、最多 12000 字符的历史，以及有界对象引用、附件节选和当前账号事实。活跃草稿优先于普通历史；历史和知识资料不是系统指令，不能把历史计划视为已执行。模型查询关闭内置工具、继承配置、外部 MCP 和 SDK 会话持久化，仅注册 Orbit 进程内受控工具；只有本站认证服务可以在确认后写入事务。

`orbit_requests` 保存请求 ID、归属、输入、状态和结果。每账号一次执行一个 AI 请求；不同账号及短同步写操作可以并行。请求号在账号内唯一，重复提交返回原请求，号相同而内容不同拒绝。状态为 queued/running/completed/failed/cancelled/interrupted；页面关闭不取消后台任务，显式取消会中止 SDK 并禁止迟到历史/计划落库。启动时 running 转 interrupted，queued 继续执行；失败或中断需要手动重试。该队列不保证外部模型的计费撤销，也不重放备份中的外部请求。

前端 useOrbitChat 用同步创建标记阻止新对话创建期间发送/重复创建，select 先更新当前目标引用，旧会话回调不能提交。页面对应显示创建进度；没有被接受的提交不会清空输入。正常模型请求运行不等于创建/切换，仍沿持久队列接收后续消息。

清空当前对话与行内删除共用一次待确认状态，5 秒超时/外部点击/Escape/切换/关闭菜单复位，第二次点击才请求接口。清理期间同步锁阻止重复提交与新发送，并使清理前的刷新响应失效；成功后更新本地空历史，后续刷新失败明确报告已清理、状态正在重连。取消请求在服务端仍保留持久状态，但从页面状态列表移除；失败和中断继续显示重试。

清空和删除在同一同步持久化事务内清理账号/会话所属的聊天附件元数据、消息、请求及处理步骤、活跃计划指针，queued/running 时拒绝。提交成功后只清除该会话的计划/请求缓存，失败不动缓存。清空保留会话、正式事务、记事及浏览器文字/记事图片草稿；聊天附件列表同步重置，未确认发送的重试编号失效。文件在事务成功后按共享引用清理，写入失败保留原记录和字节；若提交后文件删除失败，兼容响应增加 `attachmentCleanupPending: true` 并显示存储清理提示，不能把已接受的历史清空误报为整体失败。计划确认继续从所属账号的持久消息解析，清空后的缓存不能恢复已删除计划。

`DELETE /api/ai-chat/plans/:planId/operations/:key` 只移除 pending 状态的 create/create_recurring 草稿操作，必须携带正整数 expectedRevision；归属不匹配或编号不存在返回404，旧版本或非活跃/过期状态返回409。事务内保存新快照、正文说明和活跃计划指针，成功后更新缓存；剩余操作重新编号并递增版本，最后一项移除后保存空的cancelled终态，刷新/重启不复活。前端保存、移除、取消及确认共用同步锁。纯创建草稿不展示日程参考上下文；其他草稿只展示update/delete目标，历史读取及后续编号引用使用同一过滤规则，查询和正式执行结果保留原卡片合同。

| 接口 | 合同 |
| --- | --- |
| GET/POST `/api/orbit/conversations` | 当前账号会话列表/创建 |
| PATCH/DELETE `/api/orbit/conversations/:id` | 重命名/删除；存在 queued/running 时先取消；保留事务数据 |
| DELETE `/api/ai-schedule/history?conversationId=<id>` | 当前账号会话清空；保留会话和正式事务，移除消息、全部历史请求、聊天附件及计划关联；queued/running 时拒绝 |
| GET/PATCH `/api/orbit/preferences` | 账号自动知识检索、主动聊天开关及 aiSelection；PATCH 全部字段校验后才写入 |
| POST `/api/orbit/requests` | 接受有 requestId/conversationId/text 的有界请求，返回 202 和状态；每账号最多 20 个等待/执行请求 |
| GET `/api/orbit/requests?conversationId=...` | 指定账号会话最近 40 个请求状态 |
| POST `/api/orbit/requests/:id/cancel`、`/retry` | 取消/重试；正在结束的同 ID 工作不能重入 |
| POST `/api/ai-chat` | 兼容旧调用方的最终响应，执行同一队列 |
| GET `/api/ai-schedule/history?conversationId=...` | 仅当前账号会话，日程卡片重新读取当前事实；已删除对象移除 |
| PATCH `/api/schedules/:id/planned-date` | 周期投影专用；date 可为空以恢复到期日，expectedState 必填；原子更新周期本体和日历投影 |

AI 生成的 update/delete 绑定真实对象 ID 和事实指纹，确认时拒绝已变化或丢失的目标。同名不能定位时要求选择，序号与最近卡片不一致时拒绝。计划编辑保留基线；确认结果与取消状态保存到历史，已删除会话或取消的计划不能执行。普通结果卡片使用现有日程详情/编辑表单，并提交 expectedState 防止覆盖期间的其他修改。

`reminder_cycles.planned_date` 是可空扩展列；缺失时以 due_date 安排。改期仅修改当前未完成周期的工作日期；原到期日、提醒投递日期和未来周期规则不变。日历与行动中心读取 planned_date，行动中心同时返回 dueAt/plannedAt。手机 CalDAV 现有周期投影仍采用原到期日，不自动更改手机端提醒策略。

知识检索只在明确请求、明确接续此前资料、或账号主动开启自动检索时进行。排名与摘要剥离 YAML frontmatter，优先展示摘要。模型给出真实条目 ID；服务端校验候选集合，并按正文首次引用编号排序。未被引用候选单独折叠，不能当作已用来源。当前搜索仍为词法匹配，不是向量检索；未做通用长期记忆、人物/项目实体自动建模。

账号加密备份保存会话、消息、检索偏好及周期安排日期；新队列执行状态不随账号备份重放。旧备份缺少 Orbit 字段时保留现有会话；跨账号恢复重映射会话/消息 ID，并清除原账号的计划、日程和知识引用。完整系统备份仍通过既有数据库文件合同覆盖这些表。清空/删除账号清理新表。

品牌改为 Orbit，应用内部数据库、备份魔数/格式、加密盐、认证存储键、appId 和既有桌面数据目录保留兼容身份。

### 聊天模型偏好

`orbit_preferences.ai_selection` 是增量可空 TEXT 列，保存 `{provider: 'workbuddy'|'chatgpt', models: {workbuddy?: string, chatgpt?: string}}`；活动 Provider 必须有具体模型 ID。接口按认证账号读写，严格校验类型/长度/控制字符，剥离未知顶层字段，不保存凭据；无偏好返回 null。PATCH 同时提交多个偏好时先完整校验，避免部分写入。

前端从当前账号实际 Provider/模型目录恢复精确 ID，新模型和目录排序不自动替换选择；无偏好且 ChatGPT 已连接才选择目录中的 Luna。缺失模型保留原 ID 并要求手动选择；未连接不切换 Provider。每次请求继续冻结 Provider/模型。偏好写入与连接刷新使用版本保护；保存失败与目录失败分别反馈。Work Buddy 原有默认解析模型接口保持独立。

Orbit 账号备份的 aiSelection 随偏好导出并在恢复前校验，不包含 OAuth/Key。旧备份缺此字段时，合并保留当前偏好，替换清空后重新初始化；有字段按备份恢复。跨账号恢复仅迁移模型偏好，连接与模型可用性重新检查，既有业务引用清理规则不变。

### Orbit 主对话、统计和主动提醒

唯一账号级 `is_main` 索引保留固定 Orbit 入口；首次迁移沿用原默认会话和历史。主对话不可重命名/删除入口，历史单独确认清理。其他会话可绑定当前账号事项，行内编辑/删除使用目标 ID。主对话补充最多 25 个当前事项和 6 条带消息/会话/日期的词法历史摘录；当前事实优先，尚无通用长期记忆总结。未读使用持久主动消息及客户端实际读到的截止时间，后台标签页不自动已读。

相对日期以入队时账号本地日期为基准，重试保留基准。自然日程问法直接查真实数据并显示日期/时区；定时事项按账号时区和区间交集，全天按日区间。未定日期待办不伪装成今天 09:00；显式非法日期提示核对。历史列表始终从当前账号数据校验可点击对象。

`GET /api/orbit/statistics?period=week|month|year&date=YYYY-MM-DD&taskType=all|event|todo|reminder&reportSource=all|local|cloud` 聚合当前账号元数据；日期默认账号今天，周从周一开始。个人数据不写入项目成长 JSON。事项安排日期决定完成率共同分母，周期本体与投影去重；有效完成记录按 completedAt 另计，撤销不计，历史缺时间明确未知，无日期待办单列。日报按归属日期/来源去重，只计 received，候选另列，不把产出计数当邮件到达。趋势和明细同口径，不返回知识/日报正文。

知识更新比较相邻版本内容哈希，初始/补建基线和连续相同版本不计。`POST /api/orbit/knowledge/:id/read` 在实际可见详情打开时记录，滚动半小时同条目去重；AI 回答保存后只为校验过的 `referenced=true` 来源记录一次消息/条目引用。事件只存账号/条目/种类/时间，系统元数据保留采集起点；之前阅读/引用显示未记录，不回算模糊历史。

服务级 `ORBIT_PROACTIVE_ENABLED=true` 独立启动每 30 秒扫描，账号通知设置中的站内通知开关还需开启；不依赖 BACKGROUND_JOBS_ENABLED，不启动 SMTP/IMAP、日报或备份。普通明确时间事项缺省提前 15 分钟一次，有明确分钟数则沿用；周期沿用原 offset/date/time/timezone。无日期及无明确时间全天事项不自动触发。`GET/PATCH /api/orbit/schedules/:id/reminder` 调整普通事项聊天提醒，不更改原邮件或周期规则。

只处理触发点后 5 分钟内候选；免打扰期间抑制，结束时仅窗口内有效候选可发，过期不批量补发。账号正在生成普通请求时直接用事实模板，其余可用该账号已授权模型补充最多 600 字建议，20 秒超时/失败降级；资料不作为指令，AI 无写入工具。发送前复查账号开关、静默、事项事实指纹、提醒时点及完成状态。网络等待不持有数据库事务，消息与事件状态在同步事务中落盘；同账号/事项实例/提醒点去重，事实指纹用于发送前校验，重启只恢复窗口内未送候选。

提醒默认写主对话并保存来源。`POST /api/orbit/reminders/:eventId/complete|snooze|tomorrow` 验账号、事件及事项基线：完成沿用真实完成记录/周期同步；稍后为 15 分钟，次日为账号时区明天 09:00，仅调整聊天提醒。重复动作拒绝，自然语言修改仍走确认计划。关页面后消息仍保存，不代表网页外或手机弹出。真实模型建议质量和自然定时另行验收。

账号备份保存主对话标记、消息来源、普通提醒规则及使用事件；同账号合并幂等，替换恢复不重放未送通知和 snooze 时间，个人自动周报关闭，恢复不自动发起 AI。外账号恢复清除原业务引用及可执行提醒，并保留停用原链接的历史活动事件/报告快照，旧备份缺新字段继续可读。删除/清空账号清理新账号表，全库快照覆盖系统采集起点。数据迁移前留数据库快照；生产迁移另行授权。

### Orbit AI 基础升级
Provider 合同位于 server/ai-provider-contract.ts：模型目录声明与真实验证分开；未知能力保持 unknown。工具只有受控读取和草稿权限，正式写入继续经过用户确认和 operation-service。WorkBuddy SDK 内置工具继续关闭。

#### 当前操作状态
待确认计划的消息快照为持久来源，内存 Map 仅为缓存；会话 active_plan_message_id 指向唯一活跃草稿。revision 用于编辑/确认冲突校验，取消/挂起/过期保留快照。确认接口独立恢复，无需先读取历史。明确时间与日期短句只修订该草稿，文字确认仍需按钮；新话题挂起，恢复需显式操作。恢复备份不会激活草稿。
主动提醒保存 handled_action、handled_at、next_reminder_at；旧 handled 仅显示已处理。正式日程写入、所有权、指纹与 operation_results 幂等边界不变。

#### Provider 适配边界
WorkBuddy 主聊天经 ai-provider-workbuddy.ts 调用；旧 Key/验证/模型接口保持兼容。目录可用时补充 SDK 原始能力字段，不可用时返回 unknown 而不使旧模型列表失败。请求入队冻结 Provider 和模型。进程内 MCP 工具采用 Orbit 白名单，拒绝命令、文件、外部 MCP 和继承设置；SDK 内置工具仍为 tools: []。图片导入同步权限策略。zod 沿 SDK 已有 v4 版本显式声明。

`buildCodeBuddyEnv` 为所有 SDK 入口显式设置 `NODE_USE_ENV_PROXY=0`。SDK CLI 自行管理 HTTP 传输，不能继承父进程的 Node 原生代理模式；此项只作用于子进程，个人 Key/Base URL 与父进程 ChatGPT 代理保持不变。服务器代理安装、私有订阅与回退细节只记录在本机 runbook。

#### 联网工具
Orbit 工具复用日历、词法知识库和已发布日报服务；知识沿明确请求/自动检索偏好/明确资料追问开放，跨对话历史工具只在明确请求时开放。Tavily 固定 basic，每轮两次、每次五条；月度请求保守计数，额度错误锁定本月，不自动切换。公开网页读取复用 HTTPS/DNS 地址固定防护，逐跳校验、超时和大小限制。结果记录真实 URL、发布时间（未知为空）和抓取时间。
手动 ChatGPT 聊天在公共 Responses 请求中提供原生 `web_search`，采用 low 搜索上下文，由模型按需调用；同时移除该请求的 Tavily search 函数，其他 Orbit 读取工具保留。WorkBuddy 的 Tavily 路径保持独立。原生搜索受模型/账号策略和套餐额度约束，失败明确反馈，不静默切换搜索商或付费 API；模型能力探测及后台链路不会因此获得搜索工具。
原生搜索的流式工具项目映射为现有请求步骤；完成项目及 URL citation annotations 提取来源，校验 HTTP(S) 地址并拒绝 URL 凭据。发布时间未知为空，不推断发布时间。引用在结构化回复解析后转成可点击 Markdown，来源及步骤随消息保存；不改操作 JSON 或正式写入边界。与函数工具合计最多六个可观测工具项目，超过时终止客户端流；该计数及 low 上下文不构成 OpenAI 服务端硬计费上限，原生搜索不计入 Tavily 月度预算。官方合同见 [Web search](https://developers.openai.com/api/docs/guides/tools-web-search) 与 [套餐通道限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。
搜索 Key 使用独立 AES-GCM 凭据目录，默认主机密钥不进入普通用户或全站数据库/附件备份；Windows 应使用运行账号专属目录 ACL。模型和工具均无正式写权限。

#### ChatGPT 适配

授权导入的传输检查复用 http-security 的 isCredentialImportSecure：直接 TLS 或本机直连可用；同机 TLS 代理须覆盖 X-Forwarded-Proto，且实际 socket peer 为 loopback、协议头精确为 https。远程伪造/多值头拒绝，不为该接口自动扩大 Express 全局 trust proxy；后续仍验证身份签名、scope 与账号归属。
本地授权助手使用 127.0.0.1 /auth/callback、state/nonce/PKCE，保存 issued client ID 并验证 JWKS/issuer/audience/sub。服务器导入再次验证身份与访问令牌的 resource/scope，保留本机 host。刷新使用进程合并和独占文件锁，原子保存旋转 token；临时失败保留凭据，失效令牌要求重授权。
直接公共 Responses HTTP/SSE 强制 store:false、stream:true，不使用 previous_response_id 或后台参数。按 output_index 收集 response.output_item.done 的完整项目，完成事件 output 为空时使用这些已完成项目；仍必须收到 response.completed，失败/中断/未完成不会变成成功。工具及加密上下文原样接续，工具按官方 namespace 发送；工具结果纳入后续本地 input。OAuth 连接从普通备份排除，后台 AI 不迁移到此连接。
### 会话附件与共享解析

普通聊天回复优先按结构化消息解析；无活跃草稿、非事项专属对话且输入没有日程意图时，可接收纯文本并封装为 `chat`、空 operations/knowledgeSourceIds，元数据记录 `textFallback`。显式“不操作日程”不会单独阻止文件问答，但与新增/修改请求混用时仍拒绝文本降级。空响应、破损操作 JSON、日程请求和导入/主动提醒继续严格解析；普通 chat 不渲染偶然关键词匹配的事项卡。

聊天附件复用 activity.db 的 attachments、账号配额与 data/attachments 哈希文件；chat.db 增量保存 orbit_attachments（会话、解析状态/块）和 orbit_message_attachments（消息引用）。原附件/完成记录接口保持类型边界，文档扩展只在聊天与备份恢复明确启用。上传需认证、会话归属，10MB/文件、3 个/轮、20MB/轮、默认 500MB/账号；图片经 sharp 校验、2048px 压缩并去除 EXIF。

共享 file-parser 服务在最多两个 192MB heap worker 中解析，15s 超时与取消，最多 100 页 PDF/一百万字符正文/2,000 个解析块，与备份恢复上限一致。PDF.js 使用本地字体资源，不执行 PDF JavaScript、不抓取外链；PDF.js optional canvas 是服务端依赖，Node 最低 22.13，部署需保留 npm 的平台 optional dependencies。扫描/加密 PDF 明确失败。解析能力供后续知识库复用，上传不写知识库。

模型输入按账号模型目录的真实 image capability 检查，未知能力不假装读取图片；文档降级为带页码/定位的文本。每轮文本预算用 12,000 UTF-8 字节保守限制 token 上界，截断明确提示节选；后续“这份文件”只引用当前会话最近附件，多个文件需指定名称。未发送附件 24 小时后在账号附件访问/上传时清理；已关联文件随会话保留，删除引用并检查共享哈希后清理文件。加密用户备份保存附件、解析块及消息关系，跨账号恢复重映射 ID；OAuth 凭据不进入普通备份。

Office 共享同一 worker：DOCX 用 Mammoth 纯文本，XLSX 用 ExcelJS 缓存值/行定位，CSV 有界状态解析；不计算公式、不加载外部资源。Office 先验证 ZIP 中央目录，再在 worker 校验真实解压大小：1,000 entries、每项 10MB、总计 40MB、压缩比 100；拒绝路径穿越、加密/ZIP64、宏/ActiveX/嵌入对象及类型不符。XLSX 最多 30 表、每表 1,000 行/总 100,000 非空单元格；CSV 最多 200 列/1,000 行。截断必须反馈。worker 源文件随源码部署，不进入前端 bundle。

`orbit_model_capabilities` 保存按账号/Provider/模型/凭据版本的真实图片或工具验证，优先于目录声明。`POST /api/orbit/providers/probe` 仅在用户手动点击时用合成输入验证，60 秒上限，不发送个人上下文；失败不写“支持”。清空/删除账号删除新表与本地 ChatGPT 凭据；远程应用授权需用户另在 ChatGPT 账户确认撤销。恢复缺失文件不创建幽灵附件引用。

认证事件流 `GET /api/orbit/requests/:id/events` 在每次更新检查 token 到期、账号禁用及 auth_version，流断开回查持久请求并保留轮询降级。失败项重试创建新的有期限草稿，只复制失败操作并保留原指纹；旧草稿保存 retryPlanId，重复请求不复制成功项。

完成记录 `PUT /api/completions/:id` 继续校验账号归属。可选 note/billDate 的 null 或空字符串表示清空，省略表示保留；日期非法拒绝更新，不能把 null 转成字面文本。前端分别呈现登记完成、证明上传和失败恢复，附件失败不重新创建已成功的完成记录；网络超时结果仍未知。


### 交互连接与个人活动报告合同

- 通知“查看原对象 / 就此继续聊”只出现在通知消息。历史读取重新确认归属及对象状态；缺失或失效时返回 `canContinue:false` 并清除旧 `href/object`，已处理通知仍可继续讨论。每日行动提醒指向 `/today`。继续聊天在输入框显示可清除的关联，不改原输入；关联与草稿按账号和会话保存，发送成功仅消费提交版本。
- `notificationId` 纳入请求幂等比较。AI 请求重新检查当前账号归属与可继续状态，显式加入完整标题、正文、来源、时间及状态，不依赖最近 20 条历史。通知文字作为引用资料，业务变更仍走现有明确确认；普通 AI 不因个人资料入口调整而读取 Cloud context。

- Status: CONTRACT；2026-10-04 增量实现。权威来源：`notification-chat.ts`、`activity-statistics.ts`、`activity-reports.ts`、`connected-backup.ts`、`orbit-profile.ts` 与相关路由/测试。行为、表结构、过滤或投递规则变更时同步本节。
- `reminders.in_app_enabled` 是站内及主动聊天的唯一账号开关。旧 `proactiveEnabled` GET/PATCH 仅为兼容别名，旧字段不再存第二份启用状态。逐事项提前/停用规则保持独立。
- `orbit_notification_messages` 以账号、对象、周期实例、精确提醒时点去重。站内消息、映射、会话时间和通知 sent 在跨库同步事务落盘。系统重启复用映射，不扫描历史 sent 做消息回填；删除消息也不重放历史通知。已读使用通知 read_at，完成使用真实业务记录，投递 sent 与两者独立。
- 新卡片元数据包含通知 ID、对象引用、来源标签、设置引用及事项基线指纹。GET 历史会按当前归属/完成/指纹计算状态；完成与延后接口再次检查，不接受失效卡片。旧主动卡片动作继续支持。站内扫描独立于 SMTP/IMAP；公共应用层消费浏览器前台通知，浏览器队列 sent 表示前台可消费，read 表示前台已显示/确认，不保证系统弹窗最终呈现。
- `src/utils/orbit-links.ts` 维护旧 URL 对象定位与安全协议过滤。Settings registry 只含稳定 ID、名称、用途、关键词和定位，不含配置值；账号权限过滤管理员设置。Settings 搜索、全局搜索、AI 只读工具及聊天卡片共用索引，不建立 AI 内嵌设置表单。
- `orbit_activity_events` 只记录成功创建来源、日期改期、确认执行和成功记事优化。复用现有同步事务与 executeOnce，不记录页面停留或复制聊天正文。采集起点在 `orbit_metrics_meta`；未知历史不回填。
- `GET /api/orbit/statistics` 保留旧字段和筛选；自定义 `period=custom&from=<带偏移时间>&to=<带偏移时间>`，最大 367 个自然日对应时长，开始包含/结束不包含。新增 activity、filters、coverage、每日趋势/热图与 metricDetails；`metric/offset/limit` 支持 1–100 条分页。安排分母按安排时间，完成按有效记录；周期与投影去重。无日期待办纳入新增、完成、积压。快照积压不反推历史；成功工具步骤要求 result_count > 0，旧未采集结果不补算。
- `orbit_activity_reports` 保存范围、统计、摘要 hash、洞察、失败信息及自动截止点；模型无写工具，最多三条洞察、有界统计/必要摘要与证据对象，账号选择的 Provider/model，60 秒上限。快照 hash 忽略展示时刻/锚点；事实变化后可重新生成。接口：`GET/POST /api/orbit/activity-reports`、`GET /:id`、`GET /:id/current`、`POST /:id/insights`、`POST /:id/deliver`（confirm=true）。全部检查账号归属。发送预览先绑定保存的事实快照；确认时发送原报告 ID，数据变化不会悄悄替换已预览的内容。
- `orbit_weekly_preferences` 默认 enabled=0，账号时区周日 20:00。`GET/PATCH /api/orbit/weekly/preferences` 只接受 enabled/weekday/hour/minute。稳定计划使用相邻本地周截止点，跨 DST 可能不是 168 小时；修改时点的首期接续最近实际截止点，长停服只取最近一周。账号、截止点唯一；邮件/站内按报告 ID/渠道唯一，报告与投递共用事实快照。模型失败仍为事实版；邮件 sent 仅表示 SMTP accepted。恢复不开启自动周报、不重投旧通知。
- `orbit_profiles` 只存账号头像附件 ID。JPEG/PNG/WebP ≤5 MB，复用图片签名/配额/文件存储，sharp 转 256px WebP 并清除 EXIF。`GET /api/orbit/profile` 和头像 GET/POST/DELETE 必须认证；响应 private/no-store。
- 账号备份 orbit.connected 保存事件/报告/偏好/头像映射/通知消息映射，文件沿现有 attachments 备份。旧备份缺字段兼容；跨账号恢复保留历史证据并停用原账号链接，自动周报保持关闭；未发送通知转 suppressed。删除/清空账号清理所有新表。
- 首次新增报告表前在运行数据目录 migration-backups 保存既有 SQLite 文件；正常跨库事务保留 undo 恢复。回滚需停服务、保留当前新增数据，再恢复对应四库快照并切回原代码；不能以恢复旧数据库保留升级后新数据。生产迁移、部署、真实 AI/SMTP 与收件箱验收分别授权。
