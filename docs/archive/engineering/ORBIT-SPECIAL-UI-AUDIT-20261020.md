# Orbit 记事、成长展示与确认交互专项审计（2026-10-20）

- Status: 日期快照；本地实施与视觉候选不代表用户视觉批准、生产或设备验收。
- Scope: 已批准的P0–P4；默认产品/交互合同见[UI规范](../../UI-GUIDELINES.md)，成长事实见[成长合同](../../../project-evolution/README.md)。
- Baseline: P0源码f92202f（包含日报85c668c）；54里程碑、31快照，最新42节点63边。历史JSON原文未修改。
- Evidence: 隔离合成API/账号、Edge/Playwright，后台任务、真实模型、邮件及设备Push关闭。运行产物和截图存系统临时目录，不提交。
- Source: 当前源码和实际浏览器；下表行号为P0快照，后续行号会变化。ID与批准方案一一对应，不把静态检索数量当运行验收数量。

## 结果与边界

记事局部颜色、连续指标/离散证据、响应式架构故事与分层确认已实现。API/schemaVersion、统计规则、历史坐标和事实JSON不变，无新运行依赖或数据库迁移。系统通知及权限、Settings站内导航confirm和dirty-only beforeunload保留。

P0实际确认：聚焦边框/按钮为品牌色，shadow为none；手机360px图窗口承载1110×2025画布；测试记录4/54。P1改为局部note token与独立证据，P2采用真实关系分组、五站一次演示与完整历史，P3迁移业务原生交互和Tools八处调用。技术选择为SVG/CSS复用与展示投影，不使用图形库；新增代码仅随选择/尺寸/阶段更新，动画使用CSS，不维护逐帧React时钟。

## 主站调用审计

“已迁移/静态”表示源码已实现，但该低频分支没有逐项运行；实际运行的代表路径另列。不会用代表路径通过推断全部分支实测成功。

| ID | 页面/动作 | P0文件:行 | 风险与旧交互 | 最终处理 | 验证边界 |
| --- | --- | --- | --- | --- | --- |
| N01–05 | AI计划标题/起始日期/提醒时间/开始日期/时间校验 | AiSchedulePanel.tsx:207,210,211,215,216 | 低，alert | 字段附近错误、错误摘要及首个错误焦点 | 已迁移；验证计划编辑相关回归，未运行真实模型 |
| N06 | AI计划保存失败 | AiSchedulePanel.tsx:232 | 低，alert | 保留编辑与卡片错误 | 合成503实测留稿；标题为空不发请求且焦点返回首错 |
| N07 | 行动中心附件读取失败 | ActionCenterPage.tsx:474 | 低，alert | 页面错误 | 已迁移/静态 |
| N08 | 日程详情删除 | calendar/ScheduleDetailModal.tsx:126 | 中，confirm | 原生HTML dialog内ConfirmPopover | 实测位于父dialog内；Escape保留详情、返回删除按钮且数据仍存在 |
| N09 | 日历菜单删除 | calendar/ScheduleContextMenu.tsx:89 | 中，confirm | 稳定日程锚点ConfirmPopover | 静态，保留菜单键盘与焦点回归 |
| N10 | 无日期待办删除 | UnscheduledTodoDrawer.tsx:86 | 中，confirm | 稳定更多按钮锚点ConfirmPopover | 新增真实隔离取消/失败/忙碌/重试/删除验收 |
| N11 | 行动中心删除 | ActionCenterPage.tsx:355 | 日程中/周期高，confirm | 日程Popover，周期及历史Dialog | 静态分支；按sourceType保留端点与后果 |
| N12 | 行动中心转无日期 | ActionCenterPage.tsx:370 | 中，confirm | Popover，明确清除原日期 | 已迁移/静态 |
| N13 | 删除周期及历史 | ReminderPage.tsx:355 | 高，confirm | Dialog | 已迁移/静态删除分支 |
| N14–15 | 记事切换及选择合并来源时放弃修改 | NoteBoard.tsx:337,489 | 高，confirm | Dialog，取消保留原编辑和选择 | 已迁移；业务记事Smoke覆盖关联编辑/合并合同 |
| N16 | 日程编辑脏关闭 | calendar/ScheduleFormModal.tsx:186 | 高，confirm | Dialog，取消不丢稿，确认才关闭 | 普通及自动化模式真实应用内交互 |
| N17 | 待办编辑放弃 | UnscheduledTodoDrawer.tsx:27 | 高，confirm | Dialog | 既有待办/业务套件等价迁移 |
| N18 | 周期安排日期放弃 | OrbitScheduleEditor.tsx:64 | 高，confirm | OrbitDialog dirty谓词+discardMessage | 已迁移/静态 |
| N19–20 | 周期设置/完成登记放弃 | ReminderPage.tsx:404,471 | 高，confirm | OrbitDialog统一关闭路径+Dialog | 周期长表单取消/确认及busy回归；完成登记分支静态 |
| N21 | 完成记录编辑放弃 | ActionCenterPage.tsx:543 | 高，confirm | OrbitDialog统一确认 | 已迁移/静态 |
| N22–24 | 邀请码轮换/清空账号数据/删除账号 | AdminModal.tsx:242,274,301 | 高，confirm | 固定目标与原请求的Dialog | 管理员取消零写入回归；不操作真实账号 |
| N25 | 清空日志 | AdminModal.tsx:479 | 高，confirm | Dialog，失败保留原日志并可取消重试 | 管理员合成失败保留回归 |
| N26–27 | 日报列表重试/阅读页重发 | DailyReportsPage.tsx:186,471 | 高，confirm | Dialog，保留confirm请求参数与当前来源 | 已迁移/静态；没有真实重发 |
| N28 | 经历归档/恢复/永久删除 | library/ExperienceDetails.tsx:118 | 中/高，confirm | 可恢复动作Popover，永久删除Dialog | 已迁移/静态；版本及confirm字段保留 |
| N29 | 归档或删除未完成复盘/照片 | library/ExperiencePage.tsx:610 | 中/高，confirm | 按entryId分层；失败保留 | 已迁移/静态；不运行真实模型或照片 |
| N30 | 观点写入/拒绝草稿 | ResearchPage.tsx:94 | 高，confirm | Dialog，历史ready和版本前置保留 | 原研究证据失败/取消回归 |
| N31 | Settings站内跳转/浏览器返回 | hooks/useUnsavedContext.ts:26 | 高，同步confirm | 用户明确选择保留 | 原生dialog事件及自动化返回取消/接受仍验 |
| N32 | 旧ScheduleView删除 | ScheduleView.tsx:120 | 旧入口裸confirm | 无当前调用方，保留具名例外 | 静态消费者检索；不为归零扩大清理 |

U01 SettingsConfirmProvider及ContextEditor、Mail、CalDAV、Data、DailyReport、LibraryIntegration、Notification、Search、ChatGPT设置的11处confirm调用已经是应用内包装器，保留。U02退出登录与U03默认头像ConfirmDialog保留。U04清空/删除会话的两次点击迁移为Dialog；原useInlineConfirmation没有当前调用方，未扩大删除。U05 Dialog/Sheet/OrbitDialog生命周期保留，新增可选portalContainer；U06筛选、时间范围、帮助Popover保留；U07已有Toast/InlineNotice继续复用。U08未发现当前TDesign Message/Notification/Dialog/Popconfirm直接消费者。

## 系统能力例外

| ID | 入口 | 决定与验证边界 |
| --- | --- | --- |
| E01 | useUnsavedContext:55 beforeunload | dirty注册、save/cancel/unmount清理；保留真实刷新/关页保护 |
| E02 | BrowserNotifications:6 | 保留轮询系统通知；网页测试不证明系统展示 |
| E03 | CalendarView:1142,1159 | 保留权限及现有日程定时通知；不重写调度 |
| E04 | NotificationSettings:56 | 保留用户触发权限请求 |
| E05 | electron/main:157与preload:8 | 保留系统通知IPC；未发现当前前端消费者；没有MessageBox/Dialog调用，未运行Electron |
| E06 | AndroidNotifications:7 | 保留原生同步和通知点击导航 |
| E07 | MainActivity:162及开发者权限入口 | 保留通知权限、系统设置和精确闹钟授权 |
| E08 | NotificationSupport:70 | FCM/AlarmManager/Receiver和正式/本地试验渠道未改 |
| E09 | MainActivity:148,188,193 | WebView兼容提示和开发者试验原生面板保留；未做真机截图或送达验收 |

## Tools八处调用

| ID | P0调用位置 | 最终交互 | 证据边界 |
| --- | --- | --- | --- |
| T01–02 | poker-tracker/index.html:556,569 | 工具内新建/改名输入dialog | 新建、改名、空白非法输入与取消实际浏览器，失败不改存储 |
| T03 | poker-tracker/index.html:584 | 工具内危险确认，保留至少一个档案限制 | 实际取消及Escape，原存储保持 |
| T04 | poker-tracker/index.html:623 | 覆盖确认，取消不改JSON | 原有JSON往返与新增取消回归 |
| T05 | usage-dashboard/index.html:310 | 自动复制失败后只读可选择文本 | 拒绝剪贴板后实测只读且已选择可复制文字 |
| T06 | usage-dashboard/index.html:586 | 更新命令手工复制dialog | 合成拒绝剪贴板实际浏览器，不执行命令 |
| T07 | usage-dashboard/index.html:587 | textarea粘贴JSON，明确导入 | 合成拒绝剪贴板、输入/取消及焦点返回；真实解析一条合成daily数据 |
| T08 | alipay-growth-planner/index.html:701 | 就近role=status保存结果 | 原参数保存/恢复回归，计算与CDN不变 |

另外两个enabled Tools未检出上述原生调用；不由此推断其全部运行状态。修改仅在原工具中使用DOM/HTML dialog，不引入框架、改变存储键、JSON格式、slug或CSP。Tools发布包逐文件hash检查继续执行；受保护usage文件保持LF字节边界。

## 验证与视觉

- P1：类型、UI lint、11相关服务、Web build及文档检查通过；四尺寸明暗主题/统计实测。
- P2：7成长服务、9新增浏览器及10既有相关用例通过；成长专项65项通过，逐31快照检查数量、遮挡及有效连线。旧标题失败证据保留，迁移到当前真实入口后通过。
- Full：`npm run verify:full`通过，595/595服务测试、159/159浏览器测试，无跳过或flaky；类型检查、UI lint、完整Web/Electron构建、gallery排除、文档和diff检查通过。仅构建Electron代码并提供合法占位HTTPS，不启动Electron或接入外部服务。
- Full后仅补充测试：计划首错/保存失败、原生详情内Popover两项通过；Tools增加改名、非法输入、手工复制及JSON解析断言。最终`confirmations.spec.ts`12/12通过，类型检查重跑通过；595服务与其余未变化浏览器结果复用，不重复计算测试数量。
- 专项：成长65项（P2同一成长实现）、移动记事92项、原生6组、无日期待办四尺寸明暗通过。原生专项验证普通模式真实Settings confirm/beforeunload，以及自动化模式零意外原生弹窗；主站低频分支仍按上表区分静态和实测。
- 图形首屏、聚焦、统计、主题、放弃确认、失败留存与Tools均交付同尺寸候选截图；没有覆盖或批准黄金图。
- 系统权限弹窗不能用网页截图代替；原生confirm/beforeunload用真实事件记录类型、消息、接受/拒绝。生产、模型、自然任务、邮件收件箱和真机通知均未验。

## 性能与额外可访问性样本

最终构建在本地Edge、1440×900隔离合成账号采集CDP Performance计数、DOM MutationObserver和Long Task Observer。最新完整图保留42节点、63边：静止2017ms的DOM变更为0，LayoutCount增量0，ScriptDuration增量0，TaskDuration增量约1.88ms；12次节点聚焦完成于300ms，发生282条必要DOM变更，无记录到的长任务。播放第一站的2008ms区间（不跨阶段切换）DOM变更0，无长任务；调整至720×520后概览四组仍在、整页无横向溢出。这是单机短时样本，不等于通用性能承诺或React Profiler报告；结合无逐帧React计时器的源码确认，没有持续逐帧DOM更新证据。后台/离屏暂停及剩余时间复用已有受控时钟回归。

另以全新临时Chromium profile设置浏览器默认200%缩放，不修改用户profile、CSS zoom或模拟viewport。实际外窗1440px、内宽705px、DPR2、visualViewport.scale=1、CSS zoom=1；概览无整页溢出，低高度确认的取消按钮在可视区域，Escape保留草稿。截图由CDP直接采集完整surface，避免Playwright在浏览器缩放时按CSS尺寸裁切。四尺寸明暗、长文本、低高度、键盘和reduced-motion均已纳入实际回归；未进行真人屏幕阅读器验收。

## 失败留存、Git与交付边界

- P0旧成长Smoke因过期标题超时；改为真实入口并保留原行为覆盖后65项通过。首次共享确认验证发现Base UI的portal container=null不渲染，修正为缺省undefined并复验嵌套、失败与忙碌；未提高z-index绕过top layer。
- 后续复跑原生专项曾在多轮合成服务上捕获一次头像blob资源`ERR_FILE_NOT_FOUND`，6组确认已执行；使用全新临时数据服务后同一脚本6组通过。根因尚未定位，失败和成功证据均保留，不据此修改头像/通知链路，也不把这一失败写成通过。
- 本地checkpoint：P1 `8129591`（0.60.5-261020.1923）、P2 `655336d`（0.61.0-261020.1933）、P3 `9e23f42`（0.61.1-261020.1954）。分支为codex/evolution-notes-dialogs，后续P4仅审计/索引/状态文档，不改变应用版本。
- 本机可查看HTML报告保存同尺寸前后图、40张最终截图、嵌套确认/失败示例、200%截图和原始JSON；位置只在本机流水记录，运行产物不提交。用户视觉批准仍待审阅。
- 无新运行依赖，无服务API/数据迁移，无历史JSON、Android/Electron通知源码或黄金图变更。没有push、合并main、生产部署、真实AI、邮件发信或设备Push；不以本地通过替代这些外部验收。
