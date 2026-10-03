# Orbit 文档索引

- Status: LIVING；2026-10-03 核对基础升级入口。此索引只负责导航，不复制任务、版本或生产状态。
- 权威次序：源码/实际验证 → 领域合同 → 当前任务状态；历史报告按原日期解释。版本只读 package.json。

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
| [根 README](../README.md) | 产品简介、启动、主要导航 |
| [用户指南](USER-GUIDE.md) | 配置、日常使用、备份和排障 |
| [发布流程](RELEASE.md) | 可复用发布指令、冻结目标、效率与验收层级 |
| [部署路径](DEPLOYMENT-PATHS.md) | 预构建/依赖变更/特殊路径和回滚判据 |
| [项目地图](../PROJECT-MAP.md) | 模块/跨项目边界与源码路由 |
| [测试矩阵](TEST-MATRIX.md) | 验证入口、风险范围和 UI/生产/业务证据边界 |
| [UI 规范](UI-GUIDELINES.md) | 布局、主题、响应式、聊天/Motion 与体验升级实施规则；逐块状态见 TASKS |

本机 AGENTS.local.md、DEPLOY.md、CONTINUOUS-REQUIREMENTS.md 保持忽略。DEPLOY.md 的执行地址/细节和本机记录不复制到仓库或发布包；连续记录按末尾追加，不归并重写历史。

## 当前领域合同与操作

| 文档 | 范围 |
| --- | --- |
| [架构](ARCHITECTURE.md) | 运行时、持久化、账号所有权、队列/草稿、Provider/工具、OAuth 和共享附件 |
| [日历数据](CALENDAR-DATA-GUIDE.md) | 事项/周期/日期语义及历史兼容包袱 |
| [Cloud 日报](CHATGPT-WORK-CLOUD.md) | OAuth/MCP、Local/Cloud、V2.5 输入/内容/媒体与正式发布合同 |
| [Cloud 排障](CLOUD-DIGEST-RECOVERY.md) | Prompt/模板/完整性/媒体分支核对 |
| [V3 Core](DAILY-DIGEST-V3-CORE-CONTRACT.md) | Event/Revision/Evidence/Analysis、D07、D08 双轴与 D09 本地冻结 |
| [Research/Thesis](DAILY-DIGEST-RESEARCH-THESIS.md) | Research → Proposal → 确认版本、租约/备份和真实通道限制 |
| [知识库](LIBRARY.md) | 本地加工/关系/校验/发布、网页只读与生命周期、阅读/引用 |
| [知识库首次部署](KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md) | 首次/切目标核对与令牌权限；普通 publish 沿原授权边界 |
| [CalDAV 桥接](CALDAV-BRIDGE.md) | 单向投影、周期/完成/归并、锁/自动化/恢复 |
| [CalDAV POC](CALDAV-HONOR-POC.md) | 可行性和隔离操作；真机结果为日期证据 |
| [Bundle 测量](BUNDLE-BASELINE.md) | 资源测量方法；旧数据只作历史基线 |
| [项目成长](../project-evolution/README.md) | 工程历史/生成数据与个人统计的分离 |
| [Decision 0001](decisions/0001-phase-three-foundations.md) | 已接受的历史架构决策 |

## 维护规则

一个事实一个主要来源：顺序放 route，状态放 TASKS，变更放 CHANGELOG，接口/行为放领域合同，流程放 Runbook，逐次证据放 archive 或本机记录。历史文件只做路径迁移和入链修正，结论变化在当前任务清单/新证据说明，不能悄悄改写旧报告。新增/移动/合并时核对入链和原始材料，评测输入稳定路径保持不变。旧 ROADMAP 保留跳转入口，不另维护第二套计划。
