# Daily Digest D13：研究历史与观点确认

- Status: CONTRACT / D13 LOCAL SYNTHETIC IN PROGRESS
- Scope: Research 运行、Proposal 草稿、用户确认的 Thesis 版本，以及本地登录态读写与账号备份。D14 Radar、D15 Flash 和正式日报发布均不在此合同。
- Authority: 当前 `server/digest-research-store.ts`、`server/routes/research.ts` 与测试优先；V3 来源事实和分析仍以 [V3 Core 合同](DAILY-DIGEST-V3-CORE-CONTRACT.md)为准。
- Update trigger: D13 触发/领取方式、认证、状态、备份或确认语义改变时。
- Do not use for: 推断已接通真实 Workspace Agent、Work 定时任务、生产研究、自动匹配、提醒或正式 Thesis 自动变更。

## 本地数据与状态

原 `activity.db` 增量加入 `digest_research_runs`、`digest_thesis_proposals`、`digest_thesis_versions`。每张表以 `user_id` 参与主键及引用约束。Research 可以引用当前账号已有的精确 V3 Revision；不推断候选属于哪个 Event，也不修改 Revision/Evidence/Analysis。研究结果留在 Run 历史；可选建议产生 Proposal `draft`，不能直接生成 Thesis。用户明确确认后新增不可变 Thesis Version，旧版仍可读；拒绝只终结草稿，不改变当前 Thesis。

Research 使用候选键保证同一输入重试幂等；候选键对应的内容变化会冲突。领取使用十分钟租约与一次性令牌摘要；有效租约期间不能重复领取，过期后可重领，旧令牌不能提交结果。完成可同时保存研究结果与一条草稿提案；失败可显式标记。Proposal 记录生成时的 Thesis 基线，确认或拒绝时必须提供该基线；当前版本变化或重复处理会冲突。提交、决定及持久写回失败均按现有 `activity.db` 原子写回回退。这里的领取仅通过登录用户接口完成，尚未赋予 Work OAuth 或只读日报令牌写权限。

## 登录态接口与页面

`/research` 从日报页进入，显示研究结果、提案、已确认观点历史，以及运行绑定的精确 V3 Revision 和来源事实，并提供草稿的确认/拒绝操作。无绑定来源时明确提示自行核对。读取失败、空态和操作中状态有独立反馈。页面没有自动检索或启动真实 Agent 的入口。登录态接口为：

| 接口 | 作用 |
| --- | --- |
| `GET/POST /api/research/runs`、`GET /api/research/runs/:id` | 分页读历史；提交人工或合成候选，绑定可选的同账号 V3 Revision；详情只读返回该修订的来源 |
| `POST /api/research/runs/:id/claim` | 领取待研究或租约到期的 Run；只返回本次租约令牌 |
| `POST /api/research/runs/:id/complete`、`/fail` | 有效领取者提交研究结果、可选草稿，或标记失败 |
| `GET /api/research/proposals`、`POST /api/research/proposals/:id/decision` | 读取提案；`confirm:true` 加基线后确认或拒绝 |
| `GET /api/research/theses/:subjectKey` | 按研究对象读取已确认的版本历史 |

所有接口从登录认证取得账号，不信任请求中的 `userId`；跨账号资源按不可见处理。读接口不缓存。分页上限为每次 100 条。页面当前展示最近 100 条，更多历史可通过分页 API 查询。

## Agent 触发判断

[官方 Workspace Agents 文档](https://developers.openai.com/workspace-agents/trigger-runs)提供已发布 API 通道的 `POST /v1/workspace_agents/{id}/trigger`；它要求 Workspace Agents 范围的访问令牌，`202` 只表示事件排队，返回的会话链接及可选运行 ID不包含研究正文。现有日报 Work 定时任务不自动成为可触发的 Workspace Agent。`digest-research-trigger.ts` 使用注入的合成传输测试请求形状、幂等键、成功回执与失败，尚未接入运行路径；本机没有核实实际 API 通道或令牌，也没有向 Work 发起触发。当前本地最小闭环采用领取与提交接口；Work 身份、结果回传、真实触发及失败回退仍需单独集成和授权。

## 备份与验收边界

用户加密备份沿用格式版本 `1`，新增三组完整行集；旧备份缺少三组字段仍可合并，若目标已有 D13 数据则不能用旧备份替换。新备份必须三组全有或全无，校验账号一致、Run→Proposal→Version 关系及确认基线。已有独立确认观点的同对象历史不能直接合并；替换恢复仍需显式选择并保留安全副本。跨账号恢复重映射 Research、Proposal、Thesis、V3 Revision 引用，领取令牌清空且进行中 Run 回到待领取。全站快照仍包含完整 `activity.db`。

本地测试覆盖候选幂等、跨账号引用拒绝、并发领取与过期重领、旧令牌失效、结果和草稿分离、确认/拒绝/重复操作、旧库再打开、写回失败回退、账号加密备份及跨账号恢复。浏览器合成 API 覆盖 390×844、430×932、768×1024、1440×900 的明暗主题、长文本、确认、空态和错误态。它们不证明真实 Agent、真实跨日研究、真实来源准确性、Work OAuth/结果回传或生产恢复。D13 继续保持进行中，D14/D15 未开工。
