# 部署路径说明

本文是可以提交到仓库的部署路径总览，不包含凭据、真实生产数据、服务器连接信息或可直接运行的生产命令。实际执行前仍需检查当前源码、`AGENTS.md`、本机-only 的 `DEPLOY.md`、授权范围和生产 `.deploy` 记录。

## 先选路径

“正式”和“快速”不是两套质量标准。选择依据是线上依赖、运行环境和数据是否变化。

| 路径 | 适用条件 | 标准流程 | 何时停止并转另一条路径 |
| --- | --- | --- | --- |
| A：普通预构建升级 | 代码或样式变化；生产 `node_modules` 与目标版本依赖完全兼容；不改变 Node；兼容配置/新增表列按附加专项步骤核对 | 本地验证、构建、打包 → 上传暂存并核对 SHA-256 → 服务器备份与暂存检查 → 原子切换 → 分层验收，失败回滚 | 依赖声明/锁文件不一致、无法证明依赖可复用、Node 或不兼容运行配置变化、破坏性迁移且恢复条件不足 |
| B：依赖或环境变更升级 | 新增/升级依赖、锁文件改变、Node 变化、首次安装、运行环境重建或无法复用线上依赖 | 在兼容生产的 Linux 构建环境准备依赖并验证产物 → 独立暂存 → 服务器备份与受控切换 → 分层验收，失败回滚 | 构建环境、依赖安装或数据迁移条件未准备好时停止，不降级伪装成 A |

只有在排除根版本号差异后，`package.json` 与 `package-lock.json` 的依赖内容仍完全一致，且线上运行时与构建产物兼容时，A 才能复用线上 `node_modules`；描述或任务脚本的变化单独评估，不当作依赖变化。Windows 生成的依赖目录不能直接搬到 Linux。

路径 B 可使用 main 的 CI `orbit-linux-release` artifact 作为兼容 Linux 构建环境产物，流程和校验入口见 [发布流程](RELEASE.md#状态与幂等)。服务器只解包、校验、备份和切换；新依赖随产物进入暂存，旧依赖留在回滚代码目录。

Android 一期新增 `firebase-admin`，后端发布必须走路径 B，不能复用旧线上依赖。Firebase 服务账号文件放在 release 之外的私有目录，`ANDROID_PUSH_ENABLED` 与账号手机开关默认关闭；仅唯一 worker 在另行授权后启用。停写冷备覆盖 chat.db 的附加设备/投递表，回滚保留代码与数据库备份。APK 构建/安装、后端发布、真实 FCM 发送和 GitHub 发布分别授权；详情见 [Android 构建](../android/README.md)。

## 路径 A：普通预构建升级

项目成长另需服务端资源 `project-evolution/generated.json`；发布清单和暂存检查必须包含它，不得放入匿名静态目录。校验见 [项目成长说明](../project-evolution/README.md)。

### 准备条件

- 已明确本次代码部署授权；GitHub push、tag、Release、真实登录验收、Cloud 任务、邮件发送和收件箱验收分别授权，不因代码部署自动获得授权。
- 本地工作区、当前分支、目标 commit、版本号和依赖锁文件已核对；项目既有的 typecheck、测试和生产构建在本地完成。
- 已确认生产服务器不需要安装依赖、测试或构建。2 GB 生产机的普通升级不在服务器执行 `npm ci`、`npm test` 或 `npm run build`。
- 已准备唯一发布 ID、发布包清单、包的 SHA-256、备份位置和回滚目录；发布包排除 `.env`、`data/`、`node_modules/`、`.git/`、数据库、附件、备份和本机-only 文档。

### 步骤

1. 在本地完成类型检查、测试、生产构建和差异检查；生成不含生产配置、数据和依赖目录、但保留 `protected-tools/` 的归档包。
2. 记录归档包 SHA-256。上传到服务器临时位置后再次计算并比较哈希；只接受完全一致的包。
3. 在服务器做只读预检，确认服务、磁盘、现有 `data/`、生产配置、依赖目录和回滚空间可用；规范化比较依赖清单。
4. 完成暂存校验并停止唯一写进程后，备份生产配置和数据，保留到新版本完成验收之后；备份不下载回本地、不提交 Git。
5. 将归档包解压到独立暂存目录，检查入口文件、`dist/index.html`、静态资源和排除项；把已验证的生产配置、数据和依赖移入暂存目录。
6. 停止旧进程，将旧应用目录保留为回滚目录，再把暂存目录原子切换为应用目录。写入 `.deploy`，记录 `base_commit`、发布 ID、时间、来源和包哈希。
7. 重启进程并保存进程管理器状态。依次检查进程在线、健康接口、首页、`/today` 和实际静态 JavaScript：状态码应为 `200`，响应应是 JavaScript MIME（允许带 `charset`），内容不能是 HTML 且大小合理。
8. 保留旧目录、失败目录、日志和备份，直到人工确认本次结果；不要以“切换命令已执行”代替验收。

### 成功判据

代码部署只有在以下项目都通过后才记录为成功：包哈希一致；备份存在；`.deploy` 与目标版本一致；进程在线；健康接口正常；首页、`/today` 和实际静态资源可访问；旧目录和回滚材料仍可用。

这仍不等于登录、AI 业务、Cloud 日报、邮件发送或收件箱到达成功。它们必须按后文的独立验收边界处理。

### 回滚

如果启动失败、健康检查超时、进程不在线或静态资源验收失败：停止新进程，保留失败目录和日志；将生产配置、数据和依赖恢复到升级前的回滚目录，原子切回旧版本，重启并重新执行健康、首页和静态资源检查。确认恢复成功前不删除失败现场、回滚目录或备份。

## 路径 B：依赖或环境变更升级

### 准备条件与步骤

- 明确列出依赖、锁文件、Node、系统库、环境变量或构建工具的变化，并为每项写出兼容性、备份和回滚方案。
- 在兼容生产 Linux/Node 的构建环境安装并锁定依赖，完成 typecheck、测试、生产构建和包内容审查；不能把 Windows 的 `node_modules` 复制到 Linux。
- 仅有少量纯JavaScript包变化时，可以在独立Linux暂存目录复制已验证的旧运行时，再替换经lockfile SRI/归档哈希校验的官方包：必须证明完整锁定差异只包含这些包，依赖关系、平台条件、原生模块均不变，包无安装脚本，并逐个核对实际安装版本及Linux运行探针。原依赖保留回滚；任何条件无法证明则回到完整Linux构建路径。此方法不在生产目录安装、测试或构建。
- 对原生模块、Node ABI、系统库、内存和磁盘空间做实际验证；无法证明兼容时暂停发布或准备更合适的构建机/服务器资源。
- 生成独立归档包，按 A 的哈希、备份、暂存、原子切换和分层验收流程执行。服务器只有在资源已明确满足条件且获得专项授权时，才可采用受控的服务器安装流程；旧的服务器安装/构建脚本不是当前 2 GB 默认入口。
- 若涉及配置变化或首次安装，先在暂存环境验证启动、健康和静态资源；若涉及数据迁移，必须把迁移前备份、迁移顺序、旧代码读取能力和恢复步骤写入本次记录。

### 成功判据与回滚

除 A 的代码部署判据外，还必须证明新依赖/运行时已在兼容环境验证，配置变化已生效，迁移后的数据可被目标代码读取，且升级前应用仍可用。任一项失败都保留失败环境和日志，恢复升级前的代码、配置、依赖和数据；不能只切换代码目录来回滚已发生的数据结构变化。

## 数据、配置和版本记录

Daily Digest V2.5 增加 `sharp` 与 R2 S3 客户端，属于路径 B 的依赖变更。Windows 构建产物不能替代 Linux 上匹配架构的 sharp 可选二进制依赖；在兼容 Linux 环境按同一 lockfile 准备并验证解码/转换，再考虑生产切换。不得将本机 `node_modules` 直接覆盖 Linux 生产目录。

新版开关、许可文件和媒体保存方式见 [V2.5 合同](CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同)。关闭新版时同时设置 `DIGEST_V2_ENABLED=false`、`DIGEST_PRODUCTION_CONTRACT=daily-digest.v1`，后续恢复旧工具/发布；不自动重发当天日报，历史 V2 仍可阅读。回滚不得删除新增表、媒体镜像或已发布 R2 对象。正式切换前要确认图片采用不受临时对象生命周期影响的持久路径并可从备份恢复；R2 模式还需验证正式媒体域名，测试 r2.dev 不是生产配置证明。共享引用下架与 CDN 清除属于后续专项验收，不作为本次中期版统一前置。

数据迁移、配置变化属于部署的附加专项步骤，不是第三种日常路径。它们必须明确：

- 迁移前备份和可恢复性；
- 新旧代码对数据的读取兼容性；
- 迁移失败时的应用级恢复方法；
- 生产配置是否变化、谁授权、哪些业务路径没有验证；
- `.deploy`、连续记录和本地 Git commit 的对应关系。

GitHub push、tag 和 Release 是版本发布记录，和服务器部署分开记录、分开授权、分开验收。

## 受保护工具纯 HTML 快传路径

Tools 默认纳入源码和整站发布包，随应用版本发布和回滚，不采用 Knowledge Library 的独立外挂模式。完整发布前执行 `npm run tools:check`，解包后执行 `npx tsx scripts/check-protected-tools.ts <解包目录>/protected-tools`，清单或任一启用工具缺失/哈希不一致时阻止发布。

纯 HTML 快传仅为另行明确授权的例外；工具 HTML、标题、摘要及 CSP 必须先纳入源码且与输入完全一致，脚本拒绝仅存在于临时目录的文件版本。例外发布编号只用于审计，不代替应用版本和源码记录。先在本地审阅并纳入源码，再运行：

```powershell
pwsh -NoProfile -File scripts/prepare-protected-tool-release.ps1 `
  -InputPath .\new-tool.html `
  -Slug new-tool `
  -Title "新工具" `
  -Summary "工具用途说明" `
  -CspProfile inline
```

脚本只生成临时发布包 `protected-tools/manifest.json`、目标 slug 的 `index.html` 和 `release.json`，记录独立 `releaseId`、HTML SHA-256 与清单 SHA-256，不连接服务器、不修改生产目录。获得明确上传授权后，将这两个文件上传到服务器暂存目录，分别核对哈希；备份线上目标工具目录和清单，把暂存内容原子切换到 `protected-tools/`，再用真实登录会话核对 `/api/tools`、工具页面和回滚材料。服务器运行时按请求读取清单，因此纯 HTML 快传不需要 PM2 重启。

这条快速路径只适用于本人控制或已经审阅的 HTML；同域工具不是第三方插件沙箱。如果涉及 React、Express、API、认证、CSP 规则或运行时依赖，必须回到路径 A/B，重新走整站版本、预构建、备份和回滚流程。

## Daily Digest 独立 Shadow 服务

- 单独目录、系统用户、数据目录、端口、HTTPS 子域名及服务进程；禁止复用生产 `.env`、数据库、JWT 或邮件凭据。只配置专用测试 R2。
- 本地执行 `npx tsc -p tsconfig.shadow.json` 与客户端构建，打包编译后的 `server/`、关联 `src/`、`dist/`、`package.json`、`package-lock.json`。不打包本机依赖、配置、数据库或测试数据。
- 产品帮助索引由客户端构建生成于源码的 `server/.product-help.json`，另复制到 Shadow 发布包编译后的 `server/.product-help.json`；不得移入公共 `dist`。版本和原文 hash 与正式服务采用同一校验规则。
- 目标 Linux 独立目录按锁文件安装生产依赖，验证 sharp 解码与格式转换后，以 `node server/digest-shadow-server.js` 运行。安装与服务使用资源限制，不能在生产目录构建或安装。
- 独立 Nginx 站点只代理测试回环端口；单独证书，不替换原站点。语法检查后平滑 reload，前后检查原站点 health 与进程，测试账号验证登录及 OAuth/MCP。
- 回退只停用测试服务及其 Nginx 站点，保留数据与媒体恢复证据；不重启生产应用。配置、地址及部署快照只写被忽略的本机 runbook。
- HTTP、Linux sharp、R2、OAuth、Work 调用、逐条新闻配图与邮箱渲染分别验收；定向图片改进后在两个不同真实日期复核内容、图片和跨期运行。部署成功不代表 Cloud Shadow 完成。

## 固化的历史教训（通用）

- 远程脚本先使用 LF 换行，并在执行前做 shell 语法检查（例如 `bash -n`）；Windows 换行或 BOM 可能使远程入口在真正切换前失败。
- 静态文件的服务器磁盘路径与浏览器访问 URL 是两件事；必须检查实际映射，不要拿文件系统路径代替 URL 验收。
- 静态 JavaScript 的 MIME 检查允许合法的 `charset` 参数；应判断媒体类型，不要用过严的字符串相等误报失败。
- 归档包、上传文件和关键静态资源都要有哈希或内容核对；部署日志要能对应包、commit、`.deploy` 和回滚目录。
- `PM2 online`、HTTP `200`、`QUEUED` 或 SMTP accepted 只能证明各自那一层，不得写成登录成功、邮件进入收件箱或完整端到端成功。
- 旧入口若仍包含服务器安装、测试或构建步骤，只能作为历史/特殊路径参考，不能覆盖当前低内存默认流程。当前“一键部署”尚未固化为可自动化、可重复验证的统一入口。

## 验证状态与边界

| 状态 | 当前含义 |
| --- | --- |
| 已成功验证 | 本项目已有历史的本地预构建、上传核哈希、服务器备份、原子切换、进程/health/页面/静态资源验收证据；它证明该类流程曾成功，不代表当前 commit 已部署。 |
| 仅有方案 | 路径 B 的兼容 Linux 构建、依赖安装、环境重建和数据迁移原则已整理，但每次仍需按实际依赖和环境单独验证。 |
| 尚未自动化 | 一键选择路径、全自动依赖/环境变更发布，以及代码部署后自动完成登录、AI、Cloud、邮件和收件箱验收，均不视为已实现。 |

验收应分开记录：

1. 代码部署：包、哈希、备份、`.deploy`、进程、health、页面和静态资源。
2. 登录/AI：真实授权账号下的登录、核心日程/AI 对话和必要的浏览器回归。
3. Cloud 任务：运行中的 Work Prompt、服务端 contract、来源输入、媒体结果、dry-run 与正式发布状态。
4. 邮件发送：应用状态、队列状态和 SMTP accepted；这些不是收件箱到达。
5. 收件箱到达：通过 IMAP 读取实际 MIME，解析真实收件箱或对应归档文件夹；不能只查发送接口、队列、SMTP 或网页状态。

统一发布指令和效率原则见 [RELEASE](RELEASE.md)。旧 deploy.sh/deploy-continue.sh 默认拒绝安装路径，只有 --bootstrap / --server-install 的首次/明确资源例外且已获授权才运行。兼容新增表列不自动触发依赖重装，但须按下述附加迁移规则备份/验证。

本文件只说明路径和判据，不执行部署、不发送邮件、不创建或切换 Cloud 任务，也不保存任何凭据或生产数据。

## 受控运维记录与保留

`scripts/orbit-operations.py` 是运维 CLI，Python 标准库实现，不向 AI/HTTP 暴露执行入口；安装与服务修改仍需部署授权。示例配置、logrotate 和五分钟 systemd timer 位于 `scripts/operations/`，只含占位路径。实际文件名、当前路径、PM2 日志路径以及服务用户在被忽略的 DEPLOY.md 按盘点配置，不直接使用示例上线。

1. 将工具与配置放在 release 外，stateDir 同样必须在 releaseRoot 外。给应用设置 `ORBIT_OPERATIONS_DIR` 以读取 deployments/status/jobs JSON；stateDir 仅运维与应用身份可访问。主站负责共享 status/deployments，Shadow 使用自己的 job 状态目录，避免两个进程覆盖 jobs.json；不复制业务数据。启用后台任务的唯一写进程仍遵守原约束。
2. 部署前 `record --evidence <固定证据 JSON>` 写入 running，部署、保留操作共用非阻塞 operations.lock；存在 running 时跳过清理。中断的 running 必须核对实际进程/目录后人工记录 failed 或 rolled_back，不按时间猜测成功。record 输入只接受 main/shadow；配置不授予模型权限。
3. 验收完才 record success。checks 的 packageHash、backup、deploymentMetadata、process、health、homepage、today、staticAssets、rollbackMaterials、protectedTools 必须全部为 true，沿用本文件现有代码部署判据；登录/AI/Cloud/邮件验收独立。记录版本、commit、时间、恢复路径。旧目录搬移后以相同 attempt ID 更新 path 和恢复引用；未知历史仅记 unverified，不凭目录存在导入成功。
4. 成功 record 自动给出 retention dry-run。人工核对后可带 `--apply-retention` 执行；定时 `maintain --apply` 同样应用已审核配置。只执行 `maintain` 不删除任何文件。上线前保存 dry-run 清单，再启用 timer；首次导入旧目录逐个核验。

**成功旧版本：** main/shadow 各最多十个成功且可恢复旧版本，当前 resolve 后的运行路径始终排除。恢复资格包括完整 server/dist、版本匹配、依赖 hash 匹配的 Linux x64 runtime，以及仍存在的配置引用 configRef 和数据兼容恢复说明 dataRecoveryRef。配置和恢复说明只检查存在性，不读取凭据或业务数据库。失败、rolled_back、running、unverified 不占 slot；未核验目录留存，输出 RECOVERY_UNVERIFIED。清理只接受登记的 releaseRoot 直接子目录和固定前缀，拒绝符号链接、活动进程/打开文件、含数据库/数据/附件/媒体/配置的目录。进程可见性不足时保护目录。

共享 runtime 的 owning release 不可直接删除。`freeze-runtime --service main|shadow --source <已核验旧目录>` 仅打包 node_modules 到 stateDir/runtimes/<依赖 hash>.tar.gz，检查 Linux manifest 和内部链接边界，记录 archive SHA-256，并更新所有依赖该来源的恢复引用。恢复时先核 archive hash、依赖 hash 与 manifest，再在暂存目录恢复 node_modules 并跑既有运行探针；不要恢复到业务数据路径。档案不属于日志，也不被日志预算删除；无引用 runtime 暂不自动删，需以后只读核对。冷备、数据库、附件、媒体与用户文件均不在 release 清理范围。共享/活动/未核验保护可能暂时使目录总数超过十个，清单会明确原因，不能突破保护强凑数量。

**失败历史：** history API 按服务隐藏最近一次 success 之前的 failed，保留其他服务失败及后续失败。诊断层保留失败阶段与受控错误码七天，管理员 errors 查询仍可解释；过期维护只清失败诊断字段，保留最小审计元数据。人工删除且无剩余证据的旧事故不还原、不编造。

**受管日志：** application 保持现有 5 MiB × 四文件轮转。PM2、worker、部署和 diagnostics 只登记准确 active 文件名和已关闭 archive basename pattern，日志目录中的脚本/manifest/hash/recovery 证据不删除。Shadow 切换至专用 console 文件须在授权上线窗口配置 `StandardOutput=append:` / `StandardError=append:` 并受控重启；全机共享 journal 独立管理。PM2 原生 logrotate 配置参考 [官方说明](https://pm2.keymetrics.io/docs/usage/log-management/)，无需安装 PM2 插件。

五分钟维护调用固定 logrotate 配置（daily/maxsize/压缩/有限代数），再检查所有登记日志总量。超过 300 MiB 时先轮转正在写的 console 文件，按修改时间删除最老的已关闭日志至不超过 225 MiB；活跃/打开文件保留，降不到目标时记录 capacityWarning，不扩展删除范围。copytruncate 有短暂丢行窗口，关键部署结论/job 状态另有结构化记录，详见 [logrotate 文档](https://github.com/logrotate/logrotate/blob/main/logrotate.8.in)。application 仍由应用自管轮转，不同时被两个轮转器操作。运维调用同一 lock 和同一 logrotate state 文件，避免并发；不要把同一配置重复加入全机另一个 timer。

安装后验证：固定采集 status 能区分 main/shadow/worker；真实新部署 running→success 的记录与目录引用准确；dry-run 未列出活动目录/唯一依赖来源/业务文件；logrotate 继续写入且总量下降；诊断过期/容量告警可见。应用读取权限、Linux `/proc`、压缩与任务继续运行必须在生产另验，本地合成测试不能代替。
