# Daily Digest V2.5 S1-R3a：NASA Earth Observatory 单图审核

- Status: AUDIT-SNAPSHOT；2026-09-23 对下述一张图片准许进入隔离 S1-R3b 技术验收。
- Scope: 仅限指定文章和指定 JPEG。此记录不是整个 NASA、`science.nasa.gov` 或 `assets.science.nasa.gov` 的自动许可规则，也不批准正式日报或真实邮件发送。
- Authority: [原始文章](https://science.nasa.gov/earth/earth-observatory/an-epic-view-of-the-seasons/)、[NASA Earth Science 图像重用 FAQ](https://science.nasa.gov/earth/faq/)、[NASA 图片及媒体使用指南](https://www.nasa.gov/nasa-brand-center/images-and-media/)。政策或图片署名变化时重新审核。
- Do not use for: 证明服务器可下载、图片已处理或已写入 R2、网页/邮件正确显示、正式发布或收件箱到达；这些属于 S1-R3b 及后续验收。

## 单图身份与来源

| 项目 | 核对结果 |
| --- | --- |
| 对应报道 | NASA Earth Observatory《An Epic View of the Seasons》，页面标注 2026-09-22；未提供精确发布时间。 |
| 页面地址 | <https://science.nasa.gov/earth/earth-observatory/an-epic-view-of-the-seasons/> |
| 唯一审核图片地址 | <https://assets.science.nasa.gov/content/dam/science/esd/eo/images/iotd/2026/an-epic-view-of-the-seasons/equinox_epic_20240922_lrg.jpg> |
| 图片内容 | NASA DSCOVR/EPIC 的四张地球全景拼图，分别摄于 2023-12-21、2024-03-19、2024-06-20、2024-09-22；这是历史观测资料图，不是 2026-09-22 当天现场。 |
| 作者及数据来源 | 原文明确署名 “NASA Earth Observatory image by Michala Garrison, using data from DSCOVR EPIC”。显示署名使用 `NASA Earth Observatory / Michala Garrison；数据：DSCOVR EPIC`。 |
| 地址与目视检查 | 浏览器打开上述精确 JPEG，显示为 2460×2190 的四图拼版，无可见人物、品牌商标或第三方版权水印；NASA 页面提供的下载说明为 JPEG 3.07 MB。此处未保存或计算原图字节哈希。 |

## 权利判断与允许范围

NASA Earth Science FAQ 说明：`science.nasa.gov/earth` 的材料通常可重新发表和使用，包括商业用途；已标明第三方版权的内容需另向权利人取得许可，并要求为 NASA 原创材料署名。NASA 媒体指南允许事实性、非背书的使用，要求注明 NASA 来源，同时指出网站上可能包含 NASA 获准使用但未转授他人的第三方图片。本图的文章单独标注 NASA Earth Observatory 制图与 DSCOVR EPIC 数据，未标注第三方版权持有人。综合这些**针对该图的证据**，准许其进入隔离环境的事实性、非推广用途技术验收；这不是对整站图片的概括授权，也不将 NASA 政策称为 CC 许可证或一概称为公有领域。

拟验收范围：在与地球季节、DSCOVR/EPIC 观测直接相关的报道中，按比例缩放、转 JPEG、去除元数据并在图片旁保留作者、NASA 来源、[原文](https://science.nasa.gov/earth/earth-observatory/an-epic-view-of-the-seasons/)和[NASA 重用规则](https://science.nasa.gov/earth/faq/)链接，说明处理过尺寸/格式及实际观测日期。不得把 2024 年画面描述为 2026 年新闻现场；不得暗示 NASA 背书，不用于广告、周边、封面推广或 AI 训练，也不得借本规则使用页面其他图片、NASA 标识或含人物的图片。与当前 AI/宏观日报主题不匹配时不应为了配图强行引用。

## S1-R3b 交接边界

仅在隔离测试服务中为 `pageHost=science.nasa.gov`、上述精确 `pageUrl`、`imageHosts=[assets.science.nasa.gov]` 和上述唯一 `imageUrls` 配置规则；政策枚举使用 `EXTERNAL_ALLOWED`，`licenseRef` 指向 NASA FAQ 和媒体指南，`credit` 记录上表署名、观测日期、原文及规则地址。不得配置仅按主机名放行的宽泛规则。重定向目标仍须命中审核过的精确图片地址。

S1-R3b 再独立验证实际下载方式、原始字节哈希、图像解码与转码、R2 读回、网页和邮件 HTML 的可见署名及失败降级。若下载、精确 URL 或版权标识发生变化，停止使用本条审核结果并重新核对。当前未修改运行中的许可文件、Worker 白名单、服务端配置或任何既有日报。
