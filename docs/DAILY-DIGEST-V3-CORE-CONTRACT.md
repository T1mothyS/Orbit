# Daily Digest V3 Core：事件记忆字段与状态合同

- Status: CONTRACT / S2-02；S2-03 LOCAL STORAGE VERIFIED / NO PUBLIC V3 API
- Scope: Event、Revision、Evidence、Analysis 的字段与状态，以及 S2-03 在原活动库中的增量存储；不定义 S2-05/06 的对外接口或自动匹配算法。
- Last verified commit/version: `e44b647`（S2-03 修改前合同基线）/ `0.31.7-260924.1200`（2026-09-24，本地存储实现与合成验证；未部署）。
- Authority: 当前源码及 [S2-01 固定案例](daily-digest-v3-s2-01-cases.json) 优先；实现时如需改动本合同，应先解释案例与兼容性差异。
- Update trigger: S2-03 数据结构、S2-06 写入校验、S2-09 修订语义或 S2-10a 纠正流程落地时。
- Supersedes: 无；[V2.5 合同](CHATGPT-WORK-CLOUD.md#daily-digest-v25隔离新版合同)及已有产物保持原语义。
- Do not use for: 宣称 V3 已有对外接口、自动分类器、账号级完整备份、30 例回归或真实 Shadow 验收。

## 共同约束

四种记录都由服务端认证身份确定 `userId`，外部提交不能指定或改写所有者。主键和引用均按 `(userId, id)` 校验；不存在跨账号事件、证据、修订或分析的共享引用。公开 URL 可以相同，两个账号的私有判断和记录仍独立。读取、写入、备份与恢复均沿用账号隔离；S2-03 使用现有 `activity.db`，不因本合同引入另一套数据库。

`createdAt`、`recordedAt`、`retrievedAt` 是服务端带时区的时间戳；来源 `publishedAt` 和事实发生的 `occurredAt` 分别保存原始值与 `precision = date | minute | second | unknown`。Evidence 必须带 `publishedAt/precision` 两个键，未知时用 `null/unknown`；`occurredAt` 可选，记录时也须带精度。只有日期就存 `YYYY-MM-DD` 和 `date`，不得推断具体时分或把发表日充作事件日。带时分的来源值保留原时区偏移。所有持久化文本限长、拒绝凭据和私人邮件原文；证据只存必要的公开来源事实与校验信息。

| 记录 | 必需字段与含义 | 可选字段与约束 |
| --- | --- | --- |
| `Event` | `id`、`userId`、`eventType`、`subjectKey`、`occurrenceKey`、`title`、`lifecycle`、`currentRevisionId`、`createdAt`。`subjectKey` 标识任务/机构/指标，`occurrenceKey` 标识一次会议、发射或同一长程任务；标题相同不能代替这两个键。 | `mergedIntoEventId` 仅在明确合并后填写，必须同账号；`currentRevisionId` 只是可重建的最新指针，不能改变历史修订。不同会议有各自 Event；长程任务可用一个 Event 的连续修订表示阶段进展。 |
| `Revision` | `id`、`userId`、`eventId`、`revisionNo`、`previousRevisionId`、`changeKind`、`facts[]`、`evidenceIds[]`、`recordedAt`。`facts[]` 每项含 `factKey`、`value`、`unit`、`scope`、支持它的 `evidenceIds[]`；范围与单位不能只埋在自由文本里，不适用的单位用 `null`。 | `occurredAt`/`precision` 仅在来源支持时填写；`reason`、`decidedBy = system | user` 记录为何产生版本。每个 Event 的 `revisionNo` 单调递增，第一版 `previousRevisionId=null`，其余必须指向同 Event 前一版。封存后的 Revision 不更新、不删除；更正追加新 Revision。 |
| `Evidence` | `id`、`userId`、`url`、`publisherKey`、`documentType`、`language`、`sourceFact`、`publishedAt`/`precision`、`retrievedAt`、`independenceKey`、`reviewState`。`url` 指具体来源页，`sourceFact` 是有界的来源事实摘要，不能混入 AI 推断。 | `sourceDocumentKey` 用于同一发布物的多语言/转载归并；`relatedEvidenceId` + `relation = translation | reprint | update` 表示派生关系；`supersedesEvidenceId` 用于同 URL 页面后来更正/重新核对；`linkedRevisionId` 允许后来核对的译文关联既存修订，不改写修订本身。相同 `independenceKey` 只能算一条独立来源；同机构不同文件也要保留各自 Evidence。既存 Evidence 封存后不覆盖。 |
| `Analysis` | `id`、`userId`、`eventRevisionId`、`evidenceIds[]`、`analysisKind = interpretation | change_assessment | hypothesis`、`body`、`authorKind = ai | user`、`recordedAt`。分析只能引用已保存、同账号的精确 Revision/Evidence 版本；`body` 不作为 `facts[]` 或来源证据。 | `comparedRevisionIds[]` 在跨事件比较时固定所比较的版本；`change_assessment` 另记 `factKey`、`scope`、`check = complete | incomplete`、`assessment = material | no_material_change | unknown`，只有检查完整且来源充分才可判无变化。`runId`、`modelId`、`promptVersion` 用于 AI 生成溯源；`supersedesAnalysisId` 表示新解释替换旧解释，但旧记录保留。保存 Analysis 不等于用户确认 Thesis/Proposal，不触发日程写入或提醒。 |

`Evidence` 保存的是某次核对所见，不是外部网页永远不变的保证；同 URL 更新时追加新 Evidence 并连接 `supersedesEvidenceId`。`Revision.evidenceIds[]` 只引用当时的 Evidence，`Analysis` 只引用当时的 Revision/Evidence；新 Revision 不会让旧 Analysis 自动成为当前解释。未来日报发布时必须冻结这些 ID（S2-11），以免后续网页更新、分析重做或事件合并改写历史含义。已有 `digest_v2_runs`、`digest_v2_artifacts` 与 V2 发布快照不回填、不重写为 V3 实体。

`independenceKey` 按原始采编/发布链划分，不简单等于域名或机构名：同一 NASA 发布物的译文共用一个键；同一美联储会议的决议和预测是不同文件，但是否能互相佐证同一事实，仍须按各自事实范围判断。

## 状态与写入规则

| 状态或判断 | 合同 |
| --- | --- |
| `Event.lifecycle` | `active`：已有被接受的初始 Revision；`merged`：经显式纠正并保留 `mergedIntoEventId`，旧 ID 仍可追溯；`retracted`：经有据纠正后停止作为当前事实展示，历史仍可读取。`merged`/`retracted` 不能靠模型匹配建议直接触发；恢复或拆回须记录新的纠正操作，不删旧引用。 |
| `Revision.changeKind` | `initial`、`progress`、`correction`、`no_material_change`、`retraction`。`progress` 有新事实；`correction` 指明被纠正事实及证据；`no_material_change` 只用于**同一 Event** 的重新检查，须有明确 `factKey`/`scope`、前后可比值、完整检查与核对证据。不同 Event 之间的跟踪项比较写入 `Analysis.change_assessment`，不把两个会议强行合成一个 Event。纯翻译/转载没有新事实时只补 Evidence 关联，不伪造新进展。 |
| `Evidence.reviewState` | `verified`：来源事实已核对；`needs_review`：时间、语言版本、事实或身份有冲突；`rejected`：经核对不可用。状态随该次 Evidence 封存；复核结果变化时追加新 Evidence，旧记录不原地改写。`verified` 只说明来源事实核对，不说明多条 Evidence 独立。 |
| `Analysis` 状态 | 已保存的 Analysis 是不可变记录；新判断通过 `supersedesAnalysisId` 追加，当前解释由引用链推导。`change_assessment=unknown` 不能当成无变化；AI 的解释和用户确认的 Thesis/Proposal 是不同状态。 |
| 匹配判断 | `duplicate`、`different_event`、`progress`、`no_material_change`、`ambiguous` 是针对一组输入的判断，不是 `Event.lifecycle`。`ambiguous` 保留候选和理由供人工复核，不自动合并、拆分或宣称无变化。匹配建议在 S2-08 才实现，纠正操作在 S2-10a 才实现。 |

一条新来源先生成可审查 Evidence，再决定关联已有 Event 或创建新 Event；自动判断不能仅凭标题、URL 域名、相同发表时间或文本相似度合并。若关系、事实范围或来源独立性不足，选择 `ambiguous`。人工纠正必须记录操作人、时间、理由、前后 ID 和并发基线；合并保留旧 Event 重定向，拆回恢复原引用路径，来源更正与事实更正均追加版本。S2-10a 再定义具体接口和事务，不提前声称本合同已实现纠正。

## S2-01 案例映射

[固定 JSON](daily-digest-v3-s2-01-cases.json) 的 `sources[].id/url/fact/publishedAt/precision` 分别映射到 Evidence 的测试 ID、`url/sourceFact/publishedAt/precision`；`reprintRelation` 决定派生关系和 `independenceKey`；`expectedCategory` 是匹配判断的期望值，`expectedDecision` 是期望的 Event/Revision/Evidence 操作。案例中的 `fact` 是人工核对摘要，不是逐字引文；JSON 没有 `retrievedAt`、真实 `userId` 或数据库 ID，回放时由隔离测试补充，不能伪装为现有持久化记录。

| 案例 | 合同核对结果 |
| --- | --- |
| D01–D03（重复） | A/B 各保留一条 Evidence，翻译页通过 `relation=translation` 与同一 `sourceDocumentKey` 相连，并共用 `independenceKey`；对应事实只归入一个 Event/Revision。后来取得的译文用 `linkedRevisionId` 关联已有修订，不改写它，也不计两份独立佐证。 |
| E01–E03（不同事件） | 会议日期、Crew 编号、航天器身份进入 `occurrenceKey`/`subjectKey`；各建 Event 和初始 Revision，即使标题或发布类型相似也不合并。 |
| P01–P03（进展） | 长程任务的第二条来源带来溅落、返航决策或雷达结果；同一 Event 追加 `progress` Revision，保留首版和两次来源发表时间。P03 的火星飞掠发生日与后来的结果发表日分别记录。 |
| U01–U03（跟踪项无变化） | 两次 FOMC 会议各有自己的 Event/初始 Revision；`Analysis.change_assessment` 固定两版 ID，对共同的 `factKey=federal_funds_target_range` 和相同单位/范围比较，且 `check=complete` 后，才可记录该跟踪项的 `no_material_change`。U03 的缩表上限变化是另一 `factKey`，不得被利率“无变化”覆盖。 |
| A01–A03（易混淆） | A01 英西语保留翻译关系，但冲突内容标 `needs_review`，不算双重确认或覆盖旧事实；A02 同一次会议的声明与后来纪要保留不同 `documentType` 和 `publishedAt`，新增事实才追加 Revision；A03 同时发布的决定与预测材料各自保留 Evidence，不因时间相同当转载或把预测当决定。 |

本表是对 15 组人工预期的静态合同核对，不是 V3 分类器运行结果。S2-12 才能报告 30 条来源的自动回放及连续真实 Shadow 对照。

## S2-03 本地存储与迁移（2026-09-24）

现有 `activity.db` 在启动时增量创建 `digest_v3_events`、`digest_v3_revisions`、`digest_v3_evidence`、`digest_v3_analyses`，以及修订/分析到证据、分析到比较修订的三个引用表；`schema_meta` 的总版本为 `4`，`digest_v3=1`。迁移在 SQLite 事务中执行，重复启动安全，不读取或改写 V2 报告/产物。主键和外键包含 `user_id`；Event 当前修订还要求属于同一 Event。已保存的 Revision、Evidence、Analysis 禁止原位 UPDATE；Event 可在未来的受控纠正中改变当前指针与生命周期。

内部存储层位于 [digest-v3-store.ts](../server/digest-v3-store.ts)，通过现有 `activity-store.ts` 连接和可靠写回。只提供内部的证据、初始事件、后续修订、分析写入与按账号读取，尚未接入 MCP、HTTP、Work 或日报发布。完整业务校验、幂等提交和用户权限从 S2-05/06 开始；匹配、合并与冻结日报引用仍按路线图后续卡片实现。`sql.js` 导出数据库会重建连接，写回/恢复后重新开启外键检查，避免账号引用约束在首次保存后失效。

目前全站快照包含完整 `activity.db`；账号级导出及替换恢复**尚未纳入 V3 实体**，有 V3 数据时显式拒绝这两项操作，防止静默丢失。管理员按已有全站快照流程删除账号数据时，会清除该账号的 V3 行并保留其他账号。S2-04 负责让账号级备份/恢复完整保留 V3 记录及引用。在它完成前，本存储实现只在合成隔离数据上验证，不能作为真实 V3 写入放行依据。

[S2-03 测试](../server/digest-v3-store.test.ts) 覆盖旧活动库打开、重复迁移、V2 记录保持、四实体写回/重启读取、两个账号相同 ID 隔离、跨账号外键拒绝、不可变更新拒绝、失败写回回滚及账号删除。它不是 S2-01 案例的自动分类回放；S2-12 才能报告那一层结果。
