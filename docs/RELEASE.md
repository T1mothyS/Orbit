# Orbit 发布与部署流程

- Status: RUNBOOK / LIVING；2026-10-01 整理。
- Scope: 获得对应授权后的 main/tag/Release 与代码部署；不含服务器地址、凭据或真实用户数据。
- Authority: 当前 Git、package.json、实际测试和生产 .deploy；本机可执行细节在被忽略的 DEPLOY.md。

## 可复用任务指令

先只读核对 checkout、工作区、刷新后的 origin/main、目标 commit、package.json/lock 版本、现有 tag/Release，以及生产 .deploy、Node、依赖清单和配置变化。已经在 main 不制造 merge；有未提交工作先保护，不强行 reset。冻结目标后执行一轮本地 typecheck、测试、生产构建和差异检查；仅涉及相关合同时做跨项目验证，UI 实际变化才补对应浏览器验收。

按当前版本创建 annotated tag V<version>，推送 main 与 tag，创建或核对对应 GitHub Release，写明具体更新与验证边界；已存在且指向不同提交时停止，不覆盖 tag。根据线上依赖/运行环境证据选择 DEPLOY.md §8.1 或 §8.2，使用 2 GB 本地预构建包，核对双端 SHA-256、暂存清单与配置/数据恢复方案；停写后备份，原子切换，检查 PM2、loopback/public health、页面、实际 JS MIME/hash 与回滚材料。失败保留现场并恢复旧代码；涉及迁移时另核数据兼容性，不盲目覆盖新数据。

分别报告 Git、Release、代码部署、登录/AI、Cloud、SMTP 和 IMAP；未验的明确标未验。不得因代码部署主动发信或切换正式 Work 任务。

## 避免重复与慢步骤

| 项目 | 执行规则 |
| --- | --- |
| 本地检查 | 同一源码/锁文件只运行一轮；独立的类型与服务/跨项目测试可并行，构建与打包保持顺序。修复失败后只重跑受影响项；修改源码/依赖使相关旧证据失效。 |
| 文档提交 | 只改文档且应用/依赖/构建输入未变，可引用同一代码基线的验证并做链接/diff 检查；正式发布仍需有冻结目标对应的有效构建证据。 |
| tools/evolution | 已由 build:client 执行，不再为了形式额外重复同一源检查；解包后必须核发布内容。 |
| 依赖安装 | 已有与 lock 匹配的本地环境不每次 npm ci；生产 2 GB 不安装/测试/构建。依赖变更才在兼容 Linux 环境准备，不做未授权的 audit fix --force。 |
| 依赖判定 | 比较 dependencies/devDependencies/optional/peer、overrides、engines 和完整锁定包；忽略根版本字段及不影响运行的描述/任务脚本变化。以实际线上文件为准，不只对比 origin/main。 |
| 数据迁移 | A/B 由依赖和运行环境决定。兼容的新增表/列可以走 A 的附加迁移步骤，仍要停写备份、幂等测试、新旧读取和应用级回滚核对；无需因此重复安装依赖。 |
| 备份 | 解包、校验和健康预检先做；停止唯一写进程后备份，避免活库备份不一致。大附件压缩/可恢复空间不能跳过，记录耗时后再选择低压缩级别等已验证方案。 |
| 远程往返 | 将独立只读探针和切换/验收分别批量执行，明确阶段时间；上传一次已校验包，复用已证实的依赖，不重复传 node_modules。 |
| 等待 | 健康检查有明确超时；CI 有界查询并记录状态，持续不变时退避，不频繁轮询或把排队当成功。 |

旧 deploy.sh 仅 `--bootstrap` 运行环境首次准备；deploy-continue.sh 仅 `--server-install` 的首次/明确资源例外，仍需相应授权。日常升级不要调用这两个脚本。给出参数不替代人类授权。

Luna 上次为何慢，需要对应执行记录才能确认。当前可确认的潜在耗时是旧服务器安装/构建、重复检查、混杂的长文档、重复远程探针以及压缩备份。按阶段记录本地验证、构建、打包、上传、备份、切换/就绪时间；不能把模型速度、网络或服务器故障作为未经证实的根因。

## 状态与幂等

前端构建同时从现有 canonical 文档生成 `server/.product-help.json`；它不属于公共 `dist`，也不提交 Git。CI 暂存明确复制此产物；其他预构建打包入口也必须复制到包内同一位置。Linux release 准备核对索引版本和原文 hash，缺失或过期直接阻止发布。运维的 running/success/failed 记录、十个旧版与日志保留、配置/恢复引用见 [部署路径](DEPLOYMENT-PATHS.md#受控运维记录与保留)。成功前不得启动旧版删除；首轮服务器配置、timer 与 Shadow 日志切换需要单独上线验收。

依赖变化且本机为 Windows 时，main 的 CI 使用 Ubuntu 24.04/Node 22.23.2，完整校验通过后生成 `orbit-linux-release` 短期 artifact：冻结源码、前端构建和同一轮安装的 Linux `node_modules`（包含 PM2 使用的 tsx）。构建机验证 sharp/PDF/Office 加载；manifest 记录 commit/version/源文件哈希，完整包另有 SHA-256。下载后核对 workflow head、成功状态、包 hash 与 manifest，再按路径 B 在生产暂存并做运行时探针。该 CI 不保存生产凭据，也不自动部署；生产旧依赖保留用于回滚。

如果变化仅限可证明的纯JavaScript补丁，可以采用[路径B受控暂存条件](DEPLOYMENT-PATHS.md#路径-b依赖或环境变更升级)，复用未变化的Linux原生运行时；完整锁定差异、SRI、无安装脚本、平台及实际版本/运行探针必须同时通过。不把Windows依赖复制到Linux，也不因部署授权自动执行GitHub push。

- main/tag 已同步且服务器目标 commit/包/配置相同且验收有效时，只做复核，不再切换重启。
- 没有对应 Release 时创建；已有同 tag 时核对/更新说明，不新建重复 Release。
- GitHub Actions 是可移植的独立检查；其状态单列，不能替代本次本地/服务器证据。
- 未经审核的保留策略不删除旧目录、失败现场或备份；当前保留机制见部署路径，冷备和业务数据始终排除。不替换用户运行中的 Work Prompt/时间/收件人。
- 生产业务验收与部署是不同结果，具体判据见 [部署路径](DEPLOYMENT-PATHS.md)和 [测试矩阵](TEST-MATRIX.md)。
