# Orbit 家庭 PVE 迁移计划

- Status: LIVING / 分阶段执行；当前结果只在 [执行报告](MIGRATION-REPORT.md)维护。
- Scope: 从现有 Linux 生产环境迁到独立 PVE Linux VM；不改变应用架构。
- Authority: 冻结源码、发布清单和现场探针；[发布](../RELEASE.md)、[部署路径](../DEPLOYMENT-PATHS.md)继续约束发布。
- Update trigger: 迁移目标、资源、数据范围、接入或审批边界变化。
- 真实入口、IP、文件位置和执行命令只保存到被忽略的本机 runbook。

## 目标与结构

正式根域名和独立测试子域名由本机任务书指定。公网流量经过 Cloudflare Tunnel、VM 内仅回环监听的 Nginx、Orbit。PVE、SSH 和 Node 端口不发布到公网。Orbit 不部署在 OpenWrt 内，不修改家庭分流、主路由或 OpenWrt 配置。

初始资源为 2 vCPU、3 GiB RAM、40 GiB 虚拟磁盘，创建前按实际余量核对。优先 Ubuntu Server 24.04 LTS，使 glibc、架构和既有 Linux CI 接近；镜像从官方源获取并校验。内网地址优先 DHCP，不猜测固定地址可用；检查实际默认网关与 DNS。

应用使用非 root 身份和 PM2 单 fork 进程。代码 release、DATA_DIR、配置、日志、备份分别存放；更新代码不能覆盖持久资产。VM、PM2、Tunnel 的自启与恢复逐层验证。

## 阶段与退出条件

| 阶段 | 执行内容 | 退出条件 |
| --- | --- | --- |
| 0 | 仓库、生产、PVE、Cloudflare 只读审计 | 实际版本、资源、入口、依赖和未知项有记录 |
| 1 | 新建隔离 VM，准备系统与目录 | 新 VM 独立联网、重启恢复；既有 VM 不受影响 |
| 2 | 冻结本地源码，准备 Linux 包和空白测试实例 | 包/manifest/原生依赖核验，登录、读写、重启和浏览器检查 |
| 3 | 独立测试域名与 Tunnel | HTTPS、机器客户端、流式、上传/下载和外网路径验收 |
| 4 | 制定资产清单、停写和恢复方法 | 完整迁移范围、密钥关联、容量与恢复证据齐全 |
| 5 | 人工批准后停写、迁移、根域切换 | 单一写入端、唯一 worker、数据一致性核验 |
| 6 | 按 [检查表](MIGRATION-CHECKLIST.md)逐项验收 | 基础、OAuth/MCP、客户端、日报与外部服务分别记证 |
| 7 | 观察 48～72 小时，恢复演练与异机备份 | 重启、断网、备份恢复和回滚条件均验证 |

Phase 0 可保留明确未知项继续进行可逆的空白环境准备；这些未知项若影响正式迁移，必须在 Phase 5 前关闭。阶段完成不能由下一阶段的存在反推。

## 版本和发布包

本次以用户指定的本地版本和 commit 为源，不从 GitHub main 或当前生产版本替代。未来同步 GitHub、阿里云属于另外的授权，不自动 push、Release 或部署旧生产。

优先使用对应冻结提交且成功的 `orbit-linux-release`。旧 artifact 的源码和版本不代表当前目标；本机保留的旧 Linux runtime 仅在完整 lock（排除根版本字段）、平台、Node、归档 SHA-256 和原生探针均满足时复用依赖。目标源码、dist、帮助索引、Tools、成长资源重新组装并形成当前目标的 manifest。不能把旧包改个版本号充当新发布，也不搬 Windows node_modules。

完整包按现有发布合同包含 server、dist、protected-tools、project-evolution/generated.json、server/.product-help.json、依赖及锁文件。源码和构建输入不同时停止；原生探针与新环境服务验证不可省略。

## 数据和依赖范围

四库之外还需盘点附件、日报媒体、备份、恢复日志、CalDAV 状态、operations、work-media-probe、DATA_DIR/.orbit-secrets，以及 release 外的 Firebase 文件、独立 CalDAV 服务、模型/媒体代理、规则文件、timer、PM2 环境和部署配置。普通账号备份不能替代全机迁移。

sql.js 把数据库加载进内存；没有 WAL 不代表活库复制一致。迁移必须停全部正式写入源、等待受控关闭，再做文件级备份和校验；恢复 marker 不能擅自删除。密钥只在受控机器间迁移，不进入聊天、Git 或发布包。

OSS 内网 endpoint 必须换成可达的公网 endpoint 并核权限；是否实际启用以配置存在性和受控运行证据为准。正式媒体可能包含旧域名绝对地址，需扫描/验证其引用，不盲目全库字符串替换。旧域名可保留转发到唯一新数据源的兼容入口。

## 审批和风险

以下操作分别需要明确授权：旧生产停/重启、复制/恢复生产数据、迁移密钥、正式 DNS/流量、启用正式 worker/邮件/推送、Work 连接/排程、客户端发布、GitHub 发布及删除恢复材料。Phase 5 必须另行人工批准。

根域已有记录不覆盖；邮件 MX/TXT、其他 Worker/R2 绑定保持独立。Tunnel 不发布 LAN 网段。新增安全访问、持久凭据或公网暴露在实际操作时复核授权。

主要风险：家庭停电/合盖/断网，Tunnel 大陆路径，跨域 OAuth 和客户端固定地址，独立代理/CalDAV/FCM 遗漏，以及切换后的数据分叉。措施和操作顺序见 [Runbook](MIGRATION-RUNBOOK.md)，实际证据见报告。

## 外部依据

- [Ubuntu 官方镜像](https://cloud-images.ubuntu.com/releases/noble/release/)：选择实际冻结的镜像和校验清单。
- [Ubuntu 镜像校验](https://ubuntu.com/docs/public-images/public-images-reference/artifacts/)：有官方 keyring 时进一步核验签名；仅核 SHA-256 时如实记录范围。
- [Cloudflare Tunnel 防火墙要求](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)：出站 TCP/UDP 7844；TCP 探针不证明 QUIC、实际 Tunnel 或跨网稳定性。
