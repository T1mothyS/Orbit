# Orbit 测试与验收矩阵

- Status: LIVING；职责：测试入口、风险覆盖及各层证据边界。
- 本轮代码基线：33e3972 的 Orbit 第二阶段；文档与旧部署入口调整见更新日志。
- 历史逐次数量、回放、截图和生产记录已集中到 [归档矩阵](archive/engineering/TEST-MATRIX-20261001.md)。历史通过不代表当前 HEAD 通过。

## 本地验证

| 入口 | 必须覆盖/证明 |
| --- | --- |
| npm run typecheck | 前端、Node、Electron TypeScript；不是运行验收。 |
| npm test | server/*.test.ts 的隔离数据与合成外部边界；后台发信关闭。 |
| npm run build | Web + Electron；使用进程级合法 HTTPS ELECTRON_APP_URL。客户端已执行 tools/evolution 检查。 |
| npm run test:cross-project | 显式 DAILY_REPORT_V2_ROOT；Cloud 模板、解析/完整性和发布接口契约；使用隔离账号和假 SMTP。 |
| git diff --check | 当前和暂存改动的空白/冲突标记检查；另核秘密和运行产物。 |
| 文档整理 | 本地 Markdown 入链、迁移前后归档正文（除路径）一致、旧入口兼容、评测 JSON 路径稳定。 |

不重复完整检查；失败修复、源码/依赖/构建输入改变后相关证据重新形成。发布以冻结目标的本次实际结果为准。

## 重点行为

| 领域 | 自动/合成覆盖 | 必须另行验收 |
| --- | --- | --- |
| 账号/备份 | 认证/归属、旧备份、替换/合并/跨账号 ID、四库同步事务和故障回滚 | 生产恢复演练、真实附件/媒体可恢复性 |
| Orbit | 入队发送日、跨午夜/时区、确认指纹/幂等、主对话唯一/旧历史、卡片编辑、取消重试、知识实际引用/阅读、统计分母/周期去重、主动静默/过期/改期/动作及独立 worker | 真实模型修改与召回、自然提醒、账号使用质量、网页外通知/手机 |
| 日报 V2/Cloud | 完整性、时间/精确重复、输入状态、媒体许可/字节/托管、Shadow 与 production、队列幂等、账号隔离 | 实际输入/检索充分性、用户内容体验、跨日运行、真实图片下架/恢复、OAuth/Work、收件箱 |
| V3/Research | 有界评测输入与答案隔离、不可变版本/引用冻结、人工提交和确认、租约/恢复 | D08 自动建议质量、D09 人工纠正整卡、真实 Agent/Work/Shadow；源代码存在不放行自动链 |
| CalDAV | 稳定 UID、投影/归并/完成策略、锁/自动重试/恢复互斥 | 手机更新/删除/提醒、断网和 24h；协议回执不能代替真机 |
| Tools/成长 | 清单/hash、受保护跳转、生成数据校验 | 本次浏览器实际渲染；个人统计不进入共享工程 JSON |

## UI 验收

UI/交互改动使用实际浏览器：390×844、430×932、768×1024、1440×900，明暗主题；核心控件、长文本、横向溢出、加载/空/错误/禁用态、键盘和焦点。使用合成数据的截图要注明，不能写成生产账号行为通过。

2026-10-01 Orbit 第二阶段已有上述四尺寸明暗 UI 证据、366/366 服务测试、typecheck 与 build；真实模型质量和自然定时未验。文档/部署入口整理未修改该 UI，复用同一业务代码证据，生产验收只核此次页面/资源与明确可读状态。

## 发布与外部层级

| 层级 | 成功证据 | 不能据此宣称 |
| --- | --- | --- |
| Git/Release | main/tag/目标 SHA/Release URL 互相一致 | 已部署 |
| 代码部署 | 包 SHA、停写备份、暂存/排除清单、.deploy、PM2、loopback/public health、页面与实际 JS MIME/hash、回滚材料 | 登录、AI、Cloud 或邮件成功 |
| 登录/AI | 经授权的真实会话与具体输入/保存结果 | 所有模型场景稳定 |
| Cloud | 实际 Work 输入/Prompt/contract、内容/媒体、dry-run/正式状态 | SMTP 或收件箱 |
| SMTP | 真实队列和 provider accepted/feedback | IMAP 收件箱到达 |
| IMAP | 实际收件箱对应 MIME/消息及日期 | 自然以后运行、手机可靠性 |

未执行的层明确写未验，不为验收自动发信/切换 Work。流程见 [发布](RELEASE.md)和[部署](DEPLOYMENT-PATHS.md)。

- Orbit 当前操作回归：server/orbit-plan-state.test.ts 覆盖短句修订、原始日期锚点/时长、账号隔离、挂起/取消、过期、缓存清空后直接确认、revision 冲突、重复确认和备份挂起。实际模型召回质量仍需独立验收。

- ChatGPT 合成合同：chatgpt-provider.test.ts 覆盖 JWT 签名/nonce/audience、登录权限不足、账号隔离、本机 host 保留、loopback/PKCE、并发刷新与令牌替换、临时失败、namespace 工具、SSE 断线/错误和撤销失败。通过不代表真实 OAuth/额度/模型能力通过。
