Method: dual-agent (A: /root/regression_design · B: /root/regression_technical)

# Orbit UI/UX Harden 定向回归 — 2026-10-09

- Status: SNAPSHOT；八项本地修复与定向回归通过，不作为部署或设备验收。
- Target: `src/App.tsx` 所承载界面中，用户确认的四项 P1 和四项 P2。只核查八项修复及直接相关回归，不重做全站 128 组合、Nielsen 评分或整体设计方案。
- 开始基线：`codex/orbit-system-assistant / 4a6a7bd`，工作区 clean，版本 `0.56.0-261008.2256`。按当前磁盘代码重新定位，未 reset、stash、checkout 或覆盖其他任务修改。
- 修复版本：`0.56.1-261009.0651`。项目 AGENTS §7 明确要求应用代码变更同步版本，因此增加 PATCH；根 package.json、lock 顶层和根包同步，界面沿原版本读取。无依赖变化、数据库迁移、通知核心或 AI 写入确认变更。
- 方法：A 独立源码/视觉/交互评估；B 独立窄范围 detector、源码和浏览器技术检查。两者创建各自的新标签，串行使用全局视口；A 完成独立分析后 B 结果才进入综合结论。主任务另有实际键盘、保存回读、主题和四尺寸证据。
- 最终应用源码清单含 12 个文件，清单 SHA256 `DA68971C2B98B16602306BA4C2FF156B037A566E8EFA79561408FA3C643EFA45`。原始报告、布局数值、截图及日志留在忽略的本机证据目录，位置只记入本机连续记录，不复制真实配置或数据。

## 八项结果

| 编号 | 优先级 / 问题 | 最终状态 | 实现与实际证据 |
| --- | --- | --- | --- |
| 1 | P1：时间取消仍修改父表单 | FIXED | 打开复制当前值，选择只改内部 draft，确定才写回。09:00–10:00 修改后取消/Escape 仍为原值，重开重新初始化；确定 11:01 后联动 12:01。23:59 得到次日 00:59，合成保存及重开编辑保留跨日结束日期。 |
| 2 | P1：时间选项无法键盘操作 | FIXED | 项目现有 TDesign 时间面板仍依赖点击，不直接满足要求；复用原生 `select size=5` 保留小弹层。方向键选值，Enter/Space 依次进入分钟和确认，Tab 自然进出，Escape 取消并回到入口。实际选中值、原生 option 语义与 2px 焦点轮廓可见；00:00 与普通已有事件联动已核查。 |
| 3 | P1：暗色普通链接低对比度 | FIXED | 共享 link token，常态/visited 下划线，hover/active 为主题正文色，focus-visible 有轮廓。账号设置与偏好页实际明暗 normal/hover/focus 均核查：普通文字最低 4.95:1；暗色分别 5.77:1、6.97:1。Portal token 单独核查，未仅按根样式推断。 |
| 4 | P1：日历箭头缺少名称 | FIXED | 主日历按日/周/月/agenda 标记“上一天/上一周/上一月/上一天”及对应下一项，与实际导航步长一致；SVG aria-hidden。四视图名称与键盘聚焦已实际核查，原视觉保持。 |
| 5 | P2：热图 168 次无意义 Tab | FIXED | 格子改为非交互 span，保留 title tooltip，整体图表有名称/说明。“查看详细数据”展开 caption、7 个星期行标题、24 小时列与 168 值。Tab 进入具名内部滚动区，下次直接离开；390px 根宽仍 390，表格仅自身横向滚动。无逐小时钻取。 |
| 6 | P2：设置关闭焦点落 BODY | FIXED | AppShell 在打开设置前保留可见头像焦点；SettingsDialog 关闭检查入口可见性，并按头像/搜索选择 fallback。头像的两种设置入口、Escape、关闭按钮和遮罩路径均实际返回可见 summary；原 trap 和 inert 保留。 |
| 7 | P2：手机高频触控偏小 | FIXED | 复用 `--orbit-touch-target:44px` 和已有移动断点，覆盖完成、周期、日报返回/更多、设置操作与代码复制。390px 完成/图标/设置关闭均 44×44，日报及文字按钮高度 44；agenda 同步第一 grid 列，复验与时间栏交叠 0px，点击时间栏不会完成事件。桌面原密度保持。 |
| 8 | P2：长记事重复进入操作名称 | FIXED | 选择、编辑、保存、优化/撤回、复制、完成/恢复和合并均使用简短动作 + 当前卡片编号。长记事可访问树中正文独立出现，操作读为“编辑记事 2”等，Tab 焦点可见。未改变记事保存、优化或事务流程。 |

## 复审发现与补修

A 首轮在 390px 发现扩大至 44px 的 agenda 完成按钮仍放在 26px grid 列，侵入时间栏 13px；这属于本轮引入的具体回归。补修仅同步移动第一列为 44px，保留原 78px/窄容器 58px 时间列。独立增量复测得到 `44px 58px 158.667px`，完成与时间之间有 5px 间距、交叠 0px；时钟命中时间栏，实际点击只打开详情，长标题在自己的列截断。

主任务截图复核还发现 native 时间列表未聚焦列浅色选中底/白字不够清楚。补修为现有浅品牌底 + 主题正文色，明暗独立增量检查通过；聚焦列仍使用 Chromium 原生蓝底白字，B 实测 5.368:1，未聚焦列浅色 15.366:1、暗色 11.106:1。保留原失败截图和增量证据，不把首轮结果改写为从未出现问题。

最终设计 Assessment A 为八项 FIXED。没有新增重设计建议、动画库或将原审计中的认知负荷观察顺手扩展为本轮任务。

## 技术检测与验证边界

- B 成功窄扫 10 个 markup 组件，detector exit 0、返回 `[]`，0 项规则发现和位置；首个尝试含两个不存在路径，partial exit 1，纠正后重新执行一次，未冒充完整成功。此检测器不验证时间事务、焦点恢复或实际 CSS 对比度，结果不能替代浏览器实测。
- CUA evaluate 是只读接口，未注入检测脚本、未启动 overlay server，也没有声称存在用户可见 overlay；以独立真实浏览器、可访问树、计算样式、尺寸与截图作为技术证据。
- B 独立实际验证时间 draft/取消/Escape、方向键/Tab/Enter/Space、明暗选中状态、四种 Calendar 名称、设置 Escape/关闭/遮罩回焦和长记事短名称；账号链接明暗三态与偏好页暗色三态均通过。另直接读取热图 168 span、0 button/Tab stop、7 行和 168 值/25 个表头结构。偏好页浅色、热图展开滚动与手机触控几何没有完成独立补测：合成父表单原有 native discard confirm 导致 IAB 调度超时，恢复标签的交互也受阻；有限恢复后停止，没有把源码或未响应点击写成通过，也没有据此判定产品回归。综合八项 FIXED 以主任务/A 的完整实际证据为基础。
- 主任务/A 实际覆盖 Calendar、时间、Settings、Usage、记事、今日、周期、日报、偏好与知识库设置的相关行为；四规定尺寸对时间/设置，明暗链接与长文本均有证据。具体数值与命令见 [测试矩阵](../../TEST-MATRIX.md#2026-10-09-uiux-审计八项加固)。
- `npm run typecheck`、525/525 `npm test`、最终 CSS 的 Web/Electron build 与 diff 检查通过；三项新增测试验证时间联动及月/年/闰日边界，无新增测试依赖。既有大 chunk 提示保留，未为消除提示扩大修改。交付检查核对 19 个本轮文件、12 个源码/测试/版本文件的冻结 hash、168 个本地 Markdown 链接与同步版本，未混入运行库、构建物或凭据。
- 隔离预览进程已按身份核对停止，两个预览端口无监听；主任务成功标签已关闭并恢复临时视口。少量自建临时标签因 data URL 策略或 native confirm 工具阻塞未取得手动关闭回执，均没有保留标记；没有操作用户标签或终止用户浏览器进程。
- 本轮未 push、部署、真实模型调用、真实发信或验证收件箱。没有 NVDA/VoiceOver 朗读、真实触屏、Android WebView 或实体手机测试；native listbox 跨浏览器/系统呈现和入口卸载 fallback 的实际设备场景仍需抽样。既有 Android 通知用户验收不受本轮影响。

## 本轮文件

- 界面/共享层：`src/components/AppShell.tsx`、`src/components/CalendarView.tsx`、`src/components/NoteBoard.tsx`、`src/components/UsageStatisticsView.tsx`、`src/components/calendar/ScheduleFormModal.tsx`、`src/components/calendar/schedule-presentation.ts`、`src/components/settings/SettingsDialog.tsx`、`src/styles/orbit-foundation.css`、`src/styles/orbit-statistics.css`。
- 验证/版本：`server/schedule-form-time.test.ts`、`package.json`、`package-lock.json`。
- 文档：`CHANGELOG.md`、`docs/UI-GUIDELINES.md`、`docs/TEST-MATRIX.md`、`docs/TASKS.md`、`docs/README.md`、`docs/archive/README.md`、本快照。原 2026-10-08 审计未修改；本机连续记录仅追加，证据和运行库不提交。

Questions skipped: 用户已明确八项范围、热图方案和执行授权，不需要新的设计决策。
