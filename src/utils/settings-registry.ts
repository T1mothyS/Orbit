import { settingKeywords, searchSettings, type SearchableSetting } from './settings-search.js';
// Stable IDs are shared by the settings UI, search and read-only AI recall. No values or secrets.
const definitions = [
  {id:'android-push-enabled',section:'notifications',label:'Android 手机提醒',description:'独立账号开关，默认关闭；普通日程和周期事务通过 FCM 发送标题与时间。',admin:false},
  {id:'android-notification-permission',section:'notifications',label:'系统权限与注册',description:'Android 通知权限与 FCM 设备注册。',admin:false},
  { id: 'library-full-export', section: 'library', label: '导出全库', description: '下载当前账号的完整知识库 JSON。', admin: false },
  { id: 'library-personal-preferences', section: 'account', label: '个人资料', description: '身份、背景、专业兴趣与表达偏好。目前仅用于 Cloud 日报。', admin: false },
  {
    "id": "setting-account-m2enu0",
    "section": "account",
    "label": "登录邮箱",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-account-3jrccd",
    "section": "account",
    "label": "用户 ID",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-account-1icbw7k",
    "section": "account",
    "label": "登录状态",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-ai-1l45kwl",
    "section": "ai",
    "label": "AI 连接状态",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-ai-8qd2c6",
    "section": "ai",
    "label": "个人 API Key",
    "description": "仅保存到当前账号，服务器不使用全局默认 Key。",
    "admin": false
  },
  {
    "id": "setting-ai-1xetp3u",
    "section": "ai",
    "label": "ChatGPT 套餐连接",
    "description": "保留 Orbit 账号登录，使用 ChatGPT 套餐进行手动聊天。仅主账号试点；不会自动接管日报或后台提醒。",
    "admin": false
  },
  {
    "id": "setting-ai-ixhew3",
    "section": "ai",
    "label": "Work Buddy 默认解析模型",
    "description": "用于未指定模型的日程解析。Orbit 聊天的具体模型在输入栏“＋”中选择，并单独记忆。",
    "admin": false
  },
  {
    "id": "setting-ai-1s7nb9w",
    "section": "ai",
    "label": "联网搜索",
    "description": "Tavily 基础搜索；每轮最多两次，每月达到上限或服务额度不足时停止。请在服务商账户关闭自动付费。",
    "admin": false
  },
  {
    "id": "ai-model-capabilities",
    "section": "ai",
    "label": "模型能力验证",
    "description": "目录未声明能力时，可手动发送合成图片或空业务工具验证。会消耗所选模型额度，不发送你的日程或文件。",
    "admin": false
  },
  {
    "id": "setting-notifications-x4nqrq",
    "section": "notifications",
    "label": "提醒收件邮箱",
    "description": "每日摘要、周期提醒和日报邮件共用；默认使用注册邮箱。",
    "admin": false
  },
  {
    "id": "setting-notifications-aqnlsu",
    "section": "notifications",
    "label": "开启每日提醒",
    "description": "每天发送日程摘要；切换后立即保存。",
    "admin": false
  },
  {
    "id": "setting-notifications-1fhsl",
    "section": "notifications",
    "label": "提醒时间",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-notifications-1ov9hhr",
    "section": "report-email",
    "label": "日报邮件",
    "description": "与每日摘要、提醒渠道和免打扰独立。开启后，新发布或更新的内容版本会入队，同一版本不会重复发送。切换后立即保存。",
    "admin": false
  },
  {
    "id": "setting-notifications-jguncx",
    "section": "notifications",
    "label": "常驻城市或区县",
    "description": "用于每日邮件天气和未指定地点的天气提问。只保存地点名称与坐标。",
    "admin": false
  },
  {
    "id": "setting-notifications-1q1t6v5",
    "section": "notifications",
    "label": "通知渠道",
    "description": "修改渠道和免打扰后，点击“保存通知设置”。",
    "admin": false
  },
  {
    "id": "setting-notifications-1tv1uzi",
    "section": "notifications",
    "label": "免打扰时段",
    "description": "期间的提醒会延迟到结束时间，不会被删除。",
    "admin": false
  },
  {
    "id": "setting-daily-report-mnulcn",
    "section": "daily-report",
    "label": "日报令牌",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-daily-report-16vp9eg",
    "section": "daily-report",
    "label": "来源接收与转发",
    "description": "只控制哪些已写入生产服务器的日报进入正式网页和邮件；不会暂停本地或 Work Cloud 任务。保存后从下一次正式发布生效，不追溯发送。",
    "admin": false
  },
  {
    "id": "setting-daily-report-17lgo36",
    "section": "daily-report",
    "label": "日报个性化",
    "description": "编辑阅读偏好、近期关注、Watchlist 与 Cloud 研究框架。",
    "admin": false
  },
  {
    "id": "setting-library-16152wn",
    "section": "library",
    "label": "知识库发布令牌",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-tools-ulpim8",
    "section": "tools",
    "label": "Tools 工具中心",
    "description": "进入挂载应用菜单，选择要打开的网页工具。",
    "admin": false
  },
  {
    "id": "setting-mail-14p42mn",
    "section": "mail",
    "label": "QQ 邮箱账号",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-mail-1egbdbh",
    "section": "mail",
    "label": "客户端授权码",
    "description": "在 QQ 邮箱中开启 IMAP 并获取客户端授权码。",
    "admin": false
  },
  {
    "id": "setting-mail-vapwyd",
    "section": "mail",
    "label": "启用日报读取",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-mail-89jpyf",
    "section": "mail",
    "label": "配置状态",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-caldav-ezvd0v",
    "section": "caldav",
    "label": "同步状态",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-caldav-8fgfpw",
    "section": "caldav",
    "label": "自动同步",
    "description": "",
    "admin": false
  },
  {
    "id": "setting-data-vbr49b",
    "section": "data",
    "label": "可读数据导出",
    "description": "JSON 包含非敏感业务数据；CSV 为日程表。附件文件请使用加密备份。",
    "admin": false
  },
  {
    "id": "setting-data-nx5ki4",
    "section": "data",
    "label": "备份密码",
    "description": "至少 8 位。密码遗失后无法解密，服务器不会保存该密码。",
    "admin": false
  },
  {
    "id": "setting-data-wo8caa",
    "section": "data",
    "label": "选择备份文件",
    "description": "先填写该备份的密码，再选择文件检查内容。",
    "admin": false
  },
  {
    "id": "setting-admin-13rzxe9",
    "section": "admin",
    "label": "管理面板",
    "description": "管理用户、查看调试日志与全站备份。",
    "admin": true
  },
  {
    "id": "setting-guides-chaq97",
    "section": "guides",
    "label": "稳定联动规则",
    "description": "该版本规则同时注入日程助手和结构化导入，避免设置页文案与实际行为漂移。",
    "admin": false
  },
  {
    "id": "setting-guides-q3wrbv",
    "section": "guides",
    "label": "示例提示词",
    "description": "示例只读展示，可复制到 AI 对话中；提示词不会写入系统配置。",
    "admin": false
  },
  {
    "id": "setting-notifications-1s4l7g6",
    "section": "notifications",
    "label": "Orbit Weekly",
    "description": "每周复盘最近七天，默认关闭自动投递",
    "admin": false
  },
  {
    "id": "setting-account-i5oc5l",
    "section": "account",
    "label": "用户头像",
    "description": "上传、更换或移除个人头像",
    "admin": false
  }
];
export const SETTINGS_REGISTRY: Array<SearchableSetting & {admin:boolean}> = definitions.map(item=>({...item,keywords:settingKeywords(item.label)}));
export const visibleSettings=(admin=false)=>SETTINGS_REGISTRY.filter(item=>admin||!item.admin);
export const findSettings=(query:string,admin=false)=>searchSettings(visibleSettings(admin),query);
export const settingDefinition=(section:string,label:string)=>SETTINGS_REGISTRY.find(item=>item.section===section&&item.label===label);
