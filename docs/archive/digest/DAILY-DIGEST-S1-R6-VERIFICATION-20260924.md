# S1-R6：日报邮箱空态修复验收（2026-09-24）

- Status: LOCAL VERIFIED / NOT DEPLOYED
- Scope: `daily-digest.v2` 的新输入快照、校验与 Shadow 回执、网页和邮件渲染。
- Authority: `server/digest-v2-contract.ts`、`server/digest-v2-service.ts`、`server/digest-v2-render.ts` 和 `server/digest-v2.test.ts`；本页是该版本的验收快照。
- Do not use for: 推断隔离服务已升级、真实邮件已发送、收件箱已收到或第一阶段已放行。

## 结果

新生成的日报把邮箱 `not_configured` 标为 `MAIL_NOT_CONFIGURED`，`failed` 标为 `MAIL_READ_FAILED`，`partial` 仍为 `MAIL_INCOMPLETE`；`complete` 且无邮件条目不产生邮箱警告。网页、邮件 HTML 和纯文本分别说明“未配置”“读取失败”“读取不完整”或“本期无新增内容”，输入 manifest、校验结果和发布回执使用同一警告口径。

旧 generation `2026-09-21.1`、`2026-09-22.2` 的警告与内容哈希规则保留；未过期旧 run 重试继续复用原产物，旧 Shadow 不因新规则改写。新规则从 `2026-09-24.1` 生效。

## 验证与边界

- 先用新增回归复现 `not_configured` 被当作空成功的问题；修复后相关测试 16/16、全量测试 287/287、typecheck、Shadow 编译、build 与 `git diff --check` 通过。测试使用合成数据，没有读取真实邮箱或发信。
- 这张卡不改变 [S1-R5 的历史证据](DAILY-DIGEST-S1-R5-READINESS-20260924.md)。此前“邮箱空态缺陷”在本地代码层已修复，隔离服务实际展示仍需单独部署后验证；真实日期仍只有 2/7，日程正向、真实新闻图、测试 CDN 缓存清除和收件箱层仍待验收。第一阶段整体继续不放行。
