# Orbit 测试与验收矩阵

- Status: LIVING；职责：测试入口、风险覆盖及各层证据边界。
- 当前验收对象：Orbit P0–P7 基础升级候选；版本源为 package.json，具体结果见下方日期记录。
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

- ChatGPT 合成合同：chatgpt-provider.test.ts 覆盖 JWT 签名/nonce/audience、登录权限不足、账号隔离、本机 host 保留、loopback/PKCE、并发刷新与令牌替换、临时失败、namespace 工具及加密上下文原样接续、SSE 断线/错误和撤销失败。通过不代表真实 OAuth/额度/模型能力通过。
- 套餐流式形态：覆盖完成事件 output 为空、output_item.done 乱序收集、工具与加密项目保留，以及项目已完成但整体失败/中断的拒绝；真实本地 Orbit 适配器文本、namespace 工具往返及合成纯色图片理解已验证，服务器通道独立验收。
- ChatGPT 导入传输：http-security.test.ts 用真实 HTTP 请求模拟同机 HTTPS 代理与公网 Host 的明文请求，并验证远程伪造、IPv4/IPv6 loopback 和歧义协议头；不需要真实凭据或改变全局代理配置。
- Provider 代理隔离：codebuddy-env.test.ts 启动真实 Node 子进程与本机 HTTP fixture，验证 SDK 环境覆盖继承的原生代理开关、请求成功且父进程不变；真实 WorkBuddy/ChatGPT 同时可用仍需生产账号回归。
- 普通聊天格式：ai-json.test.ts / ai-intent.test.ts 覆盖真实附件追问输入、纯文本/Markdown、结构化优先、空/破损 JSON、日程意图及活跃/专属事项禁止降级；无有效 operations 不产生写权限。真实模型追问需发布后重测。
## 隔离 Orbit UI 预览

构建前端后运行 `npx tsx scripts/orbit-ui-preview.ts 4183`，仅监听 loopback，使用新的临时数据库和合成账号，不载入 .env、不启动邮件/主动提醒/真实模型。关闭进程后临时数据可人工删除；它不代表生产、真实 OAuth、搜索或模型验收。至少检查聊天终态、短句草稿修改、设置搜索键盘定位、阅读旧消息及 reduced-motion，再按本文窗口与主题矩阵检查布局。

## 2026-10-03 基础升级本地验收

398/398 服务测试、3/3 跨项目隔离测试、typecheck、Web/Electron 构建通过。包含持久草稿/冲突/幂等、账号能力证据、OAuth/Responses 合成协议、搜索预算/公共 URL 防护、Markdown/设置索引、真实字节图片和 PDF/Office worker、超旧 JSON 限额的 HTTP 上传、跨账号拒绝、SSE 终态、加密备份关联与缺失文件/账号清理。ExcelJS 的 uuid 定向 override 后重跑全套，Office 解析通过；依赖剩余告警见 SEC01。

真实浏览器使用临时合成数据库：9→10 同一草稿、刷新持久、挂起/恢复、文字确认仍需按钮、点击确认后 1 项日程/终态、完成提醒无动作、CSV 上传就绪/消息关联、无 Key 明确失败及重试入口、vision 别名定位/聚焦已验证。阅读旧消息时 top=1782 保持不变并出现“有新回复”。覆盖 390×844、430×932、768×1024、1440×900，并补充 1366×768 和 1920×1080；明暗、加载/空态、日历/弹窗、今日/周期/日报/知识库入口已检查。窗口变化瞬间的过渡帧不当成稳定布局结论。

未验证真实 WorkBuddy/ChatGPT/Tavily 账号、套餐资格/额度/官方工具行为、模型理解质量、系统 reduced-motion、低性能设备、Electron 安装包运行、生产迁移/恢复、自然提醒和真实 SMTP/IMAP/手机。reduced-motion 已做源码检查，没有修改系统设置冒充实测。合成 SMTP 只属于跨项目测试。

## 2026-10-03 续验：双 Provider 与会话创建

同一生产进程启用出网代理时，WorkBuddy/ChatGPT 分别返回合成标识；ChatGPT 账号模型目录、手动工具/图片能力验证通过。实际聊天上传合成 TXT/PDF/红色图片后正确返回两个文件代码和颜色；刷新后按具体文件名追问正确返回 TXT 中的会议室。多附件的含糊追问要求明确文件名，没有自动选错附件。WorkBuddy 9 点草稿→“改成十点”只变同一草稿 revision，刷新仍为版本 2/10 点，取消后没有正式事项写入。

新对话修复冻结源码通过 typecheck、408/408 测试与 Web/Electron staging build。隔离浏览器将创建接口延迟两秒，实际观察创建提示、输入/发送禁用；完成后恢复，返回原会话仍有未发送草稿。截图为合成账号，不能替代生产账号业务或用户满意度。

上述结果不证明所有模型、长期代理/订阅稳定性、撤销、Tavily 搜索、后台 ChatGPT、恢复演练、自然提醒、手机、收件箱或 Electron 安装包通过。后续新增证据按时间追加，不能将本节之外的层级改写为完成。
