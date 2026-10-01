# Daily Digest V2.5 隔离晚间增量验收（2026-09-27）

状态：**隔离流程修正并完成一次真实时间 Work/Shadow 回放；内容质量仍受限。** 本文是该时点快照，不替代 [V2.5 合同](../../CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同) 或后续日期验收。只涉及隔离服务和隔离定时任务，没有切换主站、正式 16:40 Work、正式发布或邮件。

## 起因与规则

18:05 的旧定时任务仅因 10:57 早版 Shadow 已存在而跳过了晚间研究；当时服务仍为 `0.31.14-260927.1103`、generation `2026-09-27.1`，早版为零新闻、零图片。早版最多证明其截点前的输入处理，不能覆盖 18:00 后的信息。

已更新原 `Daily Digest V2.5 逐条配图验收` 自动化，保留每天 18:00 的原排程。每次按实际运行时间确定目标截点；已有产物只有同时满足日报日期、目标截点、合同及 generation、来源研究和成功输入覆盖、逐条引用及图片证据，才能用于本轮结论。上午早版不能跳过晚间检查。重要新增或遗漏另存同日 Shadow 并保留旧稿；无合格新增可沿用，但必须记录检索窗口、候选、排除与失败。未检索、关键来源失败或截点证据不足时标受限，不写“无重要新闻”。同日修订不增加真实日期数。规则见 [合同](../../CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同)。本次手动执行独立 Work 验收；**新排程规则尚待下次自动触发验证**。

## 独立服务发布

从线上旧提交 `8dd75d1` 建立独立候选，只纳入 D02 的 `EVIDENCE_AFTER_CUTOFF`、`DUPLICATE_STORY_CONTENT`、空新闻 `reviewIssues` 及对应测试，版本为 `0.31.18-260927.1825`，generation `2026-09-27.2`。未纳入其后的 V3/D13 新路由与写入能力，依赖未变。本地候选提交为 `5eee644`；发布包 SHA-256 为 `3cd83d730b230d8f162f5ab14b568d087a54fb89b2af9b9a7164d41cd4293eb0`，上传后哈希相同。

本地 `npm test` 300/300、`npm run typecheck`、独立服务 TypeScript 编译、`npm run build` 均通过；构建使用进程级合法 HTTPS 地址。切换前隔离与主站 health 正常；切换仅修改独立服务的 WorkingDirectory。事前保存独立服务配置与数据归档并校验归档，保留旧 release；备份 SHA-256 分别为 `0ba6461f171720cea9f195f4615e3ce0f2a1261a48c8bb25445a344b992c03f1`、`f31d771c5f685c83c43775429ee65d909c44ddb7bdb9727232453d3c5f5c1d2c`。启动窗口曾出现三次短暂 502，随后独立服务 active、NRestarts=0，隔离与主站 health 均恢复。错误时脚本可切回旧配置；未为演练而实际回切，具体备份位置和命令只记在本机部署记录。

## 实际晚间 Work 验收

独立 Work 于 Asia/Shanghai **18:45:38–18:48:58** 运行；新 `read_inputs_v2` 快照截点为 **18:45:55**，从早版 10:57:37 起检查。该工具创建隔离快照及 `runId=ceb9b239-73bf-4877-a1c0-7e100c88c619`，不属于严格零写入。返回 generation `2026-09-27.2`；Calendar 0、Mail 5、Watchlist 0 均读取成功，5/5 Mail `input_id` 覆盖，未在文档展示私人正文或地址。

| 候选与来源 | 时间及处理 |
| --- | --- |
| 澳大利亚 AI 与数据中心参议院调查邀请两名公司负责人 | [The Guardian](https://www.theguardian.com/australia-news/2026/sep/27/sam-altman-openai-dario-amodei-anthropic-senate-inquiry-medicare-hack-rogue-ai-agent-leak) 标注 9/26 10:00 EDT，即北京时间 9/26 22:00，早于上午截点；应判 **早版遗漏**。[Reuters 后续报道](https://www.marketscreener.com/news/openai-anthropic-ceos-called-to-appear-at-australian-ai-probe-ce785adcd88af52c) 标注 9/27 00:23 EDT，即北京时间 12:23，只是本轮窗口中的后续报道，不能把同一邀请写成午后新事件。[澳议会对应参议院调查页](https://www.aph.gov.au/Parliamentary_Business/Committees/Senate/Environment_and_Communications/AIdatacentres48P)可确认调查和已列出的 10/1 听证，未提供两名负责人的邀请明细；新闻保持 `partial`。 |
| Solidigm IPO 报道 | Reuters 原稿发表于 9/25，未找到本轮窗口的公司确认，作为跨日旧闻排除。其他首轮候选主要为 9/20–22 旧闻/重复。 |

Work 初判误把 Reuters 的新报道时间当作邀请事实的新增时间；独立复核 Guardian 后，在第一次保存前改为“早版遗漏”。第一次 Shadow 预览又暴露议会引用误指另一项联席调查；第二稿修正为对应参议院委员会。第二稿的“等待公布听证日期”与官网已列的 10/1 听证矛盾；第三稿仅修正后续关注句。每次保存前重新校验并保留旧稿，错误的中间 Shadow 仍可追溯，**不作为最终验收稿**。

| 层级 | 实际结果 |
| --- | --- |
| 研究 | 有界公开检索和上述候选/排除记录；官方邀请明细未取得，不能宣称完全官方核实或全网无遗漏。 |
| 校验 | 最终 `valid=true`、errors 0、warnings 0、reviewIssues 0。最后一处单句修订首次触发 `EMPHASIS_REQUIRED`，加短语重点后复验通过。D02 校验不联网证明来源事实。 |
| Shadow | 最终 `artifactId=a96c9510-a7cd-47b9-8a9c-333ac6bdf110`，`contentHash=b8c9bfc858902fdbbd9f3c3f14d58038c29c0eccf2c9298e021b911929ac90f0`；上午早版及两份中间修订保留，同属 9/27 一个真实日期。 |
| 图片 | 1 条新闻、1 张标注“非新闻现场”的原创插画、真实照片 0、缺图 0。2022 年议会大厦资料照片候选因 `LICENSE_NOT_APPROVED` 被服务端拒绝，未冒充合规真图。桌面浏览器实看最终详情图片加载、列表封面与新闻标题/摘要一致。 |
| 发布/邮件 | 隔离账号正式日报列表仍为空；Shadow 列表标“不投递邮件”，Work 回执 `NOT_QUEUED`。没有正式发布、队列、SMTP 或收件箱验收。 |

剩余边界：本次只有一条且为 `partial` 的新闻，图片全由插画补位；不能证明真实照片许可链、广泛来源召回或内容质量整体通过。移动宽度、邮件 HTML、真实邮箱、七天到期及真实媒体下架未在本次重验。下次自动 18:00 运行需验证新规则实际执行，而非仅凭配置文本。9/26 与 9/27 是两个有新闻且逐条有视觉素材的真实日期，但 9/27 真实照片为零；D02/D03/D04 不据此整体放行。D09 仅可按路线图在**另行授权后**处理人工核验数据的本地精确引用冻结，不自动应用 D08 建议，也不因本次隔离 Shadow 自动启动。
