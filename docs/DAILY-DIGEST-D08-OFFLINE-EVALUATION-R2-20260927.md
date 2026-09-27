# D08 第二轮：冻结规则后的有界来源盲测（2026-09-27）

- Status: VERIFICATION-SNAPSHOT / OFFLINE / D08 CONTINUE。
- Scope: 修正遗漏旧事实与双未知指标两项误判；用 12 条新核对的官方来源短摘录组成 13 组保留比较，分别评测人工 V3 字段和独立规则抽取字段。
- Authority: [匹配规则](../server/digest-v3-offline-match.ts)、[抽取规则](../server/digest-v3-offline-extract.ts)、[有界来源](digest-v3-d08-r2-bounded-sources.json)、[人工字段](digest-v3-d08-r2-manual-fields.json)、[评分专用答案](digest-v3-d08-r2-oracle.json)及 `npm run digest:eval-offline-r2`。逐项机器结果写入被忽略的 `dist-shadow/d08-r2-offline-*/result.json`。
- Do not use for: 宣称原网页通用抓取、真实 Work/Shadow、自动入库或事件合并、D09 已放行、正式日报、部署与发信。本快照没有给历史 [第一轮评测](DAILY-DIGEST-D08-OFFLINE-EVALUATION-20260927.md)改分。

## 故障复现、修复与冻结

修复前专项测试分别复现：同任务后来源仅省略 `crew_count`，旧规则误判 `material_change`；不同会议同一目标区间的两值都是 `null`，旧规则误判 `no_material_change`。修复后，`addedFactKeys`、`omittedFactKeys`、`unknownFactKeys` 分开报告；只有后来源新增**已知**事实或有确定发表先后的可识别阶段前进，才可能建议长程任务 `progress`。省略、双未知、已知转未知、未知新增、普通矛盾和同文档冲突留为 `unknown`；不同事件同值仅是可比指标的有限无变化结论，不能产生 Event 关联。日期、分钟、秒按精度验证与排序；同一日的日期/具体时刻和其他无法证明先后的混合精度留待核。

这些规则由通用事件身份与 `factKey/scope/unit/value` 判断，没有读取案例编号或某条来源 URL 作判定。抽取器只接收标题、短摘录、URL、发布时间/精度与文档元数据，拒绝 `selected`、答案和额外字段。评分器才读取人工字段和双轴答案。规则在首次读取下列保留来源**之前**以 LF 规范化文本 SHA-256 冻结：匹配器 `d5779f29abb0e97c444923c532c632bb33a5c78c209e52775ef28c06dd713e94`；抽取器 `73dd1cc7a93d00803631986e295be53d003c9abb9de7fb1d292a2d361ad84454`。评测命令先核对两哈希，样本错误未回流调整规则。输入、人工字段、答案哈希依次为 `a3e47bbc8cbbe20780ef469069157f980b7980ee6172dded0ee68977c33debad`、`f461005077c36283bdac6b48c1e6c8673c73bc991899f642a8c9d218bf3da650`、`105dac9c3fe3fb9ebf624c363c97c03ce77bcaa0198dc4d1309e022f4c09c565`。

## 来源与评分口径

有界输入是从官方页面标题、日期和相关段落形成的简短**转述**，不是完整网页抓取。美联储声明的会议发生标识由人工参照[官方 2025 FOMC 发布索引](https://www.federalreserve.gov/newsevents/pressreleases/2025-press-fomc.htm)与会议材料核对；它与声明发表时刻分开。独立抽取器只看到各条短摘录，不会取得人工确认的会议键。这一差异正是本轮要测的抽取边界。每个 V3 `sourceFact` 保留该条短摘录，`Evidence` 引用以具体页面 URL 和来源 ID 标识；同一机构的不同发布物仍是独立文件。

| 来源 | 官方页面 | 有界事实范围 |
| --- | --- | --- |
| s01 | [1 月 FOMC 声明](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250129a.htm) | 目标区间 4.25–4.50%，1 月 29 日发布 |
| s02 | [3 月 FOMC 声明](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250319a.htm) | 同一目标区间，3 月 19 日发布 |
| s03 | [5 月 FOMC 声明](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250507a.htm) | 同一目标区间，5 月 7 日发布 |
| s04 | [6 月 FOMC 声明](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250618a.htm) | 同一目标区间，6 月 18 日发布 |
| s05 | [3 月会议纪要发布](https://www.federalreserve.gov/newsevents/pressreleases/monetary20250409a.htm) | 3 月 18–19 日会议身份；摘录无目标区间值 |
| s06 | [Crew-10 发射](https://www.nasa.gov/news-release/nasas-spacex-crew-10-launches-to-international-space-station/) | 发射、四名乘员；页面只有发表日期 |
| s07 | [Crew-10 对接](https://www.nasa.gov/blogs/spacestation/2025/03/16/spacex-dragon-docks-to-station-with-four-crew-10-members/) | 对接、标题中的四名乘员；页面有分钟时刻 |
| s08 | [Crew-10 溅落](https://www.nasa.gov/news-release/nasas-spacex-crew-10-mission-returns-splashes-down-off-california/) | 溅落；页面只有发表日期 |
| s09 | [Crew-11 发射](https://www.nasa.gov/news-release/nasas-spacex-crew-11-launches-to-international-space-station/) | 发射、四名乘员；页面只有发表日期 |
| s10 | [Crew-11 对接](https://www.nasa.gov/blogs/spacestation/2025/08/02/crew-11-docks-to-station-aboard-spacex-dragon/) | 对接；页面有分钟时刻 |
| s11 | [Crew-11 发射图片文](https://www.nasa.gov/image-article/crew-11-launches-to-international-space-station/) | 同次发射，无新增阶段；独立图片文 |
| s12 | [1 月会议纪要](https://www.federalreserve.gov/monetarypolicy/fomcminutes20250129.htm) | 1 月 28–29 日会议身份；摘录无目标区间值 |

来源字段共 12 条：独立抽取事件身份 **8/12**、完整事实字段集合 **7/12**。四条声明缺明确会议日期且使用原文分数利率，抽取器安全弃权，四个目标区间值均漏取；s07 标题里的“四名 Crew-10 乘员”未被人数表达式识别。按事实项计，抽取到 **8/13**，全部 8 项与人工核对值一致；本样本未出现编造事实项。上述是有界短摘录的表现，不能推断全网页准确率。

## 双轨结果

指标分母均为 **13 组**，无跳过。`unknown` 表示事实变化不确定；`not_comparable` 表示跨不同任务的事实范围不可比。统计“漏判事实”只对人工答案为 `material_change` 或 `no_material_change` 的 **7 组**计数；“漏判关联”只对人工为 `same_event` 的 **7 组**计数。`ambiguous` 比例按最终建议，双轴任一不确定也另核对，恰好与此比例一致。

| 指标 | 人工结构化输入 | 独立抽取输入 |
| --- | ---: | ---: |
| 事件关系正确 | 13/13 | 8/13 |
| 事实变化正确 | 10/13 | 7/13 |
| 双轴同时正确 | 10/13 | 5/13 |
| 错合并 | 0/13 | 0/13 |
| 虚假进展 | 0/13 | 0/13 |
| 错误无变化 | 0/13 | 0/13 |
| 应关联事件漏判 | 0/7 | 2/7 |
| 应判变化/无变化的事实漏判 | 3/7 | 6/7 |
| `ambiguous` / 双轴不确定 | 6/13（46.2%） | 9/13（69.2%） |
| A/B 输入顺序改变结果 | 0/13 | 0/13 |

逐组格子写作“事件关系 / 事实变化”；`same`、`diff`、`amb` 分别是 `same_event`、`different_event`、`ambiguous`，`change`、`equal`、`unknown`、`n/a` 分别是 `material_change`、`no_material_change`、`unknown`、`not_comparable`。来源与精确 URL 见上表；完整引用 ID 与算法理由在 `result.json`。

| 组 | 来源 | 人工答案 | 人工字段建议 | 独立抽取建议 | 错误分析 |
| --- | --- | --- | --- | --- | --- |
| p01 | s01+s02 | diff/equal | diff/equal | amb/unknown | 抽取器从两份声明摘录均未取得明确会议日期或分数利率；没有错并，但漏判跨会议同值。 |
| p02 | s02+s03 | diff/equal | diff/equal | amb/unknown | 同上；3 月和 5 月会议身份均弃权。 |
| p03 | s03+s04 | diff/equal | diff/equal | amb/unknown | 同上；5 月和 6 月会议身份均弃权。 |
| p04 | s02+s05 | same/unknown | same/unknown | amb/unknown | 人工确认声明和纪要属于 3 月同会；独立抽取只识别纪要中的会议日期，漏关联。纪要摘录无可比目标区间，事实仍未知。 |
| p05 | s01+s12 | same/unknown | same/unknown | amb/unknown | 同一 1 月会议的声明与纪要，独立抽取遗漏声明身份；没有把纪要当新政策变更。 |
| p06 | s05+s12 | diff/n/a | diff/n/a | diff/n/a | 两次会议的纪要都有明确日期，但两份摘录都没有可比指标；两路正确。 |
| p07 | s06+s07 | same/change | same/unknown | same/unknown | 发射→对接是真进展；发射页日期精度与对接页分钟精度混用，冻结规则无法证明先后。独立抽取还遗漏 s07 标题人数。 |
| p08 | s07+s08 | same/change | same/unknown | same/unknown | 对接→溅落是真进展；分钟↔日期混合精度被保守留下。 |
| p09 | s06+s08 | same/change | same/change | same/change | 两页均日期精度且相隔数月，阶段前进可判，两路均正确。 |
| p10 | s06+s09 | diff/n/a | diff/n/a | diff/n/a | 两个任务均发射且均四人；任务键/事实范围不同，未合并。 |
| p11 | s09+s10 | same/change | same/unknown | same/unknown | Crew-11 发射→对接是真进展，日期↔分钟精度造成漏判。 |
| p12 | s09+s11 | same/unknown | same/unknown | same/unknown | 独立图片文重复发射事实但省略人数；没有完整复核，不把省略当进展或宣称整体无变化。 |
| p13 | s07+s10 | diff/n/a | diff/n/a | diff/n/a | 两个任务都对接，阶段词相同但事件身份不同；两路未错并。 |

本轮错合并、虚假进展、错误无变化均为 0，但不能用“全部不确定”宣布通过：人工轨仍给 3 组跨会同值、1 组任务真进展和 3 组不同事件的确定结论，独立轨也给 1 组真进展和 3 组不同事件的确定结论。独立轨的 69.2% 待核与 6/7 有方向事实漏判仍明显过高。13 组只覆盖两类机构、12 个有界公开来源，且是短摘录转述；无跨语言改写转载、网页更新版本、真正跨日期 Work 输入或生产端到端证据。

## 决策

**继续 D08，暂不进入 D09。** 下一次应在新的一轮预先声明规则与新保留样本：补会议日期与分数利率的证据化抽取，并把日期/分钟发布时间解释为区间，只有能证明区间严格先后才放行阶段进展；随后继续量化召回和错误合并。当两来源无法证明先后时，当前输出的“新增/省略”方向只来自确定性的 URL 排序，理由也可能笼统称为“较后来源”或“阶段事实”；这些标签不能作为时间事实使用，下一轮应改为无方向的覆盖差异。还需扩大到其他有界官方来源、改写转载与来源冲突，保持 A01 的不确定性。D09 的人工纠正/冻结引用能力可独立设计，但按本轮 D08 质量证据不自动开工。全程仅输出本地建议和评分，没有读取或写入活动库、合并事件、调用 Work、正式发布或发信。
