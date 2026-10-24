# Cloud 日报生成与发布排障手册

- Status: RUNBOOK
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verification: 2026-10-20，补充排版非阻塞排障；2026-10-17，补充云端拒绝、连接失效和排程边界；V2 Run 阶段核对方法沿用 2026-10-08，历史媒体诊断与完整模板隔离测试仍按 2026-09-19 的 `0.27.2-260919.1711` 时点使用。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本手册用于诊断生成端与服务端合同不一致。历史问题是定时提示遗漏邮件简报、金融与市场及观察名单；历史运行状态见 [Cloud 文档的快照区](CHATGPT-WORK-CLOUD.md#cloud-run-history)。修正实际云端提示词与可执行解析/渲染测试必须一起交付，不能只部署校验器。本手册不证明当前 Work 提示或生产版本已同步。

排版提示按 [Cloud 渲染合同](CHATGPT-WORK-CLOUD.md#发布与阅读)处理：`EMPHASIS_REQUIRED` / `EMPHASIS_INVALID` 不阻断发布。核对回执的 `valid/errors` 与 `warnings/reviewIssues`；只剩加粗建议时可以直接继续发布，不因未修好而丢弃整期。若实际任务仍要求“强调查核全部通过”，须按同一发布授权同步仓库 production Prompt 并回读实际任务；先确认服务器也已采用非阻塞规则，不能把尚未部署的修改当作已生效。

- 外部日报 V2 项目的 `prompts/cloud_scheduled_task.md` 与插件副本 `references/scheduled-task.md` 属于 V1 兼容完整模板；服务端合同以 `server/daily-digest-contract.ts` 和 `read_inputs.markdownContract` 为准。正式 `daily-digest.v2` 的提示来源为 [production Prompt](../prompts/daily-report-cloud-v2-production.md)，服务端使用 `digest-v2-contract.ts` 和 `read_inputs_v2` 返回的 schema/manifest。两种 Prompt 与服务端合同版本分别核对，不互相替代，也不从历史版本号推定当前一致。
- 修改后须在实际云端任务保存并重新打开核对版本、全文及原频率，不能把本地文件更新视作云端已同步。
- 在 `DAILY_REPORT_V2_ROOT` 指向相应 V2 checkout 后运行 `npm run test:cross-project`。测试使用提示内的完整示例，经过生产解析器、完整性闸门以及 HTML/纯文本渲染，覆盖两封邮件、市场和两项观察对象。
- Cloud 发布仅托管正文明确提供的图片/来源图标，不根据来源名称自动访问 favicon。无 `mediaBatchId` 时逐图 Best Effort，失败项降级为空图片位并返回 `candidateImageCount`、`mediaFailureCount`、`mediaFailures`；当前兼容代码允许成功图片数为零，不能把它描述为完整媒体成功。带批次时必须满足 READY、账号/日期/运行归属和完整媒体校验，不能套用兼容降级。两条路径均保持正文完整性硬闸门。
- 生产 Shadow 可用明确标注的结构测试夹具验证合同；这不代表真实新闻生成或真实邮件投递验收。必须显式 `dry_run=true`，并核对历史未新增。
- 真实补发及收件箱验收分开记录。旧日报缺失的内容不会由模板修复追溯补齐。

残余风险：公开图片可能失效，兼容路径如实记录降级，严格批次失败则阻止发布；模型遗漏内容仍由完整性闸门阻止；定时提示是独立保存的配置，必须核对运行端。`dry_run=true` 不写日报或邮件队列，但兼容媒体托管可能写文件。正式发布、SMTP 和收件箱分别验收。

## V2 Run 发布错误与部分成功核对

`MEDIA_EVIDENCE_MISMATCH` 表示某条新闻的 `media_ids` 指向图片，但该图片的 `media.evidence_id` 未同时出现在本条新闻的 `evidence_ids`。全局 evidence 存在该图片条目仍不够；应把对应图片证据与原事实证据取并集、去重，保留全部事实来源、新闻与图片。新版诊断返回真实 `market/macro/stories` 路径及缺少的证据 ID；schema 与 production Prompt 也明确该关系。校验器不修改原稿或放宽引用检查。相邻日期排查仍以原 run 的 cutoff/输入和正式历史为准，不能用新输入冒充历史恢复。

先固定原 runId、日期与失败调用的内容 hash，只读该次 manifest 事件和相同账号/日期的 artifact、正式 report、去重通知状态。不得把 MCP `Internal error` 或网页无记录直接判定为未到达服务端，也不得用第一次失败解释第二次调用。阶段顺序是 `MEDIA_PREPARING → MEDIA_PREPARED → REPORT_SAVED → PUBLISHED`；`FAILED.failedPhase`、媒体 code/stage/reason/attempts 与最后成功事件共同定位。

若停在媒体准备且无 artifact/report/通知，则尚未发布/入队；先核对原图片的可达性与许可，再在获授权恢复时复用原内容。若已有保存记录或通知，先核对内容 hash、正式/候选状态及去重记录，不重复发布或发送。PUBLISHED、QUEUED、SMTP accepted、收件箱到达分别记录，缺失证据直接标未知。图片失败的既有有界重试不能替代故障诊断，硬闸门不得放宽；无可复现代码缺陷时不增加猜测性补丁。真实重跑、补发与收件箱检查仍需分别授权。

## 云端拒绝、连接失效与排程边界

1. 先区分三个独立来源：本站校验/媒体/保存错误、云端工具动作安全拒绝、连接认证失效。本站没有 run 或发布事件只能定位请求尚未到达，不能据此推断安全拒绝。读取实际 Work 报错，再与相同 run 的服务端阶段对齐；拿不到被拒绝的参数或审核详情时，不猜具体触发词或断言误判。
2. 本人私有日报可以摘要正常邀请、公开活动安排及普通待办；保留原文必要事项、时间和动作，不把邀请推断为已参加、正式日程或用户当前位置。只省略凭据、私有标识/联系信息、个性化登录链接及无关私人细节，保持每个输入 ID 可追溯。不能将已授权的普通邮件一概空泛化，也不把平台拒绝当作可以绕过的限制。
3. 日报执行不得调用排程更新、暂停、禁用或删除工具。任何失败只停止当前执行并报告阶段、错误及保存/队列状态；平台强制暂停或要求重新授权时如实报告，由用户/维护流程恢复，不能承诺 Prompt 可以阻止平台行为。
4. 连接显示过期时，只核对原账号/client 的 scope、创建/到期/最近使用/撤销时间等元数据，不读取或回显令牌。刷新令牌为 30 天闲置窗口；成功刷新自动续期，已过期/撤销或账号禁用仍须按原授权登录。重连须核对原账号、原 scope 及持续刷新权限，不能擅自扩大权限。Work 省略 `offline_access` 时，本站会把该账号对此 client 曾批准的持续刷新权限重新列入 consent，只有本次明确同意后才签发新令牌；不恢复旧令牌，其他账号/client 不继承。首次授权未申请该权限则仍不会签发刷新令牌，不能凭“已连接”推断获得长期刷新能力。
5. 重连可能恢复挂起的旧执行。先核对是否有执行正在继续及是否已有日报/通知，避免非预期提前发布或重复发送；恢复连接、恢复排程和重跑/补发分别记录。回读实际保存的 Prompt、任务开启状态、频率和下一次时间，保留更新前的可恢复副本。

## 连续无图的定位顺序

先取对应运行回执的 `candidateImageCount`、`imageCount`、`mediaFailureCount` 和 `mediaFailures`，再看正式正文/渲染 DOM，不只看 PUBLISHED：

| 证据 | 优先排查 |
|---|---|
| 候选 0，成功 0，失败 0 | 生成端未提交图片；检查运行提示和实际选图步骤 |
| 候选大于 0，成功 0，有失败明细 | MIME、签名、SSRF、下载或上传失败，按具体原因处理 |
| 旧版有图，后续 UPDATED 无图 | 同日正文被更新；不是浏览器自动丢图 |
| 正文包含图片，但 DOM 没有 | 解析/渲染规则 |
| DOM 有图片但 naturalWidth 为 0 | 图片 URL、网络、权限、响应类型和 CSP |

本地 0.27.2 起，新正文版本保存有界媒体统计，具体字段、重试与恢复语义见 [Cloud 合同](CHATGPT-WORK-CLOUD.md#markdown-合同与解析诊断)。旧版本、dry-run 和未变正文的后续尝试不补写历史统计；仍需区分工具回执与任务摘要。不得将“日志没找到”当成“从未失败”。修改运行中的定时提示需授权并回读核对，不能自动重发历史或发送邮件。

## 多来源取图与缺图前置检查

先看 `validate_v2.imageBindings`：`market/macro/stories` 的总数与绑定数必须一致，不能把单个栏目的4/4当整期就绪。启用照片账号的空绑定直接返回 `STORY_IMAGE_BINDING_REQUIRED` 与实际路径；修绑定后仍需确认最终媒体下载/托管，`mediaReadiness=unobserved` 不代表成功。

找图支持原页 `pageUrls`、Commons/Openverse以及Bing/百度发现；完整字段、来源核对和NC账号配置只维护在 [照片合同](CHATGPT-WORK-CLOUD.md#shadow-自动资料照与专用代理)。先用具体主体词，再有界扩展产品、设施或地点；不相关的演员、聚会、Logo不能因许可正确而算贴题。`candidates` 与待复核 `discoveries` 分开；`review_required` 不代表搜索无结果，也不代表允许直接发布。302/403/429或浏览器渲染缺口不能伪装为已经接通；可沿返回搜索链接人工智能浏览器补查，再传原来源页核对。不为修一个来源关闭所有校验或改全局代理。

仅做公开关键词的本地媒体专项试跑：

```powershell
npx tsx scripts/digest-photo-source-smoke.ts --query CoreWeave --date YYYY-MM-DD --noncommercial --out .local-docs/photo-smoke-new
```

`--date` 改为实际目标日期；`--page` 可追加已找到的公开原页面，`--story-id`/`--run-id` 仅是诊断关联，不会读取或修改原run。输出目录必须不存在以保护既有证据。脚本强制测试环境/独立数据目录，禁用后台/通知，不导入应用或打开业务库；公开源网络真实执行，存储为本地替身，输出 `discovery.json`、`result.json`、`media/`、`preview.html`。`LOCAL_MEDIA_READY` 只代表这张图许可核对/下载/转换/本地保存通过，必须实际看图确认相关性；不能作为完整日报回放、生产Shadow、正式托管、发布或邮件验收。

推广前分别核对新版源码已部署、NC账号实际授权/配置、运行端Prompt已更新及自然执行结果。本地Prompt文件改动不会自动同步已保存的云端任务，未获部署/任务配置授权时保持原状态。
专用代理新增来源超时时，先对比系统解析后的IP连接与同代理域名连接。若系统DNS地址错误，可在媒体代理路径显式启用 `DIGEST_MEDIA_DNS_MODE=doh`，保留公网IP绑定/TLS/许可检查；固定服务和失败边界见[照片合同](CHATGPT-WORK-CLOUD.md#shadow-自动资料照与专用代理)。不要关闭SSRF、改全局DNS或把域名CONNECT对照成功当作应用已恢复。
