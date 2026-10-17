# Orbit 前端迁移台账

- Status: LIVING；应用版本以 package.json 为准。
- Authority: 源码、测试与实际浏览器；此表不替代验收结果。
- Update trigger: 区域迁移、旧实现删除或验证边界变化。

## 当前入口和迁移去向

主链为 `main.tsx → App.tsx → AppShell/page → components/hooks/services → API`。Web、Electron、Android 在线 WebView 共用前端；没有 PWA 离线业务。后端为 `index.ts → application.ts → routes/领域服务 → 四个 sql.js 数据库`。领域定位仍以 [PROJECT-MAP](../PROJECT-MAP.md) 为入口。

| 区域 | 当前事实与问题 | 目标、影响与验证重点 | 优先级 / 状态 |
| --- | --- | --- | --- |
| 视觉基础 | 多层 foundation、页面控件、TDesign，权威分散 | design 单一 token、ui 统一 API；Portal/主题及旧页面回归 | P1 / 待 Checkpoint A |
| 设置入口 | 已有分区、搜索、稳定 ID，但弹窗/模块页并存 | 一个中心，旧 URL/ID/action 可达，删除旧容器 | P1 / 待迁移 |
| 设置数据 | 资料/日报共用 Context，通知/日报邮件共用 preference，但状态分散 | 父路由单一所有者、领域草稿/版本冲突保护 | P0 / 待迁移 |
| 账号安全 | bcrypt/JWT/auth_version，缺改密 | 原子更新及旧登录失效；独立授权保留，无 schema migration | P0 / 待实现 |
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

## 暂缓边界

不改 sql.js/数据库写回、Provider/队列和正式确认规则、Android FCM/AlarmManager 核心、PWA/离线、全局请求框架、登录 refresh/session 新体系。未知 legacy 先核对调用，不能因外观删除业务。计数用于定位；成功以 [UI 规范](UI-GUIDELINES.md)、[测试矩阵](TEST-MATRIX.md)及 A/B/C 实际确认判断。
