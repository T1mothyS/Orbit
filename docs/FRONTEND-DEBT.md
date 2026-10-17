# Orbit 前端迁移台账

- Status: LIVING；应用版本以 package.json 为准。
- Authority: 源码、测试与实际浏览器；此表不替代验收结果。
- Update trigger: 区域迁移、旧实现删除或验证边界变化。

## 当前入口和迁移去向

主链为 `main.tsx → App.tsx → AppShell/page → components/hooks/services → API`。Web、Electron、Android 在线 WebView 共用前端；没有 PWA 离线业务。后端为 `index.ts → application.ts → routes/领域服务 → 四个 sql.js 数据库`。领域定位仍以 [PROJECT-MAP](../PROJECT-MAP.md) 为入口。

| 区域 | 当前事实与问题 | 目标、影响与验证重点 | 优先级 / 状态 |
| --- | --- | --- | --- |
| 视觉基础 | design/ui/Gallery 已建立，旧区域尚有 TDesign | A 已批准；Windows Chromium 黄金图已启用，Linux 待补 | P1 / A 已确认 |
| 设置入口 | 独立 /settings 和账户页；其他分类仍转既有入口 | C 批次完成统一路由、共享状态并删除旧容器 | P1 / 迁移中 |
| 设置数据 | 资料/日报共用 Context，通知/日报邮件共用 preference，但状态分散 | 父路由单一所有者、领域草稿/版本冲突保护 | P0 / 待迁移 |
| 账号安全 | 改密、共享认证、账户/头像页已实现 | CAS/持久化/失效/独立授权已本地验证；账户视觉待 B | P0 / 待 B |
| Shell/搜索 | AppShell、GlobalSearch、账户菜单 | 统一入口、焦点/主题/公共控件，保留六业务导航 | P2 / 待迁移 |
| AI/记事/附件 | AiSchedulePanel、useOrbitChat、NoteBoard、附件 hooks | 沿现有状态机提取呈现；保留确认/队列/取消/草稿 | 后续第 1 批 |
| 周期/今日 | ReminderPage、ActionCenterPage、OrbitDialog | 表单/完成/部分成功/恢复，不混入领域重写 | 后续第 2 批 |
| 知识/经历 | library 子模块、阅读与确认保存 | 列表/详情/筛选/编辑，保护引用、隔离、阅读恢复 | 后续第 3 批 |
| 日报/研究/统计 | DailyReportsPage、ResearchPage、ProjectEvolutionPage | 保留 Local/Cloud、来源、投递合同，统一操作层 | 后续第 4 批 |
| Calendar | 已有 calendar 子模块，仍有复杂视图 | 按视图和状态拆分，日期/拖动/冲突专项回归 | 后续第 5 批 |
| Admin/登录/Tools 外壳 | 低频表格、认证表单和门禁 | 权限/危险确认/注册/Tools Cookie 不变 | 后续第 6 批 |

原档案修正：Settings 已有分区和 ID；移动聊天/筛选/记事板已有独立布局；已有规范、多尺寸脚本和架构文档，缺统一阻断和批准基线。Orbit 自管密码，ChatGPT 是独立 Provider；sessions 表是聊天会话。Calendar 直接使用 date-fns，原先却只依赖 concurrently 间接安装；此次显式声明并验证既有函数的本地日期边界。

## 兼容退出台账

| 临时实现 | 现有使用方 | 删除条件 |
| --- | --- | --- |
| design/legacy.css 的旧变量映射 | 未迁移业务 CSS/TDesign | 最后使用方迁移并验证后删除 |
| TDesign/icons/main 全局样式 | 现行设置、Admin、Login 等 | 全部调用方退出后删除依赖与覆盖 |
| 原 OrbitDialog/CompactFilterSheet/SegmentedControl | 周期/今日、筛选、聊天 | 对应批次迁入 ui 后删除原实现 |
| 旧设置容器/模块页 | App、搜索、历史链接 | V3 统一适配并切换时删除容器 |
| ui:lint 历史基线 | 未迁移控件和样式 | 随迁移减少，禁止新区域例外和 CI 自动扩充 |

2026-10-18 清理：全仓调用检索确认旧 `.tool-detail-card` / `pulse-border` 只有自身 CSS，已删除。`.chat-markdown blockquote` 的边线用于引用识别，保留；设计检测器无法按 selector 豁免，故通过其 CLI 仅对 foundation.css 的 side-tab 添加文件范围例外，理由记录在 `.impeccable/config.json`。这不表示其他卡片可以使用强调侧边线；新体系仍受 UI 规范和其他检测约束。

账户迁移已删除旧 AccountSettings/AvatarSettings 及相应头像/上传样式，没有保留第二套账户编辑器。`features/settings/navigation.ts` 中其他分类暂时指向原设置；这是 B→C 间的入口适配，C 必须替换并删除旧容器，不作为长期双轨。`/settings/profile` 和共享 Cloud/通知草稿的所有权仍在 C 批次，不由账户页面代为保存。

## 暂缓边界

不改 sql.js/数据库写回、Provider/队列和正式确认规则、Android FCM/AlarmManager 核心、PWA/离线、全局请求框架、登录 refresh/session 新体系。未知 legacy 先核对调用，不能因外观删除业务。计数用于定位；成功以 [UI 规范](UI-GUIDELINES.md)、[测试矩阵](TEST-MATRIX.md)及 A/B/C 实际确认判断。
