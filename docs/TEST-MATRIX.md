# AI Calendar Test Matrix

项目成长：运行 `server/project-evolution.test.ts`、`npm run evolution:history` 和 `scripts/project-evolution-browser-smoke.cjs`。覆盖模型与历史真实性、认证、架构差异、顶部入口、四尺寸明暗主题及深链接；浏览器使用合成 API，真实认证由独立 HTTP 测试覆盖，均不等同生产验收。详情见 [维护说明](../project-evolution/README.md)。

- Status: LIVING
- Scope: 本文列明的源码结构、合同或验证方法；历史证据按时点使用。
- Last verified commit/version: `0.31.11-260926.2021`（2026-09-26，V2.5 列表重点新闻封面与标题在本地和隔离站验证；正式生产与发信仍未验收）。
- CalDAV 补充验证：2026-09-18，隔离 POC 与主应用回归；仅覆盖下述独立入口，真机尚未验证。
- Authority: 当前源码与自动化验证优先；文档职责见文档索引。
- Update trigger: 本领域 API、数据归属、媒体策略或验收入口变化。
- Supersedes: 原文中已纠正的漂移描述；保留历史快照时间边界。
- Do not use for: 推断当前生产部署、Work 配置或邮件收件箱状态。

本矩阵区分自动化、浏览器手工和生产验收。单元测试通过不等于浏览器 UI 正常；浏览器页面正常也不等于生产部署、SMTP 接受或收件箱最终到达。

2026-09-19 增量验证：`schedule-time.test.ts` 和 `unscheduled-api.test.ts` 覆盖共同日期约束/旧数据兼容；`dependency-security.test.ts` 覆盖升级后的邮件解析及依赖输入；`daily-report.test.ts`、Cloud API 测试覆盖媒体计数、版本、账号及恢复。具体数字、浏览器尺寸与未验证范围见[本次修复快照](FORMAT-SECURITY-REPAIR-20260919.md)。

2026-09-22 浏览器补验：合成 Shadow 在四种规定尺寸的明暗主题实际截图检查通过，覆盖缺失输入、长正文、图片、返回列表、禁用投递与刷新保留主题。窄屏列表圆点贴边已通过显式缩进修正；邮件 HTML 在桌面与390宽度检查，仅证明浏览器排版，不代表真实邮箱。

## 1. 通用命令

隔离服务增量：`server/digest-shadow-server.test.ts` 实际启动独立子进程，验证后台任务被强制关闭、合成账号登录、匿名日报拒绝、已登录测试账号的 QQ 邮箱设置/删除/只读测试接口、其他业务写入拒绝与 MCP 认证边界。`digest-v2.test.ts` 另覆盖两版正式发布与邮件入队在 Shadow 模式被拒绝。`npx tsc -p tsconfig.shadow.json` 验证独立服务构建；Linux 图片处理、真实 OAuth 与 Work 连续运行仍须独立验收。

Daily Digest V2.5 增量入口：`server/digest-v2.test.ts` 覆盖结构/空内容/重复与断裂引用/非法 URL/成功输入遗漏、纯校验无写入、账号/过期隔离、图片解码与超限/超时/失败降级、并发幂等、四处中断恢复、七类合成 Shadow、带媒体字节的备份恢复和 MCP/HTTP 权限。`scripts/digest-v2-r2-smoke.ts` 使用专用测试配置检查真实上传、重复上传、私有接口/公共地址哈希、仅合成对象删除及独立副本恢复。`scripts/digest-v2-preview.ts` 提供本机合成页面与邮件 HTML，无真实 SMTP。

S1-R6 邮箱空态回归使用合成快照，分别检查 `not_configured`、`failed`、`partial`、`complete` 且零未读在输入清单、校验/Shadow 回执、网页、邮件 HTML 和纯文本中的区别；另查旧版 generation 的未过期 run 重试保持内容哈希与同一产物。不读取真实邮箱、不发信；真实邮箱客户端仍须单独验收。

S2-03/04 存储与备份：`npx tsx --test server/digest-v3-store.test.ts server/core.test.ts` 使用临时旧版 `activity.db` 和隔离账号，验证重复迁移、旧记录保留、四类实体写回/重启、账号隔离、不可变版本、写回失败回滚、账号加密备份、同账号替换、跨账号 ID 与引用重映射、旧备份兼容、断裂引用拒绝。它不验证 V3 对外接口、案例自动分类、生产恢复演练或真实 Shadow；这些仍属后续层级。

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

[S1-R4 验收快照](DAILY-DIGEST-MEDIA-R4-RETIREMENT-VERIFICATION-20260923.md)记录新建测试对象的公开引用、对象删除、从独立镜像恢复、再次删除和公开 404；相关账号/全站备份合成测试通过。测试桶目前只有 `r2.dev` 开发地址，没有可验收缓存清除的自定义域名；对象删除不能替代 CDN 单文件清除或真实媒体下架。
