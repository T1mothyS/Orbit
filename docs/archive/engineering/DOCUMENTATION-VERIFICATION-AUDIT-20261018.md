# Orbit 文档、测试与历史维护审计（2026-10-18）

- Status: DATED AUDIT；原始基线 14a400b / 0.58.5-261018.1018；本次版本 0.58.6-261018.1322；本地代码验证与后续帮助文档定向回归分开记证。
- 范围：Git 跟踪与待提交文档、文档机器消费者、隔离测试、历史记录维护；不观测生产、真实 AI/邮箱/手机，不授予发布权限。

## 现状与处理

初始 75 个文档/说明/许可/机器文本候选，共 1,065,879 字节；其中 69 份 Markdown。当前文件数量不作为优化目标。TASKS 与 TEST-MATRIX 的原文按日期完整封存，除链接外正文校验一致；活跃规范只保留执行方法和仍需跟踪的缺口。

初步 Markdown 链接检查 511 条，目录链接不是坏链；发现的旧 SettingsDialog 源码引用已改为当时可验证的提交。迁出的测试/任务证据入链同步修正。project-evolution 的旧路径按 commit:path 验证，未改历史 JSON；评测输入路径保留。

重复与漂移：PROJECT-MAP 的 API 表/验证命令转为合同和矩阵链接，任务路由前置；用户指南旧 Dialog/敏感输入保留和旧资料入口已纠正；旧 Work 运行状态改指 Cloud 合同，原记录已存在于 9 月运行归档；TASKS 中旧容量和 Android 后台失败结论按已有后续证据纠正，未验项保留。LIBRARY 的个人绝对工作路径改为逻辑工作区说明。route 的核对日期同步，未改变产品优先级。

ARCHITECTURE 和 Cloud 的详细接口/并发/媒体/安全规则有独立价值，保留关键文件路径和完整合同，不按长度拆分。Cloud 增加按主题定位；AGENTS 只维护阅读/验证/授权边界，不复制领域 API。

## 测试成本与覆盖

以下为同一 Windows/Node 24.14.1 本地环境的优化前单次 wall time；未把并行用例耗时相加，也未假称冷 OS 缓存。

| 项目 | 单位与结果 | 耗时 | 截图/启动说明 |
| --- | --- | --- | --- |
| 服务 | 578 个用例通过 | 34.768s | 112 个测试文件；不是 578 个断言 |
| Playwright | 48 个用例通过 | 40.963s | 首个用例前 12.201s；122 个平台基线比较目标，另外落盘 6 张 PNG，不能合并当截图总次数 |
| 业务 Smoke | 92 个检查项通过 | 31.698s | 落盘 66 张 PNG；独立新合成数据库 |
| 原生弹窗 | 6 个检查组通过 | 28.510s | 落盘 5 张 PNG；普通原生和合成引导分别验证 |
| typecheck / UI lint | 通过 | 18.921s / 1.161s | 与用例数量无直接换算 |
| tools / evolution | 通过 | 0.699s / 0.645s | 已在 build 内运行，不另加一轮 |
| 隔离配置 Web / Electron 构建 | 通过 | 2.230s / 1.577s | Web 使用 envDir=false；不作为标准 npm build 的等价耗时 |

首次隔离构建的测量命令附带 --input-type=module，导致 Less worker 的 require 不可用；去掉该测量参数后通过，未修改业务或构建配置。默认 4183 已被其他进程使用，改用新的空闲端口，未停止或复用该进程。

Linux 当前基线 CI 39091053997 / 14a400b 已实际成功：安装 30s、类型 20s、服务 74s、构建 7s、UI 86s、Linux 包准备 42s。优化后远端 CI 需另行 push 授权，本次不把本地 Full 说成远端运行。

套件覆盖映射及保留/运行时机见 [当前矩阵](../../TEST-MATRIX.md#覆盖映射与测试增长)。本次不删除既有测试，不把服务与浏览器同主题当可删重复；未完成逐条等价证明，重复比例不报百分比。15 个浏览器 Smoke 保留，日常按领域选择，Full 保留完整服务/Playwright，Release 再跑业务和原生保护。

## 归档原文校验

| 来源 | 原文件 SHA-256 | 除链接外正文 SHA-256 |
| --- | --- | --- |
| docs/TASKS.md | 3108e5d5585bf8880d84cc70929df6db7f27c1fbe74043f51adfae11c28c607d | f50ddc49089f69d52840b04e6e91b3114916fa9755e6670e5437a4d46a68e0d7 |
| docs/TEST-MATRIX.md | e195e417dc0a879c047c2381332eb6ca909ebcdc8ff47698e2c446fab275559a | 39ff3efd7523f62263fd56e4da5fc7d3d3ce88e76b7d459256297e3732084ee8 |

本地持续记录另以原始字节区间重建验证，含混合换行；备份、月卷和恢复日志只存在于已忽略的本地目录，不进入此报告或 Git。运行时脚本对 unknown/乱序/已存在月卷/外部改动拒绝覆盖。

## 完整初始文档清单

最近日期为基线中的最后提交日期，不是每份文档都已重新验收的日期。使用者中“Agent/维护者/用户/追溯者”按文档职责推定；机器消费者是路径文字检索候选，七份帮助输入和历史成长/评测读取另经源码确认。

| 原路径 | 用途 / 推定读者 | 字节 / 行 | 最后提交 | 当前 Markdown 入链数 | 机器消费者候选 |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | 协作安全 / Agent | 10414 / 133 | 2026-10-18 | 2 | .github/workflows/ci.yml、scripts/prepare-linux-release.mjs |
| CHANGELOG.md | 使用或维护 / 用户及维护者 | 44798 / 380 | 2026-10-18 | 8 | scripts/history-maintenance.mjs、server/maintenance-scripts.test.ts |
| PRODUCT.md | 使用或维护 / 用户及维护者 | 6443 / 71 | 2026-10-08 | 2 | 未见直接路径引用 |
| PROJECT-MAP.md | 状态与定位 / Agent及维护者 | 22263 / 187 | 2026-10-18 | 6 | 未见直接路径引用 |
| README.md | 使用或维护 / 用户及维护者 | 5466 / 77 | 2026-10-18 | 2 | server/maintenance-scripts.test.ts、infra/caldav-poc/prepare-bundle.ps1、project-evolution/curated.json、project-evolution/generated.json |
| android/README.md | 使用或维护 / 用户及维护者 | 8407 / 60 | 2026-10-08 | 9 | 未见直接路径引用 |
| assets/fonts/OFL.txt | 许可或机器资源 / 工具 | 4480 / 94 | 2026-09-30 | 0 | 未见直接路径引用 |
| assets/fonts/README.md | 使用或维护 / 用户及维护者 | 515 / 6 | 2026-09-30 | 0 | 未见直接路径引用 |
| docs/ARCHITECTURE.md | 领域合同 / 对应开发任务 | 64589 / 362 | 2026-10-18 | 17 | scripts/verify.mjs、server/maintenance-scripts.test.ts、scripts/build-product-help.mjs |
| docs/BUNDLE-BASELINE.md | 使用或维护 / 用户及维护者 | 4908 / 70 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/CALDAV-BRIDGE.md | 领域合同 / 对应开发任务 | 15991 / 94 | 2026-09-20 | 7 | 未见直接路径引用 |
| docs/CALDAV-HONOR-POC.md | 使用或维护 / 用户及维护者 | 12447 / 107 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/CALENDAR-DATA-GUIDE.md | 领域合同 / 对应开发任务 | 8144 / 86 | 2026-09-30 | 6 | 未见直接路径引用 |
| docs/CHATGPT-WORK-CLOUD.md | 领域合同 / 对应开发任务 | 69078 / 342 | 2026-10-17 | 21 | scripts/verify.mjs、project-evolution/curated.json、project-evolution/generated.json、scripts/build-product-help.mjs |
| docs/CLOUD-DIGEST-RECOVERY.md | 领域合同 / 对应开发任务 | 10320 / 66 | 2026-10-17 | 5 | 未见直接路径引用 |
| docs/DAILY-DIGEST-RESEARCH-THESIS.md | 使用或维护 / 用户及维护者 | 7476 / 55 | 2026-10-08 | 7 | project-evolution/curated.json、project-evolution/generated.json |
| docs/DAILY-DIGEST-V3-CORE-CONTRACT.md | 领域合同 / 对应开发任务 | 27414 / 122 | 2026-10-01 | 10 | project-evolution/curated.json、project-evolution/generated.json |
| docs/DEPLOYMENT-PATHS.md | 使用或维护 / 用户及维护者 | 21535 / 163 | 2026-10-17 | 10 | scripts/verify.mjs、scripts/build-product-help.mjs |
| docs/FRONTEND-DEBT.md | 使用或维护 / 用户及维护者 | 4877 / 44 | 2026-10-18 | 8 | 未见直接路径引用 |
| docs/KNOWLEDGE-LIBRARY-FIRST-DEPLOYMENT.md | 领域合同 / 对应开发任务 | 6807 / 104 | 2026-09-13 | 1 | 未见直接路径引用 |
| docs/LIBRARY.md | 领域合同 / 对应开发任务 | 23488 / 249 | 2026-10-18 | 10 | scripts/verify.mjs、server/maintenance-scripts.test.ts、scripts/build-product-help.mjs |
| docs/QUICK-START.md | 使用或维护 / 用户及维护者 | 2306 / 24 | 2026-10-18 | 4 | scripts/verify.mjs、server/maintenance-scripts.test.ts、scripts/build-product-help.mjs |
| docs/README.md | 使用或维护 / 用户及维护者 | 6575 / 64 | 2026-10-18 | 5 | 未见直接路径引用 |
| docs/RELEASE.md | 使用或维护 / 用户及维护者 | 6950 / 48 | 2026-10-18 | 8 | scripts/verify.mjs、deploy-continue.sh、deploy.sh、project-evolution/curated.json、project-evolution/generated.json、scripts/build-product-help.mjs、server/system-assistant.test.ts |
| docs/ROADMAP.md | 使用或维护 / 用户及维护者 | 529 / 11 | 2026-10-01 | 0 | 未见直接路径引用 |
| docs/TASKS.md | 状态与定位 / Agent及维护者 | 37266 / 199 | 2026-10-18 | 12 | project-evolution/curated.json、project-evolution/generated.json |
| docs/TEST-MATRIX.md | 使用或维护 / 用户及维护者 | 106950 / 551 | 2026-10-18 | 10 | server/maintenance-scripts.test.ts、project-evolution/curated.json、project-evolution/generated.json |
| docs/UI-GUIDELINES.md | 使用或维护 / 用户及维护者 | 25338 / 178 | 2026-10-18 | 10 | 未见直接路径引用 |
| docs/USER-GUIDE.md | 使用或维护 / 用户及维护者 | 42891 / 439 | 2026-10-18 | 5 | scripts/verify.mjs、server/maintenance-scripts.test.ts、scripts/build-product-help.mjs、server/system-assistant.test.ts |
| docs/archive/README.md | 历史证据 / 按需追溯 | 6246 / 50 | 2026-10-09 | 8 | project-evolution/curated.json、project-evolution/generated.json |
| docs/archive/caldav/CALDAV-ASTRA-REVIEW-REPORT-20260919.md | 历史证据 / 按需追溯 | 13404 / 216 | 2026-10-01 | 1 | 未见直接路径引用 |
| docs/archive/caldav/CALDAV-HONOR-POC-TEST-REPORT-20260918.md | 历史证据 / 按需追溯 | 7251 / 168 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/digest/CLOUD-RUN-HISTORY-20260909-20260914.md | 历史证据 / 按需追溯 | 11534 / 69 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-D02-QUALITY-BASELINE-20260927.md | 历史证据 / 按需追溯 | 8297 / 38 | 2026-10-01 | 5 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-D02-TARGETED-REPLAY-20260927.md | 历史证据 / 按需追溯 | 4913 / 33 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-D08-FACT-STATUS-SAFETY-20260927.md | 历史证据 / 按需追溯 | 6896 / 47 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-D08-OFFLINE-EVALUATION-20260927.md | 历史证据 / 按需追溯 | 8480 / 68 | 2026-10-01 | 5 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-D08-OFFLINE-EVALUATION-R2-20260927.md | 历史证据 / 按需追溯 | 10823 / 75 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-EXPERIENCE-REVIEW-20260928.md | 历史证据 / 按需追溯 | 9359 / 74 | 2026-10-01 | 1 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-MEDIA-R3B-VERIFICATION-20260923.md | 历史证据 / 按需追溯 | 3822 / 32 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-MEDIA-R4-RETIREMENT-VERIFICATION-20260923.md | 历史证据 / 按需追溯 | 4403 / 34 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-MEDIA-SOURCE-AUDIT-20260923.md | 历史证据 / 按需追溯 | 4307 / 30 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-PLAN-AUDIT-20260927.md | 历史证据 / 按需追溯 | 8784 / 80 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-PLAN-REVIEW-20261006.html | 历史证据 / 按需追溯 | 34156 / 374 | 2026-10-06 | 1 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-REPRESENTATIVE-REVIEW-20260928.md | 历史证据 / 按需追溯 | 11071 / 75 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-S1-R5-READINESS-20260924.md | 历史证据 / 按需追溯 | 6689 / 35 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-S1-R6-VERIFICATION-20260924.md | 历史证据 / 按需追溯 | 1768 / 18 | 2026-10-01 | 1 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-SEVEN-DAY-SIMULATION-20260927.md | 历史证据 / 按需追溯 | 4143 / 31 | 2026-10-01 | 3 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-SOURCES-SHADOW-20261006.md | 历史证据 / 按需追溯 | 24152 / 150 | 2026-10-06 | 5 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-V25-EVENING-INCREMENTAL-20260927.md | 历史证据 / 按需追溯 | 6604 / 37 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/digest/DAILY-DIGEST-V3-S2-01-CASES-20260924.md | 历史证据 / 按需追溯 | 4830 / 34 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/engineering/CLOSEOUT-AUDIT-20260919.md | 历史证据 / 按需追溯 | 8034 / 66 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/engineering/FORMAT-SECURITY-REPAIR-20260919.md | 历史证据 / 按需追溯 | 5354 / 48 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/engineering/ORBIT-INTERACTION-MOTION-AUDIT-20261003.md | 历史证据 / 按需追溯 | 50717 / 388 | 2026-10-03 | 2 | 未见直接路径引用 |
| docs/archive/engineering/ORBIT-UI-MOTION-VERIFICATION-20261004.md | 历史证据 / 按需追溯 | 8452 / 60 | 2026-10-04 | 5 | 未见直接路径引用 |
| docs/archive/engineering/ORBIT-UI-UX-AUDIT-20261008.md | 历史证据 / 按需追溯 | 19002 / 185 | 2026-10-08 | 1 | 未见直接路径引用 |
| docs/archive/engineering/ORBIT-UI-UX-HARDEN-REGRESSION-20261009.md | 历史证据 / 按需追溯 | 8859 / 50 | 2026-10-09 | 4 | 未见直接路径引用 |
| docs/archive/engineering/PHASE-1-AUDIT.md | 历史证据 / 按需追溯 | 6066 / 43 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/engineering/PHASE2-FRONTEND-LOADING.md | 历史证据 / 按需追溯 | 5204 / 71 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/engineering/PHASE3-PERSISTENCE-RECOVERY.md | 历史证据 / 按需追溯 | 8423 / 95 | 2026-10-01 | 4 | 未见直接路径引用 |
| docs/archive/engineering/PHASE4-APP-RUNTIME-ROUTERS.md | 历史证据 / 按需追溯 | 6329 / 72 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/engineering/PHASE5-DOMAIN-BOUNDARIES.md | 历史证据 / 按需追溯 | 6643 / 83 | 2026-10-01 | 2 | 未见直接路径引用 |
| docs/archive/engineering/SETTINGS-V2-VERIFICATION.md | 历史证据 / 按需追溯 | 6963 / 73 | 2026-10-01 | 1 | 未见直接路径引用 |
| docs/archive/engineering/TEST-MATRIX-20261001.md | 历史证据 / 按需追溯 | 36763 / 193 | 2026-10-01 | 8 | 未见直接路径引用 |
| docs/archive/engineering/design-qa.md | 历史证据 / 按需追溯 | 2893 / 44 | 2026-10-01 | 1 | 未见直接路径引用 |
| docs/archive/plans/ROADMAP-20261001.md | 历史证据 / 按需追溯 | 38064 / 205 | 2026-10-01 | 8 | 未见直接路径引用 |
| docs/decisions/0001-phase-three-foundations.md | 使用或维护 / 用户及维护者 | 1647 / 21 | 2026-09-05 | 1 | 未见直接路径引用 |
| infra/caldav-poc/README.md | 使用或维护 / 用户及维护者 | 7404 / 71 | 2026-09-18 | 3 | 未见直接路径引用 |
| infra/caldav-poc/requirements.txt | 许可或机器资源 / 工具 | 400 / 18 | 2026-09-18 | 0 | 未见直接路径引用 |
| project-evolution/README.md | 使用或维护 / 用户及维护者 | 9060 / 85 | 2026-10-06 | 7 | 未见直接路径引用 |
| prompts/daily-report-cloud-v2-production.md | 使用或维护 / 用户及维护者 | 9540 / 18 | 2026-10-17 | 2 | 未见直接路径引用 |
| protected-tools/evolution-slider/VERSION.txt | 许可或机器资源 / 工具 | 18 / 2 | 2026-10-17 | 0 | 未见直接路径引用 |
| protected-tools/evolution-slider/assets/fonts/OFL.txt | 许可或机器资源 / 工具 | 4376 / 94 | 2026-10-17 | 0 | 未见直接路径引用 |
| protected-tools/evolution-slider/使用说明.txt | 使用或维护 / 用户及维护者 | 581 / 12 | 2026-10-17 | 0 | 未见直接路径引用 |
| route.md | 状态与定位 / Agent及维护者 | 4490 / 47 | 2026-10-18 | 9 | server/maintenance-scripts.test.ts、project-evolution/curated.json、project-evolution/generated.json |

## 最终执行与测量

### 活跃文档与历史完整性

| 活跃文件 | 原字节数 | 现字节数 | 净缩减 |
| --- | --- | --- | --- |
| AGENTS.md | 10414 | 10707 | -2.8% |
| PROJECT-MAP.md | 22263 | 13511 | 39.3% |
| CHANGELOG.md | 44798 | 17978 | 59.9% |
| docs/TASKS.md | 37266 | 14738 | 60.5% |
| docs/TEST-MATRIX.md | 106950 | 11219 | 89.5% |

CHANGELOG、TASKS、TEST-MATRIX 三份合计从 189,014 降至 43,935 字节，净缩减 76.8%。AGENTS 因新增分级与归档边界增加 293 字节，不把缩短篇幅作为目标；默认阅读由逐份加载改为规则/任务路由/元数据后按域读取。任务路由标题从第 128 行前置至第 14 行，八类主要任务的合同及源码入口静态存在性检查通过。未运行八个独立新 Agent 的对照实验，不估算 Token 节省。

Git 文档候选由 75 增至 79：新增两个原文快照、一个版本历史卷和本次审计，保留完整历史。总量由 1,065,879 变为 1114127 字节；总量增长不等于日常必读内容增长，不能报告为全仓库文档缩减。

CHANGELOG 本次归档 32 个带时间标记的旧版本条目及既有短版本/阶段摘要；活跃窗口保留 20 条，含本次新增版本。日期交叉及相同短版本的不同完整时间标记保持原顺序，不合并或补造日期。两个封存原文的非链接正文 hash 与原件一致；原文备份和归档脚本的源 hash 检查另行保留。

本地流水将 8 月 30 条日期记录按原字节迁移，活跃文件在追加本任务记录前由 978,915 降至 925,245 字节：迁移正文 53,959 字节、索引新增 289 字节，净减少 53,670 字节（5.5%）。9 月仍在整月保留窗口，不强行拆分。重复 apply 返回空 files，force-scan 校验与恢复用合成资料完成；本机原件/月卷未进入 Git。日期边界已知，无未处理的乱序或未知边界；不由归档关闭任何未验任务。

### 实测耗时与重复执行

最终 Release 命令退出 0，包含 Full，单次总耗时 195.722s：

| 步骤 | 结果 | wall time |
| --- | --- | --- |
| typecheck | 通过 | 18.486s |
| ui-lint | 通过 | 1.008s |
| build | 通过 | 6.109s |
| service | 通过 | 33.203s |
| playwright | 通过 | 47.147s |
| gallery-exclusion | 通过 | 0.078s |
| docs | 通过 | 0.643s |
| mobile-compact-browser-smoke | 通过 | 44.231s |
| native-dialog-browser-smoke | 通过 | 38.358s |
| diff | 通过 | 0.079s |

服务 587/587（原有 578 个全部保留，加 9 个维护脚本用例），Playwright 48/48，业务 92 个检查项及原生弹窗 6 组通过；截图阈值、重试和批准平台基线均未放宽。初轮 Release 的全部业务检查通过，但最终 diff 因 CHANGELOG 尾部空行失败；修复滚动输出并补充断言后，新基线重新通过 Release。失败证据保留，没有把重跑改记为首轮成功。

其后真实 HTTP 检查发现密码问题首条命中资料偏好；只给密码操作增加独立标题并加强首条命中断言。按帮助输入依赖执行 Quick：索引生成、21 个相关服务用例（包括 9 个维护用例）、generated 检查及 diff 全通过，复用本任务中未受影响的类型/构建/浏览器/业务结果，没有为一处文档标题再跑 Full。最终 150 个索引片段（28 个普通用户、122 个管理员），七个来源路径不变。匿名 401、未知参数 400、普通用户隐藏技术合同、管理员可查合同；五类常见问题都在真实 HTTP 中首条命中对应说明，索引没有进入 dist。

普通文档 Quick 三次为 1.145 / 1.020 / 1.030s，中位数 1.030s，仅文档和 diff；这是基于影响范围减少无关执行，不能当作相同覆盖下的测试引擎加速。最后的帮助标题调整实际省去了重复完整类型、Web/Electron 构建、48 用例浏览器矩阵和两组完整业务套件，只重跑帮助所依赖的 21 个用例。

Gallery 同一 15 个用例，三次旧配置 32.107 / 29.906 / 28.322s，新配置 30.501 / 30.904 / 29.248s；中位数 29.906 → 30.501s，无法确认 wall time 收益，不宣称提速。确定减少的是每次服务启动 2 → 1：三轮由 6 次降为 3 次，Gallery 不再启动无关业务 API/临时数据库。六轮都没有失败、跳过或 flaky；Full 仍启动所需两套服务，Release 每个可变 Smoke 仍用独立数据库。

同一最终 Release 内 typecheck、服务、完整 Playwright 和 build 各一轮；tools/evolution 在 build 内执行，未额外调用独立一轮。既有发布手册原本已有“不重复”原则，不能凭本次改动声称历史每个任务都重复执行了固定次数。总 Release 耗时没有可比的统一旧整链基准，不报告节省比例。

### 断言口径、其余套件和未验证内容

原基线 AST 静态调用点：服务 112 文件 / 4,042 个 assert/expect 调用点，Playwright 3 文件 / 163 个，浏览器 Smoke 15 文件 / 275 个。这些不是运行时断言总数，循环、helper 和子进程会改变实际次数；运行时断言数没有统一可靠采集，未用其推算耗时或覆盖。没有逐条等价证明的跨层检查不删除，未报告虚构重复率。

| 浏览器脚本 | 保护目标与运行时机 | 本轮耗时口径 |
| --- | --- | --- |
| android-notification-browser-smoke.cjs | Android 设置/通知上下文；相关变更与平台验收 | 未复跑，不推断当前通过或耗时 |
| browser-smoke.cjs | 早期全站脚本，旧入口/fixture 需复核；非默认闸门 | 未复跑，不推断当前通过或耗时 |
| connected-report-browser-smoke.cjs | 通知关联、个人报告与统计；相关领域变更 | 未复跑，不推断当前通过或耗时 |
| digest-research-browser-smoke.cjs | Research/Thesis 确认链；相关领域变更 | 未复跑，不推断当前通过或耗时 |
| library-preferences-browser-smoke.cjs | 旧资料编辑专项，需按 Settings V3 复核；保留原文件 | 未复跑，不推断当前通过或耗时 |
| mobile-compact-browser-smoke.cjs | 六业务页、记事/图片/筛选/阅读/导出；Release及相关变更 | 44.231s，实际通过 |
| native-dialog-browser-smoke.cjs | 真实 confirm/beforeunload 与合成引导；Release及相关变更 | 38.358s，实际通过 |
| note-word-browser-smoke.cjs | 富文本复制/导出；相关变更，目标编辑器另验 | 未复跑，不推断当前通过或耗时 |
| orbit-chat-controls-browser-smoke.cjs | 聊天清空/删除/草稿与失败；相关领域变更 | 未复跑，不推断当前通过或耗时 |
| product-assistant-browser-smoke.cjs | 旧设置目标假设与 canonical URL 不一致；保留但非默认，导航风险由现行 settings/system-assistant 保护 | 未复跑，不推断当前通过或耗时 |
| project-evolution-browser-smoke.cjs | 共享项目成长与页面状态；相关变更 | 未复跑，不推断当前通过或耗时 |
| prompt-optimize-browser-smoke.cjs | 记事原位优化/撤回/冲突；相关变更 | 未复跑，不推断当前通过或耗时 |
| reader-plan-browser-smoke.cjs | 阅读返回、滚动与计划草稿；相关变更 | 未复跑，不推断当前通过或耗时 |
| tools-browser-smoke.cjs | 受保护 Tools、认证与资源；相关变更 | 未复跑，不推断当前通过或耗时 |
| unscheduled-browser-smoke.cjs | 无日期待办与历史；相关变更 | 未复跑，不推断当前通过或耗时 |

本次不运行真实模型、发信、收件箱、手机、生产恢复、外部独立日报仓库或 Android/Electron 原生安装验收。新版本远端 Linux CI 未运行（未 push）；已知通过的是原 14a400b 的 CI，不能移作本次成功证明。CI 修改仅新增文档/索引完整性步骤，保留原完整类型、服务、构建、UI 和 Linux 包准备；无任务缓存或降低范围的路径。

### 维护成本与失败恢复

新增 3 个小 CLI（docs-check、verify、history-maintenance）与 6 个 npm 入口，复用现有帮助生成、测试和浏览器配置；没有新依赖、文档平台、定时服务、缓存系统或通用归档框架。新增影响领域未映射时自动 Full；新增面向用户的帮助章节需要显式标记和查询回归；保留窗口仅由归档脚本/Runbook维护。维护测试保护选择升级、权限/常见问题、链接、混合字节/幂等、备份/中断/并发与路径保护，不扩展平行 UI 套件。

备份与单个 pending 事务只服务这项滚动维护，现有月卷不覆盖；中断时按原 hash 回滚，外部修改保留并拒绝覆盖。普通日常 history:check 只看大小/小状态/精简版本表，不把巨型流水或历史月卷加入 Agent 上下文。每月或阈值触发才扫描；备份和月卷不自动删除。

Git 最终建立本地 checkpoint，分支 codex/docs-test-history-maintenance；未 push、合并、tag、Release、部署或发信。原始流水按授权只在本地追加，公开报告不包含其私人正文。
