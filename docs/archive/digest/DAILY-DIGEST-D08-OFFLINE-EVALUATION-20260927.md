# D08 第一轮只读离线匹配评测（2026-09-27）

- Status: VERIFICATION-SNAPSHOT / OFFLINE / D08 CONTINUE。
- Scope: S2-01 固定 15 组/30 条官方来源的已核对摘要、7 组预留合成样例，以及原七期模拟的 21 条未经过人工 `selected` 筛选的候选。
- Authority: `npm run digest:eval-offline` 的规则 `d08-r1`、[匿名输入字段](../../digest-v3-d08-source-fields.json)、[双轴人工答案](../../digest-v3-d08-oracle.json)、[预留样例](../../digest-v3-d08-holdout.json)和当前源码。本机逐条完整理由、匿名 Evidence ID、输入投影和 JSON 结果位于运行时输出的被忽略目录 `dist-shadow/d08-offline-*`。
- Do not use for: 声称从网页自动抽取事件身份与事实、真实 Work/Shadow、生产、D09、跨日改写转载已解决、A01 历史截点或邮件收件箱验收。

## 合同与输入隔离

事件关系与事实/指标变化分别评分。不同 FOMC 会议必须是不同 Event；相同目标利率只允许在相同 `factKey/scope/unit` 下判指标无变化。A01 的两页为同一发布物/任务背景，但事实互相冲突，保留 `same_event + unknown`，汇总为 `ambiguous`，不允许用候选 Event ID 自动挂接。[合同](../../DAILY-DIGEST-V3-CORE-CONTRACT.md#d08-第一轮离线匹配与双轴变化合同2026-09-27)及 [A01 复核](DAILY-DIGEST-V3-S2-01-CASES-20260924.md#a01-来源冲突复核2026-09-27)记录判别边界。

固定案例的 `sourceFact` 与 URL/发布时间来自 [S2-01 快照](../../daily-digest-v3-s2-01-cases.json)，结构化事件键、文档身份和事实由人工从有界来源摘要抽取，不是模型或规则自行发现。评测程序只将匿名化来源投影传给[匹配器](../../../server/digest-v3-offline-match.ts)；五类标准答案、双轴答案、`selected`、预期关系、案例编号及原模拟 `eventKey` 留在评分侧。投影字段和未知字段拒绝有测试覆盖，输出包含匿名 Evidence ID、候选 Event ID 与理由。七期候选的原来源 ID/URL 路径含分类词，投影时改为不可读哈希 URL；保留同一来源 ID 的相等性，不传入语义标签。

本轮仅计算建议，未读取或修改 `activity.db`，未创建/合并 Event、Revision、Evidence、Analysis，没有进入 Work、D13、D14/D15、调度或正式日报。英文/西语 A01 网页仅用于人工复核冲突，不属于离线匹配运行时输入抓取。

## 固定 15 组结果

事件关系正确 **15/15**；事实变化正确 **15/15**；双轴同时正确 **15/15**。五类汇总的 5×5 矩阵如下，行是原 S2-01 人工类别，列是建议：

| 人工 / 建议 | duplicate | different_event | progress | no_material_change | ambiguous |
| --- | ---: | ---: | ---: | ---: | ---: |
| duplicate | 3 | 0 | 0 | 0 | 0 |
| different_event | 0 | 3 | 0 | 0 | 0 |
| progress | 0 | 0 | 3 | 0 | 0 |
| no_material_change | 0 | 0 | 0 | 3 | 0 |
| ambiguous | 0 | 0 | 0 | 0 | 3 |

错合并 **0/15**；应关联的 `duplicate/progress` 被判不同事件的硬漏 **0/6**、被判待定 **0/6**。U01–U03 指定利率指标的无变化漏判 **0/3**、误判 **0**。不确定 **3/15 = 20%**：`ambiguous` 人工类 **3/3**，其余四类均 **0/3**；因此没有以全量待定取得表面安全。全部 15 组进入分母，未跳过；除 A01 外本轮未重新抓取其他 28 个官方页面，不以 2026-09-24 摘要宣称它们当前未漂移。

表中来源 `-A/-B` 对应固定 JSON 的两条 URL；完整匿名 Evidence ID 与简短理由也由命令输出的 `report.md` 和 `result.json` 保留。

| 案例与来源 | 五类建议 | 事件关系 | 事实变化 | 引用与主要理由 |
| --- | --- | --- | --- | --- |
| D01-A/B | duplicate | same_event | no_material_change | 同一热盾原因发布物的英西语版本；事实相同，只计一条独立来源。 |
| D02-A/B | duplicate | same_event | no_material_change | 同一发布物编号 24-145，日程更新事实一致。 |
| D03-A/B | duplicate | same_event | no_material_change | 同一次 Orion 装配里程碑的英西语图片文章。 |
| E01-A/B | different_event | different_event | material_change | 2024-09-18 与 2024-11-07 两次会议各自成事件，目标区间确有变化。 |
| E02-A/B | different_event | different_event | not_comparable | Crew-8 与 Crew-9 的任务和发射不同，发射状态的范围不能跨任务比较。 |
| E03-A/B | different_event | different_event | not_comparable | Lucy 与 Psyche 航天器不同，不能按相似标题合并。 |
| P01-A/B | progress | same_event | material_change | Artemis I 发射→溅落，同一飞行出现较后阶段事实。 |
| P02-A/B | progress | same_event | material_change | Starliner 飞行测试发射后新增无人返航决定。 |
| P03-A/B | progress | same_event | material_change | Europa Clipper 发射后新增火星飞掠雷达测试结果；结果发表日不当发生日。 |
| U01-A/B | no_material_change | different_event | no_material_change | 两次 FOMC 会议分开；仅目标利率区间相同。 |
| U02-A/B | no_material_change | different_event | no_material_change | 两次 FOMC 会议分开；仅目标利率区间相同。 |
| U03-A/B | no_material_change | different_event | no_material_change | 两次 FOMC 会议分开；目标利率相同，缩表上限未并入“无变化”。 |
| A01-A/B | ambiguous | same_event | unknown | FAQ 译文链已确认，但英文决定、西语旧正文与编辑注释年份冲突；保留待核。 |
| A02-A/B | ambiguous | same_event | unknown | 同一次会议的声明与后来纪要是不同文件；无可比事实以判断实质变化。 |
| A03-A/B | ambiguous | same_event | unknown | 同一次会议的决定与预测材料同刻发布但范围不同；不把预测当决定。 |

## 预留样例与七期原始候选

7 组预留合成样例（两次会议同值、同任务进展、不同任务同状态、冲突译文、相同译文、同会异文档、同对象不同飞行）在第一次评测前固定，未依据它们的错误调整规则：事件 **7/7**、事实 **7/7**。此样例组在本轮开发中已被查看，不能代替后续独立盲测。15 组固定与 7 组预留均交换 A/B 回放，事件、事实、类别、候选 ID、引用和理由保持相同。

七期模拟直接投影[原始候选](../../../scripts/digest-seven-day-simulation.ts)，不用人工 `selected` 生成匹配建议。同一期改变输入顺序后逐条结果一致。共 **21** 条：`new_event` **12**、`progress` **1**、`duplicate` **5**、`no_material_change` **1**、`ambiguous` **1**、截点后待下一期 **1**。其中 13 条 `new_event/progress` 与人工入选数 13 相符，但不能把这一合成吻合当真实新闻召回。5 条旧闻复用同一匿名来源 ID，另 1 条同文换 ID 只判“同事件无变化”。D5 的 B 改写转载没有可核验的原始发布物关系和等价事实，仍为 **ambiguous**；它是人工排除的 8 条之一，不能计作自动去重成功。D6 截点后的 E 来源延到 D7 才成为候选。逐条建议、目标比较来源和人工答案见本机 `result.json` / `report.md`。

## 复核指纹与下一步判断

| 项 | SHA-256（文本换行先统一为 LF） |
| --- | --- |
| 匿名算法输入投影 | `e0674cd1c307b98474ebaf0092e9f46c6d5c4a90005a1d7c8c2df627a5732997` |
| 双轴人工答案文件 | `62644567ed9c7c16cc4464e64d4264784a87180e561256ca121614a5e21b6782` |
| 匹配规则源码 | `fc3a472780bde9c41cc88f116f38827a0bff0a8a73105ffca58c2175bd77808a` |
| 固定 S2-01 基线 | `0c58f2ac762311e22ac99ab2546750dc175402449289cbfb480d5a4ce8712c1b` |
| 人工字段抽取文件 | `b56fb084d87ef56ebbb3a1a2825d0ea72ec77083b4fb54277464f87d327d7a0a` |
| 预留样例文件 | `439c1f235c917d3ea9986990b24028daf98543e59b574dd9187e5e33d3b63eb6` |

判定：**继续完善 D08，暂不进入 D09**。固定与预留样例证明在已人工抽取字段的前提下能安全地区分给定情形；七期改写转载仍未确定，实际网页到 `subjectKey/occurrenceKey/factKey/scope` 的可靠抽取、来源版本漂移与更多独立样例尚无证据。下一轮最有价值的是对改写转载补原始发布物/事实等价证据，独立检验字段抽取失误如何影响错合并，再在真实隔离输入上复核；不以等待七个真实日报日期作前置，也不自动启动 D09。
