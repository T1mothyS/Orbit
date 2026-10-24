# Orbit PVE 迁移检查表

- Status: RUNBOOK；执行勾选和证据保存在 [报告](MIGRATION-REPORT.md)及本机记录。
- Scope: 每次阶段推进；空白环境与生产环境分别留证。
- Authority: [计划](MIGRATION-PLAN.md)、当前源码和 [部署路径](../DEPLOYMENT-PATHS.md)。
- Update trigger: 数据、接入、运行或验收合同变化。

## 0～2：审计与空白环境

- [ ] 记录本地、远端、线上三种版本/commit，不混用。
- [ ] 核对 PVE 资源、存储、桥接、OpenWrt 配额及保留余量。
- [ ] 核对根域、测试子域、MX/TXT、Worker/R2、Access、WAF、缓存和 Tunnel。
- [ ] 记录生产四库及所有文件资产的大小/归属，不读用户正文或输出凭据。
- [ ] 记录生产独立服务、代理、timer、PM2 进程环境和 release 外密钥文件存在性。
- [ ] 核对镜像来源、SHA-256、签名验证范围和 VM 独立 DHCP 地址/网关。
- [ ] Node 满足 package.engines，Linux x64 原生模块运行探针通过。
- [ ] 独立非 root 用户、DATA_DIR、配置、日志；应用代码不拥有系统管理权限。
- [ ] 关闭 BACKGROUND_JOBS_ENABLED、ORBIT_PROACTIVE_ENABLED、ANDROID_PUSH_ENABLED、CalDAV 写入及生产外部凭据；不注册正式 Work 任务。
- [ ] 独立随机密钥、合成账号；正式数据、正式 Firebase、SMTP/IMAP 和代理凭据均未复制。
- [ ] 包哈希、完整 lock、冻结源码、帮助原文 hash、Tools、成长资源及 manifest 核对。
- [ ] 空白四库启动，登录/退出、合成数据创建/回读、应用重启保持。
- [ ] 新 VM 重启后 PM2、Nginx 与必要服务恢复；旧 VM 运行状态不变。

## 3：测试域名与 HTTPS

- [ ] Tunnel 凭据独立保存且权限最小，不打印 token。
- [ ] 只发布测试站点，无 LAN 路由、SSH 或 PVE 管理入口。
- [ ] Nginx 仅回环入口；应用默认可能监听所有地址，必须用 VM 防火墙阻止直接访问 Node 端口，并从 LAN 实测。
- [ ] 根据实际转发头配置 TRUST_PROXY_HOPS；Host、HTTPS、来源 IP 不可由公网直接伪造。
- [ ] 登录、Secure Cookie、重定向、跨域和受保护静态资源通过。
- [ ] API、OAuth、MCP 和认证内容不被缓存或交互式质询阻断。
- [ ] SSE 首字节/持续输出、长请求、上传大小、附件下载 MIME/hash 通过。
- [ ] 家庭 Wi-Fi、手机蜂窝和外部机器客户端分别验证，记录失败率/延迟。
- [ ] Tunnel 服务重启/断网后恢复，记录 QUIC/HTTP2 实际协议。

## 4～5：批准后正式迁移

- [ ] 取得生产停写、数据/密钥传输和根域切换的逐项批准，记录窗口与回滚负责人。
- [ ] 冻结相同版本；若旧机要先升级，先另行授权和验收，不能混入数据搬迁。
- [ ] 停止全部正式写入和唯一 worker；等待 sql.js 受控关闭与端口/进程核验。
- [ ] 停写后检查恢复 marker、四库及所有资产，生成受控 SHA-256/权限清单。
- [ ] 完整备份、异机副本和实际恢复测试通过；PVE snapshot 不替代一致性备份。
- [ ] 复制后核 hash/数量/权限/属主，不在电脑仓库落生产数据。
- [ ] 保留加密 key、OAuth 关联、客户端绑定和独立服务配置，不重新生成正式 vault key。
- [ ] APP_URL、issuer/resource、旧媒体绝对链接、邮件链接和固定客户端地址有处理方案。
- [ ] 新机内部验收完成且 worker 关闭，再按批准切换根域并启用唯一 worker。
- [ ] 验证旧域兼容入口只转发到唯一新数据源，旧生产不能继续写旧库。

## 6～7：业务和恢复

- [ ] 登录/退出/改密，日程/无日期待办/周期提醒与账号隔离。
- [ ] AI 列表、真实生成、流式输出、受控确认；知识库、记事、附件、日报、成长和设置。
- [ ] OAuth metadata、register/authorize/token、PKCE、resource/scope、refresh 与真实 ChatGPT MCP 工具调用；旧令牌跨域不能假定有效。
- [ ] Work 读取、正文、完整性、媒体、dry-run、保存/发布、队列分别记录。
- [ ] 获单独批准后测 SMTP accepted，再独立验证收件箱；未发信不能勾选。
- [ ] 现有 CalDAV 服务/自动桥接、模型和媒体代理、FCM 与 Android/Electron 固定地址逐项处理。
- [ ] 开机、网络中断、服务失败恢复，日志轮转、磁盘/内存/health 告警有证据。
- [ ] 定期加密一致性备份、独立故障域副本、恢复测试与保留策略完成。
- [ ] 观察至少 48～72 小时，回滚演练通过；旧 ECS 与恢复材料保留。

任何缺失证据标为“未验证/阻塞”，不能用 health、PM2 online、QUEUED、SMTP accepted 或历史测试代替。
