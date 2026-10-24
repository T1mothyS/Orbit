# Orbit 文档索引

- Status: LIVING；只负责导航，不复制版本、当前任务或生产状态。
- 开发任务先读 [PROJECT-MAP 的任务路由](../PROJECT-MAP.md#按任务选择入口)，再按标题定位必要章节；产品操作见 [快速上手](QUICK-START.md)或站内 /help。
- 一个事实一个主要来源：路线看 route，状态看 TASKS，版本看 CHANGELOG，行为看领域合同，执行方法看 TEST-MATRIX/Runbook，日期证据看 archive。源码和实际验证优先，历史只对原时点成立。

## 路线、更新与任务

| 文档 | 唯一职责 |
| --- | --- |
| [route.md](../route.md) | 阶段顺序、范围与暂不做事项 |
| [CHANGELOG.md](../CHANGELOG.md) | 具体版本成果及验证边界 |
| [TASKS.md](TASKS.md) | 已修复、部分完成、待修复/待验收与完成条件 |
| [archive/README.md](archive/README.md) | 历史报告分类和旧路径对照；原证据日期/结论保留 |

## 协作、使用和发布

| 文档 | 唯一职责 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 协作、授权、安全、验证与文档维护规则 |
| [产品上下文](../PRODUCT.md) | 长期人群、目的、工作流和产品原则；供 impeccable 使用，不维护视觉方案或验收状态 |
| [根 README](../README.md) | 产品简介、启动、主要导航 |
| [用户指南](USER-GUIDE.md) | 配置、日常使用、备份和排障 |
| [Android 构建](../android/README.md) | 工具链、APK、固定站点、Firebase 配置与原生本地试验入口 |
| [发布流程](RELEASE.md) | 可复用发布指令、冻结目标、效率与验收层级 |
| [部署路径](DEPLOYMENT-PATHS.md) | 预构建/依赖变更/特殊路径和回滚判据 |
| [PVE 迁移](migration/MIGRATION-PLAN.md) | 家庭 VM 迁移计划、[检查表](migration/MIGRATION-CHECKLIST.md)、[切换/回滚](migration/MIGRATION-RUNBOOK.md)、[执行报告](migration/MIGRATION-REPORT.md)及[性能与代理专项报告](migration/PERFORMANCE-AND-PROXY-REPORT.md)；真实入口只在本机 runbook |
| [项目地图](../PROJECT-MAP.md#按任务选择入口) | 按任务选择合同、源码、测试与升级范围 |
| [测试矩阵](TEST-MATRIX.md) | Quick/Full/Release、领域覆盖、UI/平台及外部证据边界 |
| [UI 规范](UI-GUIDELINES.md) | 布局、主题、响应式、聊天/Motion 与体验升级实施规则；逐块状态见 TASKS |
| [前端迁移台账](FRONTEND-DEBT.md) | 入口、迁移目标、风险、优先级和旧实现退出条件；开发方法见 UI 规范的 Agent Change Playbook |
| [UI / Interaction / Motion 专项审计（2026-10-03）](archive/engineering/ORBIT-INTERACTION-MOTION-AUDIT-20261003.md) | 原审计时点的日期快照与方案；当前逐批实施状态见 [TASKS](TASKS.md#uiuxmotion-体验升级执行清单)，不改写历史结论 |
| [UI/UX 八项加固定向回归（2026-10-09）](archive/engineering/ORBIT-UI-UX-HARDEN-REGRESSION-20261009.md) | 针对前次八项问题的修复、独立复审和本地证据；不重新评分全站，不代表部署或真机验收 |

本机 AGENTS.local.md、DEPLOY.md、CONTINUOUS-REQUIREMENTS.md 及 .local-docs/ 月卷/备份保持忽略。DEPLOY.md 的执行地址/细节和本机记录不复制到仓库或发布包；连续记录按末尾追加，按 [经验证的流程](archive/README.md#滚动维护流程)完整滚动迁移，不归并或改写历史。

[2026-10-04 UI / Motion 实施验收](archive/engineering/ORBIT-UI-MOTION-VERIFICATION-20261004.md)：后续 1–7 项实现、逐态证据、发布和设备边界。

[2026-10-20 记事、成长与确认专项审计](archive/engineering/ORBIT-SPECIAL-UI-AUDIT-20261020.md)记录本轮调用清单、保留例外与本地验证边界；当前交互规则以UI规范和成长合同为准。

## 当前领域合同与操作

| 文档 | 范围 |
| --- | --- |
| [架构](ARCHITECTURE.md) | 运行时、持久化、账号所有权、队列/草稿、Provider/工具、OAuth 和共享附件 |
| [日历数据](CALENDAR-DATA-GUIDE.md) | 事项/周期/日期语义及历史兼容包袱 |
| [Cloud 日报](CHATGPT-WORK-CLOUD.md) | OAuth/MCP、Local/Cloud、V2.5 输入/内容/媒体、Shadow 原稿回读、三来源候选/拓展阅读与正式发布合同 |
| [Cloud 排障](CLOUD-DIGEST-RECOVERY.md) | Prompt/模板/完整性/媒体分支核对 |
| [V3 Core](DAILY-DIGEST-V3-CORE-CONTRACT.md) | Event/Revision/Evidence/Analysis、D07、D08 双轴与 D09 本地冻结 |
| [Research/Thesis](DAILY-DIGEST-RESEARCH-THESIS.md) | Research → Proposal → 确认版本、租约/备份和真实通道限制 |
| [知识库](LIBRARY.md) | 本地加工/关系/校验/发布、文章只读与生命周期、阅读/引用、个人资料及日报偏好入口 |
| [知识库首次部署](KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md) | 首次/切目标核对与令牌权限；普通 publish 沿原授权边界 |
| [CalDAV 桥接](CALDAV-BRIDGE.md) | 单向投影、周期/完成/归并、锁/自动化/恢复 |
| [CalDAV POC](CALDAV-HONOR-POC.md) | 可行性和隔离操作；真机结果为日期证据 |
| [Bundle 测量](BUNDLE-BASELINE.md) | 资源测量方法；旧数据只作历史基线 |
| [项目成长](../project-evolution/README.md) | 工程历史/生成数据与个人活动报告的分离 |
| [Decision 0001](decisions/0001-phase-three-foundations.md) | 已接受的历史架构决策 |

## 维护规则

一个事实一个主要来源：顺序放 route，状态放 TASKS，变更放 CHANGELOG，接口/行为放领域合同，流程放 Runbook，逐次证据放 archive 或本机记录。历史文件只做路径迁移和入链修正，结论变化在当前任务清单/新证据说明，不能悄悄改写旧报告。新增/移动/合并时核对入链和原始材料，评测输入稳定路径保持不变。旧 ROADMAP 保留跳转入口，不另维护第二套计划。
