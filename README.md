# Orbit

以对话为入口的个人事务中心：日程、待办、周期提醒、AI 记事、知识库和日报，提供 Web 与 Electron。应用版本以 [package.json](package.json) 为唯一来源。

## 文档入口

| 要找什么 | 唯一主要入口 |
| --- | --- |
| 当前阶段与下一步 | [route.md](route.md) |
| 各版本改了什么 | [CHANGELOG.md](CHANGELOG.md) |
| 已完成/待修复/待验收任务 | [docs/TASKS.md](docs/TASKS.md) |
| Agent 协作与安全规则 | [AGENTS.md](AGENTS.md) |
| 发布指令与效率原则 | [docs/RELEASE.md](docs/RELEASE.md) |
| 部署路径与回滚判据 | [docs/DEPLOYMENT-PATHS.md](docs/DEPLOYMENT-PATHS.md)；本机执行细节在被忽略的 DEPLOY.md |
| 配置、使用与常见问题 | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| 模块与跨项目边界 | [PROJECT-MAP.md](PROJECT-MAP.md)、[架构](docs/ARCHITECTURE.md) |
| 领域合同和历史证据 | [docs/README.md](docs/README.md)、[docs/archive/README.md](docs/archive/README.md) |

## 当前能力

- 默认进入 Orbit 主对话；其他事项单独开聊。生成时继续输入/排队/取消/重试，结果卡片可编辑；日程写入仍先确认。
- 当前安排查询、普通事项与周期事务、完成记录、附件、无日期待办及可选 CalDAV 单向桥接。
- AI 记事、词法知识召回、摘要/引用卡片和本地知识加工/发布；自动知识检索默认关闭。
- 独立主动聊天提醒、逐事项时间设置；设置 Tools 右侧的周/月/年个人统计。
- Local/Cloud 日报、持久媒体与阅读；V3/Research 的本地能力和真实自动链边界见任务清单。

源码存在、本地验证、生产上线、真实 AI 与手机/邮件送达分别记证，不能由页面可打开推断全部完成。

## Windows 本地启动

要求 Node.js >=22.13.0、npm 和仓库锁文件。首次安装：

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

在被忽略的 .env 中填写随机 JWT/备份密钥、首次初始化的邀请码以及需要的邮箱配置；开发使用 APP_ENV=development、APP_URL=http://localhost:5173/assistant。生产邀请码规则与账号配置见用户指南。AI Key 登录后按账号保存，服务器级旧 CODEBUDDY_API_KEY/CODEBUDDY_BASE_URL 会阻止启动。

```powershell
$env:APP_ENV = 'development'
$env:BACKGROUND_JOBS_ENABLED = 'false'
npm run dev
```

前端 http://localhost:5173，后端 http://localhost:3000/api/health。只测试聊天主动提醒时另设置进程级 ORBIT_PROACTIVE_ENABLED=true；账号还需在侧栏开启。BACKGROUND_JOBS_ENABLED 会启动邮件等后台任务，不要为聊天测试开启。

## 开发验证

```powershell
npm run typecheck
npm test
$env:ELECTRON_APP_URL = 'https://build.invalid.local'
npm run build
Remove-Item Env:ELECTRON_APP_URL
git diff --check
```

build:client 已包含 Tools 和项目成长检查。涉及外部日报合同才在本机配置 DAILY_REPORT_V2_ROOT 并执行 npm run test:cross-project；CI 不读取个人路径。UI 改动按 [测试矩阵](docs/TEST-MATRIX.md)验收，不以构建替代实际渲染。

## 数据与发布

沿用 React/TypeScript/Vite/TDesign/Tailwind、Express/sql.js/npm；四个运行数据库及附件/媒体属于 data/，不提交或从生产回填。密码、令牌和授权码只在安全配置/账号存储，不写文档或 Git。

2 GB 服务器采用本地预构建、双端哈希、停写备份、原子切换、PM2/health/页面/静态资源验收与可恢复回滚。日常升级不运行 deploy.sh 或 deploy-continue.sh 的首次安装流程；发布、代码部署、Work 和发信权限分别判断。

MIT。字体与其他资源许可保留在各自目录。
