# AI Calendar Test Matrix

项目成长：运行 `server/project-evolution.test.ts`、`npm run evolution:history` 和 `scripts/project-evolution-browser-smoke.cjs`。覆盖模型与历史真实性、认证、架构差异、顶部入口、四尺寸明暗主题及深链接；浏览器使用合成 API，真实认证由独立 HTTP 测试覆盖，均不等同生产验收。详情见 [维护说明](../project-evolution/README.md)。

- Status: LIVING
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified version: `0.31.16-260927.1155`（2026-09-27，D02 第一轮内容基线与 D07 固定来源本地回归；真实媒体下架、正式生产与发信仍分别验收）。
- CalDAV 补充验证：2026-09-18，隔离 POC 与主应用回归；仅覆盖下述独立入口，真机尚未验证。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本矩阵区分自动化、浏览器手工和生产验收。单元测试通过不等于浏览器 UI 正常；浏览器页面正常也不等于生产部署、SMTP 接受或收件箱最终到达。

2026-09-19 增量验证：`schedule-time.test.ts` 和 `unscheduled-api.test.ts` 覆盖共同日期约束/旧数据兼容；`dependency-security.test.ts` 覆盖升级后的邮件解析及依赖输入；`daily-report.test.ts`、Cloud API 测试覆盖媒体计数、版本、账号及恢复。具体数字、浏览器尺寸与未验证范围见[本次修复快照](FORMAT-SECURITY-REPAIR-20260919.md)。

2026-09-22 浏览器补验：合成 Shadow 在四种规定尺寸的明暗主题实际截图检查通过，覆盖缺失输入、长正文、图片、返回列表、禁用投递与刷新保留主题。窄屏列表圆点贴边已通过显式缩进修正；邮件 HTML 在桌面与390宽度检查，仅证明浏览器排版，不代表真实邮箱。

## Daily Digest 内容与运行验收分层

2026-09-27 计划审计后，验收条件以 [D02 内容质量闸门](ROADMAP.md#d02-内容质量闸门2026-09-27-审计修订)、[第一轮质量基线](DAILY-DIGEST-D02-QUALITY-BASELINE-20260927.md)和 [分层放行](ROADMAP.md#顺序与验收闸门) 为准。七个真实日期不是统一前置；两个日期也不能自动证明内容质量。

| 层级 | 证据与不能推导的结论 |
| --- | --- |
| 格式/安全/引用 | 现有自动化与七类固定故障样本；`valid=true` 不代表来源真实、时间符合截点或内容无重复。已复现的校验缺口见 [审计快照](DAILY-DIGEST-PLAN-AUDIT-20260927.md)。 |
| 内容质量 | 在限定候选来源与截点内逐条评审选题、事实支持、重大漏项、重复、个人相关性和空新闻依据；旧 V2 对照仅辅助，重大失败不可被配图/格式得分冲抵。 |
| 真实集成 | 不同真实日期的 Work、OAuth、输入和展示；有图日/空态各证其场景。固定回放不冒充实时，重复同日生成不增加日期数。 |
| 媒体与恢复 | 共享引用、独立备份字节、可审计降级、删除/CDN/恢复各验；七天真实到期只证明生命周期，不要求其他本地任务等待。 |
| 生产与邮件 | 配置差异、回滚、单独授权、实际运行周期及网页/队列/SMTP/收件箱分层；本地 D07 获准不等于生产或第一阶段整体放行。 |

## 1. 通用命令

隔离服务增量：`server/digest-shadow-server.test.ts` 实际启动独立子进程，验证后台任务被强制关闭、合成账号登录、匿名日报拒绝、已登录测试账号的 QQ 邮箱设置/删除/只读测试接口、其他业务写入拒绝与 MCP 认证边界。`digest-v2.test.ts` 另覆盖两版正式发布与邮件入队在 Shadow 模式被拒绝。`npx tsc -p tsconfig.shadow.json` 验证独立服务构建；Linux 图片处理、真实 OAuth 与 Work 连续运行仍须独立验收。

Daily Digest V2.5 增量入口：`server/digest-v2.test.ts` 覆盖结构/空内容/重复与断裂引用/非法 URL/成功输入遗漏、纯校验无写入、账号/过期隔离、图片解码与超限/超时/失败降级、并发幂等、四处中断恢复、七类合成 Shadow、带媒体字节的备份恢复和 MCP/HTTP 权限。`scripts/digest-v2-r2-smoke.ts` 使用专用测试配置检查真实上传、重复上传、私有接口/公共地址哈希、仅合成对象删除及独立副本恢复。`scripts/digest-v2-preview.ts` 提供本机合成页面与邮件 HTML，无真实 SMTP。

D03 媒体恢复增量：合成测试检查同日报两条引用共用一个 R2 键、跨日期相同图片使用不同 `tmp/` 键、本地备份只保存一份共享字节、整批恢复先校验再写入、旧键兼容；专用测试 Bucket 的 `digest-v2-r2-smoke.ts` 检查日期键、公共 `no-store`、源站删除和两条引用从一个本地副本恢复。对象生命周期需要在 Bucket 设置中核对 `tmp/` 七天删除且无覆盖 `published/`/`fallback/` 的到期规则；CDN 精确清除必须在绑定测试自定义域后以两个合成对象实测，不能用 `r2.dev` 或清除 API 的 200 回执代替实际缓存结果。

2026-09-27 D03 分层结果：`server/digest-v2.test.ts` 20/20、全量 `npm test` 296/296、typecheck、Shadow 编译和 build 通过。专用测试 Bucket 的合成对象完成上传、哈希读回、源站删除和两条引用从一个本地副本恢复；控制台确认 `tmp/` 七天删除规则启用且无覆盖长期对象的到期规则。测试自定义域中两个长期合成对象均实测从 `MISS` 转为 `HIT`；删源站后仍 `HIT`，逐一精确清除 URL 后分别得到 404，未清除的另一个对象保持 `HIT`。新临时对象连续两次读取均为 `BYPASS`、`no-store`，删源站后立即 404。以上证明配置与即时缓存行为；尚未观察七天后的自动删除，也不证明真实媒体下架、跨日期 Work 或正式生产 CDN。

2026-09-27 早版真实 Work Shadow：北京时间 10:57 截点，5 个成功 Mail input 全覆盖，Calendar/Watchlist 为 0；Work 产物的 `market`、`macro`、`stories`、`evidence`、`media` 均为 0，校验最终 0 errors/0 warnings。当时检索范围和候选排除记录不足，无法确认“没有重要新闻”。只保存 Shadow 产物，独立账号只读核对正式列表 0、邮件 `DISABLED`、通知 ID 为 null；网页与邮件 HTML 均有“今日情报简报”和 10:57 截点，无图片。列表原固定“今日重点新闻”标签已改为通用“最新日报”；独立站实看 390×844、430×932、768×1024、1440×900 和暗色主题，空新闻封面无占位图、无横向溢出。代码验证 `npm test` 296/296、typecheck、Shadow 编译与使用临时 HTTPS 地址的 build 通过。该早版是第四个真实日期，但没有新闻图片，不能计作 D03 改进后第二个有新闻配图日期；七日自动删除、真实媒体下架和邮箱收件箱仍未验收。

2026-09-27 真实媒体只读引用核对：隔离账号 API 中 15 份 Shadow 产物含 19 条媒体引用、12 个不同对象，5 个对象被多份产物引用，1 个对象跨日期引用，单对象最多涉及 4 份产物。最新 9/26 有图产物的 3 张资料照片和 2 张插画均从公共地址读回 200，字节 SHA-256 与产物记录一致；两张插画各被 2 份产物引用。此核对没有删除、改写或下载私人输入，不证明特定真实图片已完成私有备份恢复。历史产物冻结且当前没有引用替换入口，直接删除真实对象会损坏仍在引用它的日报，因此真实媒体下架仍需先解决引用处理、备份与页面降级，再做受控验收。

2026-09-27 D03 真实图片备份只读核验：对 9/26 最新有图 Shadow 产物的 5 张图片，逐张检查隔离服务器本地镜像与此前独立数据备份归档中的字节数和 SHA-256，两个位置均 5/5 与冻结产物记录一致；公共 R2 地址此前也为 5/5 一致。这证明该时点的镜像和备份确实包含所需字节，尚未执行真实对象删除、备份恢复或 CDN 下架。D02 本地增量回归用隔离临时数据库真实调用 `readDigestV2Inputs`：仅纳入本账号指定日期日程与一个关注项，排除其他账号日程和无固定期限待办；未配置邮箱保持显式警告；漏掉 Calendar/Watchlist 输入或使用外账号 ID 均被拒绝，完整内容只保存 Shadow 且不入队。定向测试 21/21、全量 `npm test` 297/297、typecheck、Shadow 编译、使用进程级临时 HTTPS 地址的 build 及 diff check 均通过。独立 V2 checkout 没有 9/26 或 9/27 的 `reports/final` 产物，现有 `run_daily.ps1 -NoSend` 只接受日期、不能重放 10:57 截点，因此本轮没有伪造“同截点旧 V2 对照”；后续须保存两边同一截点的输入快照后再比较。

`2026-09-27.1` 阅读样式增量：`server/digest-v2.test.ts` 检查正文 `**` 标记的校验、安全转义与纯文本去标记；详情头图先于标题且正文不重复、同来源编号复用、图片专用证据不混入新闻来源、真实图标与文字小标识、未知时间文案、图片署名精简及旧产物解码兼容。浏览器需实看桌面/手机封面、角标跳转、暗色主题和邮件 HTML；合成页面不证明运行中的 Work 已按新写作要求产出，也不证明真实邮箱显示。

S1-R6 邮箱空态回归使用合成快照，分别检查 `not_configured`、`failed`、`partial`、`complete` 且零未读在输入清单、校验/Shadow 回执、网页、邮件 HTML 和纯文本中的区别；另查旧版 generation 的未过期 run 重试保持内容哈希与同一产物。不读取真实邮箱、不发信；真实邮箱客户端仍须单独验收。

S2-03/04 存储与备份：`npx tsx --test server/digest-v3-store.test.ts server/core.test.ts` 使用临时旧版 `activity.db` 和隔离账号，验证重复迁移、旧记录保留、四类实体写回/重启、账号隔离、不可变版本、写回失败回滚、账号加密备份、同账号替换、跨账号 ID 与引用重映射、旧备份兼容、断裂引用拒绝。它不验证 V3 对外接口、案例自动分类、生产恢复演练或真实 Shadow；这些仍属后续层级。

D07 固定来源本地闭环：`npx tsx --test server/digest-v3-local-flow.test.ts server/digest-v3-store.test.ts` 用临时旧版库及 S2-01 P01 两条 NASA 来源，检查 Evidence→初版 Event/Revision→进展 Revision→Analysis→精确引用 HTML、原版不漂移、请求键幂等、截点与 URL 拒绝、跨账号预览拒绝、持久化失败整链回退及账号替换恢复。`npx tsx scripts/digest-v3-local-preview.ts` 另在新建系统临时目录输出发射前后两页供浏览器查看；无网络抓取、Work、正式发布、邮件或提醒。此路径没有自动匹配、通用分页、对外认证与跨进程并发保障，不能据此放行 D08 或生产。

2026-09-21 验证边界：真实 R2 测试成功，七类固定场景为合成测试。浏览器检查四尺寸、明暗主题、登录深链接、隔离列表与无发信入口；截图工具受限项目需在交付记录中注明。2026-09-26 的三个真实日期已暴露持续缺图；后续优先验收逐条新闻图片覆盖、重点/普通图片层级及改进后两个不同真实日期的 Work Shadow。Work 权限/实际 Prompt、OAuth 跨期、生产媒体域名/CDN 清除和真实邮箱仍分别验收；任何关键层未完成，都不能报告 V2.5 整体完成。

2026-09-26 逐条配图本地回归：`digest-v2.test.ts` 检查真实图、原创插画和缺图计数、每条独立插画、重点大图与普通侧图、旧产物排版兼容及图片上传失败的纯文字降级。合成新闻的 HTML 经浏览器实际检查 390×844、430×932、768×1024、1440×900，图片均加载且无横向溢出；这是浏览器中的邮件 HTML 预览，尚不是实际邮箱客户端或真实 Work 日报。

2026-09-26 首个改进后真实 Work Shadow：5 条新闻逐条配图（3 张有精确来源与许可的资料照片、2 张标明非现场的原创插画、0 条缺图）。五张图片的公共地址读回与已存哈希一致，网页和邮件 HTML 均含 5 个图片元素；邮件仍为 `DISABLED`，没有收件箱验收。实际网页初次检查发现通用表格样式把手机侧图挤出屏幕；局部修复后在独立站点以 390×844、430×932、768×1024、1440×900 复查，五张图片均加载且在可见宽度内，页面无横向溢出。单日同输入的再版只证明媒体选择和显示改进，跨日期、真实邮件客户端、媒体恢复与 CDN 清除仍待验证。

2026-09-26 列表补验：原隔离稿详情有五图，但 `/reports?view=shadow` 列表把 `digest.title` 测试标题当头条且固定返回空封面。新版投影从同一条有图的重点新闻取标题、摘要、本站图片和署名；无图旧产物改为单栏。新版详情及邮件展示栏目名由新闻有无决定，隔离稿原字段保留供审计。`digest-v2.test.ts` 覆盖列表投影与新旧标题显示，服务端 295 项测试、类型检查与构建通过。独立 Shadow 站点实际检查 390×844、430×932、768×1024、1440×900 及暗色主题：列表大图加载、标题与图一致、无横向溢出；最终版本又核对了桌面列表大图和详情“今日重点新闻”。未触及正式站、邮件或收件箱。

| 层级 | 入口 | 证明什么 |
| --- | --- | --- |
| 类型 | npm run typecheck | TypeScript 和 Node/Electron 配置可检查 |
| 服务端自动化 | npm test | server/*.test.ts 的业务、权限、数据和模板回归 |
| 构建 | npm run build | Web、Electron 代码和桌面暂存可生成 |
| 差异 | git diff --check | 没有明显空白错误 |
| CI | .github/workflows/ci.yml | push/pull_request 上重复执行安装、类型、测试和构建 |
| 浏览器 | 本地实际页面和指定 viewport | 路由、控件、布局、主题、交互和 console 状态 |
| 生产 | 按 DEPLOY.md | 备份、原子切换、PM2、health、静态资源和业务链路分层验收 |

## 2. 功能矩阵

| 功能 | 对应自动化测试/代码入口 | 手工验收 | 生产验收 |
| --- | --- | --- | --- |
| 登录、注册、账号隔离 | core.test.ts、admin-api-sharing.test.ts、auth 相关 API | 登录/退出、错误提示、不同账号看不到对方数据 | 真实账号登录和退出；不读取或复制生产凭据 |
| 日程、分类、冲突 | schedule-actions.test.ts、schedule-conflict.test.ts、schedule-store-legacy.test.ts | /schedule 创建、编辑、删除、月视图/时间视图和小屏 | 生产日历读写、时区和刷新 |
| 周期事务 | core.test.ts、reminder-store 相关测试、notification-scheduler.test.ts | /reminders 月末、逾期、完成、下一周期和操作反馈 | 生产周期任务与唯一 worker 行为 |
| 通知与邮件 | notification-service.test.ts、notification-preferences-client.test.ts、email-service.test.ts、user-mail-api.test.ts | 设置渠道、免打扰、失败/重试和错误状态 | SMTP accepted 与收件箱到达分开验证 |
| 日报 | daily-report*.test.ts、daily-digest-template.test.ts、daily-email-template.test.ts | /reports 列表、/reports/:date 阅读、媒体、版本更新和显式重发 | 发布接口、媒体托管、队列、SMTP 和收件箱逐层核对 |
| AI 计划和导入 | ai-intent.test.ts、ai-json.test.ts、ai-plan.test.ts、codebuddy-config.test.ts | /assistant 和 /import 生成草稿、确认前不写入、错误降级 | 真实 AI 另行授权；验证账号 Key 和服务限流 |
| AI 记事 | note-item.test.ts、note-export.test.ts、note-color-migration.test.ts、phase5-migrations.test.ts、scripts/prompt-optimize-browser-smoke.cjs | NoteBoard 创建/编辑/完成/恢复、原位优化锁定/覆盖、刷新后撤回、重复优化计数、手动新基线、版本冲突、两步合并、跨分区目标、超长错误、TXT/CSV、四视口明暗主题 | 生产数据备份、恢复和账号隔离；不把记事当待办；合成 AI 不代表真实模型质量 |
| 设置 | Settings V2 浏览器证据、notification-preferences-client.test.ts、user-mail-api.test.ts | 390×844、430×932、768×1024、1440×900；浅色/暗色、长文本、保存/取消/删除/撤销 | 真实设置读取/保存需授权；不把 synthetic API 证据写成生产验收 |
| Tools 挂载应用 | protected-tools.test.ts、scripts/tools-browser-smoke.cjs、ToolsPage、`GET /api/tools` | Settings → 挂载工具 → Tools；四视口、浅色/暗色、卡片链接、键盘焦点、无横向溢出；四个 HTML 应用真实打开效果 | 真实登录 Cookie、工具页面、Plotly/支付宝 iframe 降级和浏览器本地数据需单独授权验收 |
| 附件、导出和备份 | export-service.test.ts、core.test.ts、attachment 相关实现 | 下载、大小/MIME、检查备份、合并/替换取消路径 | 备份前快照、恢复演练、附件权限和回滚 |
| 管理员 | admin-api-sharing.test.ts、管理员 API | 普通用户隐藏管理入口；管理员危险操作有确认 | 维护模式、全站备份、恢复和删除必须单独授权 |
| 知识库 | library.test.ts；db、library-service、publish-token-service | `/library` 与 `/library/:id` 检查只读入口、搜索、关系状态、版本、评论、单条/全库导出；隔离 V2 批次验证 CREATED/UPDATED/UNCHANGED | 三篇样本只允许本地隔离账号；不读取生产数据库、不使用生产令牌、不部署 |

### 独立 CalDAV POC 验证入口

按照 [POC 操作说明](../infra/caldav-poc/README.md) 安装独立 Python 环境，然后运行 `python -X utf8 -m unittest discover -s infra/caldav-poc -p test_poc.py -v`。该套件用真实 loopback Radicale 和临时合成数据验证发现、只读/账号隔离、条件写入删除、重启及日志隐私；不包含在 `npm test` 中，不读取正式数据库，也不证明荣耀设备、TLS 或后台提醒成功。真机矩阵与阶段门槛见 [研究记录](CALDAV-HONOR-POC.md)。

## 3. UI Smoke Test 决策

仓库当前没有项目级 Playwright/Cypress 依赖和独立浏览器 fixture。Phase 2 使用了本机提供的 Playwright 与 Headless Edge，适合本地验收但不能直接证明 CI 可复现。

本阶段不新增浏览器依赖或庞大 E2E 套件，原因是：

- 需要先确定无真实账号/生产数据的登录和 API fixture；
- Playwright 浏览器下载会增加锁文件、CI 时间和维护边界；
- 当前 CI 先保证 npm ci、类型、服务端测试和构建稳定。

现阶段的最小 UI smoke 范围是 /login、/today、/schedule、/assistant、/reminders、/reports、/library、/tools，以及通过产品壳按钮打开 SettingsDialog（没有独立 /settings 路由）。另检查 /import 重定向到 /assistant?tool=email-import，并验证导入草稿及确认流程。Tools 的服务器门禁、Cookie、清单、未知 slug、路径遍历和 CSP 由 `protected-tools.test.ts` 覆盖；浏览器验收再覆盖 Settings 跳转、卡片和四个真实 HTML。下次引入项目级浏览器测试时，必须先补 fixture、console error 处理、viewport 断言和 CI 浏览器安装，再决定是否加入 workflow。

## 4. Bundle 观察基线

[Bundle 测量说明](BUNDLE-BASELINE.md) 使用生产构建 manifest 的静态 imports 闭包区分 initial 和非首屏 JS，记录全部 JS/CSS raw/gzip 与最大 10 个资源。测量脚本只读构建目录、不加载 .env、不构建、不发网络请求；不设置预算，不改 CI 或 Vite 警告阈值。脚本的合成 manifest 验证用 `node --test scripts/measure-bundle.test.mjs`，与现有服务测试分别执行。

## Phase 2 可重复浏览器 smoke

可选入口 scripts/browser-smoke.cjs，使用现有 Edge 与外部提供的 Playwright；未新增 npm 依赖，不是 CI 必跑项。先在无真实 .env/data 的源码副本完成生产构建，再执行：

```powershell
$env:PLAYWRIGHT_MODULE = '<现有 Playwright 包的绝对路径>'
node scripts/browser-smoke.cjs '<包含 dist 的隔离源码目录>'
```

默认证据写入系统临时目录，可用 BROWSER_SMOKE_OUTPUT 指定。仅启动随机端口的回环静态服务；拦截合成 API，阻止非本地网络，不启动真实后端。覆盖四 viewport、设置浅/暗色、导航返回、日期深链、日程草稿、焦点、富内容及分包失败。请检查输出截图；断言通过不等于所有视觉细节无误。结果与未覆盖项目见 [Phase 2 验收](PHASE2-FRONTEND-LOADING.md)。

## CalDAV 全量单向桥接

`caldav-bridge.test.ts`、`caldav-api.test.ts`、`caldav-control.test.ts` 随 npm test 覆盖全量/全部周期纯读、完成/恢复同UID且无提醒、历史保留、副本归并/孤立阻断、500/501容量、迁移备份、异常保留、授权/退避/批量删除、恢复及备份排他；core 的系统恢复覆盖账本与暂停状态。`infra/caldav-poc/bridge_smoke.py` 验证累计10个对象的真实 API/Radicale CRUD、完成/恢复与历史停用保留、只读权限、源库不变并保留原有9个seed。browser-smoke 覆盖四视口浅暗主题、长文本、操作/错误和启用门槛；这些不能替代荣耀手机提醒/后台/修改删除验收。具体边界见 [CalDAV 合同](CALDAV-BRIDGE.md)。

## Phase 3 故障与恢复

persistence.test.ts 覆盖原子替换、内存回退、第二库失败、补偿失败停止访问、持久执行结果和用户恢复；persistence-crash.test.ts 在独立子进程中模拟中断并逐字核对恢复；phase3-api.test.ts 覆盖两账号、import/plan 确认失败重试、部分计划失败和周期完成去重。全部加入现有 npm test。具体限制见 [Phase 3 验收](PHASE3-PERSISTENCE-RECOVERY.md)。

## 无固定期限待办管理

`unscheduled-api.test.ts` 覆盖只读、账号隔离、完成历史、状态切换、全天写入校验和旧备份恢复。`scripts/unscheduled-browser-smoke.cjs` 使用构建产物与合成接口验证四个规定视口、浅暗主题、完成记录、完成/恢复、编辑入口、空态/错误、Escape 和返回焦点；使用与既有 browser-smoke 相同的 PLAYWRIGHT_MODULE。不得把本地验证写成生产真机通过。

## 四项修复验收（2026-09-20）

- 自动化：CalDAV 锁拥有者、保守恢复、保护锁异常、I/O 错误、退避与成功复位；原有范围/删除/账户保护继续回归。
- 提示词：SDK 无工具及无持久化选项、边界校验、取消；记事优化/撤回成功与失败不变、累计次数、手动编辑清状态、重复操作 409、正文版本冲突、账号隔离和迁移默认值。
- Tools：`npm run tools:check` 检查全部启用源码；`npx tsx scripts/check-protected-tools.ts <解包目录>/protected-tools` 比较实际发布包清单和每个 HTML 的 SHA-256。缺文件或不一致阻止发布。
- 浏览器：四视口、明暗主题，成长页滚轮/键盘到底、移动触摸；记事板不出现 `role="dialog"`，优化期间编辑框锁定、结果原位覆盖、按钮切换撤回、刷新保留撤回、二次优化计数、手动保存清除撤回、失败/版本冲突不覆盖新正文；四个 Tools 与新工具合成数据操作。
- 本地合成验证不代表真实 AI、生产、手机或长期同步验收。生产分别检查网页、合成文本真实 AI、CalDAV preview 与至少两个自动周期。

## V2.5 单图许可与署名

`http-security.test.ts` 覆盖精确R2图片origin、禁用V2、非法/通配/凭据地址和生产r2.dev拒绝。浏览器验收检查CSP、图片naturalWidth和可见署名；单独打开图片成功不能代替日报内嵌显示。

server/digest-v2.test.ts 验证精确来源页/图片URL、同域未授权文件和重定向拒绝、审核副本哈希改变后降级、网页/邮件署名转义与许可证链接及快照保留。真实历史资料图与当日现场图、分类默认图分别报告；审核副本路径不算服务器直连成功。


### V2.5 Worker 与来源标识

- `digest-media-worker.test.ts`：签名绑定URL、有效期、精确主机、凭据URL/私网字面IP拒绝；拒绝跳转/HTML/超限流/超限请求，异常脱敏、不转发上游Cookie。
- `digest-v2.test.ts`：小尺寸图标PNG、来源链接展示、429独立降级、快照兼容、ICO底向上BGRA与透明掩码、越界/异常尺寸拒绝；图片与图标计数分开。
- 外部验收分别记录本机→Worker、应用服务器→Worker、Worker→源站、处理后R2哈希、四尺寸网页与邮件HTML。来源机构favicon通过不表示其新闻照片许可已通过；测试样本不计新真实日期。
- Worker部署与应用relay启用分开；服务器入口不可达时不得把本机结果写成Cloud发布成功。域名、付费套餐或DNS迁移按既有授权边界处理。

### V2.5 媒体恢复与下架

[S1-R4 验收快照](DAILY-DIGEST-MEDIA-R4-RETIREMENT-VERIFICATION-20260923.md)记录 2026-09-23 新建测试对象的公开引用、对象删除、从独立镜像恢复、再次删除和公开 404；相关账号/全站备份合成测试通过。当时测试桶只有 `r2.dev` 开发地址，未验 CDN。2026-09-27 测试桶已绑定独立自定义域，并按上方 D03 记录实测单 URL 清除；这仍不等于真实媒体下架。
