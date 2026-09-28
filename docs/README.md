# AI Calendar 文档索引

- Status: LIVING
- Scope: 当前规范、操作手册、历史证据与工程验证入口。
- Last verified version: `0.36.3-260928.1303`（2026-09-28，个人关注输入状态与图片占位口径本地修复；未隔离部署，正式生产与发信未验）。
- Authority: 源码、自动测试与实际构建优先；仍有效的 AGENTS 硬约束其次。
- Update trigger: 新增/移动文档，修改 API、数据归属、媒体或验收规则。
- Supersedes: 无；现有文档路径保留。
- Do not use for: 推断生产已部署、Work 已同步、邮件已到达或授予执行权限。

## 当前规范与合同

Daily Digest V2.5 的字段、三种模式、R2/许可/恢复与隔离 Work 提示统一维护在 [Cloud 合同新版节](CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同)，阶段顺序见 [路线图](ROADMAP.md)，验收入口见 [测试矩阵](TEST-MATRIX.md)。D02 的[第一轮内容基线](DAILY-DIGEST-D02-QUALITY-BASELINE-20260927.md)、[定向校验回放](DAILY-DIGEST-D02-TARGETED-REPLAY-20260927.md)与[七期合成压缩回放](DAILY-DIGEST-SEVEN-DAY-SIMULATION-20260927.md)分开记录；本地开发与生产分层放行，七个真实日期不是统一前置，合成回放不能代替真实集成或上线验收。

Daily Digest V3 Core 的 Event/Revision/Evidence/Analysis、存储/账号备份、D07 登录态接口、D08 只读离线建议和 D09 第一步本地引用冻结统一维护在 [V3 Core 合同](DAILY-DIGEST-V3-CORE-CONTRACT.md)；D08 的 [第一轮](DAILY-DIGEST-D08-OFFLINE-EVALUATION-20260927.md)、[第二轮](DAILY-DIGEST-D08-OFFLINE-EVALUATION-R2-20260927.md)与[事实状态安全回归](DAILY-DIGEST-D08-FACT-STATUS-SAFETY-20260927.md)分别记录逐例结果。当前只对有界短摘录做限定抽取，仍无通用网页抓取、Work/MCP 写入、D09 人工纠正或正式日报接入，不改变 V2.5 当前运行合同。

D13 Research/Thesis 的本地状态、登录态接口、观点确认和备份边界见[研究与观点合同](DAILY-DIGEST-RESEARCH-THESIS.md)；真实 Agent 和 Work 结果回传尚未接通。

- [项目成长](../project-evolution/README.md)：顶部入口、历史数据、统计口径、架构快照和离线维护流程。
- [Daily Digest 15 张里程碑卡](ROADMAP.md#daily-digest-15-张里程碑卡2026-09-26-调整)：涵盖 V2.5 收口、V3 Core、Scheduled Events 与 Research/Thesis/Radar/Flash；按成果验收，一张卡可跨多次实施。除已单独授权完成的本地成果外，后续阶段仍须分别授权。

| 文档 | 职责 | 状态 |
|---|---|---|
| [AGENTS](../AGENTS.md) | Agent 安全、授权、协作和验证规则 | AUTHORITATIVE |
| [项目地图](../PROJECT-MAP.md) | 领域/跨项目边界与任务路由 | LIVING |
| [架构](ARCHITECTURE.md) | 当前运行时、数据所有权和实现边界 | LIVING |
| [日历数据人话版](CALENDAR-DATA-GUIDE.md) | 事项种类、填写字段、例子及兼容包袱 | LIVING |
| [测试矩阵](TEST-MATRIX.md) | 自动化、浏览器、生产各自能证明什么 | LIVING |
| [UI 规范](UI-GUIDELINES.md) | 布局、主题、交互与响应式要求 | AUTHORITATIVE / LIVING |
| [Cloud 日报](CHATGPT-WORK-CLOUD.md) | OAuth/MCP、内容、媒体和发布合同；末尾历史区单独标记 | CONTRACT |
| [V3 Core 事件记忆合同](DAILY-DIGEST-V3-CORE-CONTRACT.md) | S2-02 字段与状态；原活动库存储与备份；D07 接口；D08 离线双轴建议；D09 第一步本地引用冻结 | CONTRACT / LOCAL VERIFIED |
| [D13 研究与观点合同](DAILY-DIGEST-RESEARCH-THESIS.md) | Research 历史、Proposal 草稿、用户确认的 Thesis、账号备份及触发受限项 | CONTRACT / LOCAL SYNTHETIC |
| [知识库](LIBRARY.md) | 只读呈现、发布/生命周期 API 与本地加工规则；批次记录仅为历史 | FEATURE / CONTRACT |
| [CalDAV 单向桥接](CALDAV-BRIDGE.md) | 全量范围、完成与周期历史、来源归并、受控自动化及恢复合同 | CONTRACT / LOCAL VERIFIED |
| [路线图](ROADMAP.md) | 未来顺序；已完成条目不代替当前验证 | ROADMAP |

## 操作与验证

| 文档 | 使用场景 | 边界 |
|---|---|---|
| [根 README](../README.md) | 本地启动、功能和配置入口 | 版本以 package.json 为准 |
| [部署路径](DEPLOYMENT-PATHS.md) | 预构建升级与依赖/环境升级 | 不含生产凭据；实际部署另行授权 |
| [Cloud 排障](CLOUD-DIGEST-RECOVERY.md) | 生成模板、完整性及媒体分支不一致 | 运行中 Prompt 必须另行核对 |
| [知识库首次部署](KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md) | 首次配置、目标核对、令牌权限与验收 | 首次/切目标先 dry-run；已知目标普通 publish 规则保留 |
| [Bundle 测量](BUNDLE-BASELINE.md) | 首屏闭包、全部 JS/CSS、最大资源及 gzip | 观察指标，不是性能预算或浏览器耗时 |

本机 `AGENTS.local.md`、`DEPLOY.md`、`CONTINUOUS-REQUIREMENTS.md` 保持忽略，不复制到可提交文档。外部 Daily Report V2 与 Knowledge Library 工作树路径由本机配置提供。

- [荣耀 CalDAV 可行性研究与 POC](CALDAV-HONOR-POC.md)：隔离实验、字段缺口和真机门槛；本地协议通过不代表手机或生产同步通过。

## 历史快照与决策

| 文档 | 分类 | 不能用于 |
|---|---|---|
| [2026-09-28 个人关注与图文体验复核](DAILY-DIGEST-EXPERIENCE-REVIEW-20260928.md) | USER-REJECTED / LOCAL-CANDIDATE / ISOLATED-REVISION-BLOCKED | 将合成页面、图片样张或本地修复当有关注覆盖的新 Shadow，或宣布体验验收通过 |
| [2026-09-28 代表性图文 Shadow 评审](DAILY-DIGEST-REPRESENTATIVE-REVIEW-20260928.md) | REVIEW-SNAPSHOT / CONTENT-CONDITIONAL / VISUAL-BLOCKED | 把本地插画比例修复当隔离站已部署，或把插画覆盖当贴题真实新闻图片与用户阅读验收通过 |
| [2026-09-27 Daily Digest 计划与实现审计](DAILY-DIGEST-PLAN-AUDIT-20260927.md) | AUDIT-SNAPSHOT / PLAN-REVISED | 将结构校验当内容质量，或将后续本地开发放行当生产验收 |
| [2026-09-27 D02 第一轮内容质量基线](DAILY-DIGEST-D02-QUALITY-BASELINE-20260927.md) | REVIEW-SNAPSHOT / PARTIAL | 把同日修订算新日期、把空新闻格式合法当检索充分、把 P01 固定回放当真实日报或自动匹配 |
| [2026-09-27 D02 定向校验与固定证据回放](DAILY-DIGEST-D02-TARGETED-REPLAY-20260927.md) | VERIFICATION-SNAPSHOT / CONTENT-PARTIAL | 把合成校验通过当真实 Work 选题改善，或把空新闻提示当检索充分性证明 |
| [2026-09-27 V2.5 晚间增量隔离验收](DAILY-DIGEST-V25-EVENING-INCREMENTAL-20260927.md) | VERIFICATION-SNAPSHOT / ISOLATED | 把上午早版当晚间检查、把同日修订算新日期，或把 1 条部分核实新闻与插画覆盖当整体内容/许可放行 |
| [2026-09-27 七期合成日报压缩回放](DAILY-DIGEST-SEVEN-DAY-SIMULATION-20260927.md) | VERIFICATION-SNAPSHOT / SYNTHETIC | 把人工标准答案筛选当自动去重，或把七期模拟当七个真实日期及 R2 七日到期 |
| [2026-09-27 D08 第一轮离线匹配评测](DAILY-DIGEST-D08-OFFLINE-EVALUATION-20260927.md) | VERIFICATION-SNAPSHOT / OFFLINE | 把人工抽取的结构化字段或合成样例满分当真实 Work 自动匹配、D09 或生产放行 |
| [2026-09-27 D08 第二轮冻结规则盲测](DAILY-DIGEST-D08-OFFLINE-EVALUATION-R2-20260927.md) | VERIFICATION-SNAPSHOT / OFFLINE | 用零错合并掩盖会议字段抽取失败和真实进展漏判；本轮继续 D08 |
| [2026-09-27 D08 阶段事实安全修复](DAILY-DIGEST-D08-FACT-STATUS-SAFETY-20260927.md) | VERIFICATION-SNAPSHOT / OFFLINE | 把合成样本零错误事实外推成真实来源安全放行，或忽视 3 条阶段漏取与 70% 阶段未知 |
| [2026-09-05 Phase 1 审计](PHASE-1-AUDIT.md) | AUDIT-SNAPSHOT | 直接引用为当前文件规模/风险状态 |
| [2026-09-19 收口增量审计](CLOSEOUT-AUDIT-20260919.md) | AUDIT-SNAPSHOT | 推断依赖告警已修复、生产已部署或完整安全认证 |
| [2026-09-19 格式与安全修复](FORMAT-SECURITY-REPAIR-20260919.md) | VERIFICATION-SNAPSHOT | 推断生产已部署、真实邮件已验收或绝对无 bug |
| [2026-09-18 荣耀 CalDAV 初测](CALDAV-HONOR-POC-TEST-REPORT-20260918.md) | USER-TEST-SNAPSHOT | 推断手机更新删除、实际提醒和后台可靠性已通过 |
| [Settings V2 验证](SETTINGS-V2-VERIFICATION.md) | VERIFICATION-SNAPSHOT | 当前 HEAD 的浏览器验收 |
| [Calendar Design QA](../design-qa.md) | VERIFICATION-SNAPSHOT | 推断当前左栏布局或当前已验证 |
| [Cloud 历史运行](CHATGPT-WORK-CLOUD.md#cloud-run-history) | AUDIT / VERIFICATION-SNAPSHOT | 推断当前 Work 模式、生产版本或收件箱状态 |
| [2026-09-23 NASA 单图来源审核](DAILY-DIGEST-MEDIA-SOURCE-AUDIT-20260923.md) | AUDIT-SNAPSHOT / S1-R3a | 推断整站授权、下载/R2 成功或正式发布获准 |
| [2026-09-23 NASA 单图隔离技术验收](DAILY-DIGEST-MEDIA-R3B-VERIFICATION-20260923.md) | VERIFICATION-SNAPSHOT / S1-R3b | 推断真实 Shadow 引用、正式日报或邮件已完成 |
| [2026-09-23 媒体引用恢复与测试对象下架](DAILY-DIGEST-MEDIA-R4-RETIREMENT-VERIFICATION-20260923.md) | PARTIAL VERIFICATION-SNAPSHOT / S1-R4 | 推断 CDN 缓存清除或真实媒体下架已完成 |
| [2026-09-24 第一阶段证据与上线候选](DAILY-DIGEST-S1-R5-READINESS-20260924.md) | READINESS-SNAPSHOT / S1-R5 | 推断第一阶段整体通过、正式上线或真实邮件已验收 |
| [2026-09-24 邮箱空态修复验收](DAILY-DIGEST-S1-R6-VERIFICATION-20260924.md) | LOCAL VERIFICATION-SNAPSHOT / S1-R6 | 推断隔离服务已升级或真实邮件已到达 |
| [2026-09-24 V3 的 30 个真实来源基线](DAILY-DIGEST-V3-S2-01-CASES-20260924.md) | CASE BASELINE / S2-01 | 推断 V3 分类器已实现或自动回归已通过 |
| [Decision 0001](decisions/0001-phase-three-foundations.md) | 已接受的历史决策 | 把当时“无 CI”当成今天的结构 |

## 维护规则

Living/Contract 文档应标注 Status、Scope、Last verified commit/version、Authority、Update trigger、Supersedes、Do not use for。更新只证明列明范围，不能把源码核对写成生产核验。历史快照保留日期和原始结论，新增更晚证据时明确时间界限，不用追加记录悄悄改变前文“当前”的含义。

本阶段不全量移动目录或拆分合同；后续按确有重复和漂移的领域逐步整理，并核对入链。

- [Phase 2 前端加载边界验收](PHASE2-FRONTEND-LOADING.md)：0.21.1 本地实现、体积、浏览器证据与未验证边界。

- [Phase 3 数据写入与恢复可靠性](PHASE3-PERSISTENCE-RECOVERY.md)：四库写回、确认结果、恢复协议与故障验收。

- [Phase 4 应用工厂、运行时与低耦合路由](PHASE4-APP-RUNTIME-ROUTERS.md)：独立 HTTP fixture、五组 worker 生命周期、账号隔离与兼容性验收。

- [Phase 5 领域边界与迁移验收](PHASE5-DOMAIN-BOUNDARIES.md)：高耦合路由、数据库分层、等价 CSS 拆分及完整本地回归。

2026-09-20 四项修复的当前合同入口：[CalDAV](CALDAV-BRIDGE.md)、[Tools 发布](DEPLOYMENT-PATHS.md)、[提示词优化接口](ARCHITECTURE.md)、[验收矩阵](TEST-MATRIX.md)。生产结果另记本机连续记录。
