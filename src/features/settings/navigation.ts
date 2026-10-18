// The sole category registry for routes, desktop navigation and the mobile index.
export const settingsCategories = [
  { id: 'account', title: '账户与安全', description: '登录信息、头像与密码', to: '/settings/account' },
  { id: 'notifications', title: '通知与提醒', description: '提醒渠道、免打扰与周报', to: '/settings/notifications' },
  { id: 'ai', title: 'AI 与模型', description: '模型、连接与联网搜索', to: '/settings/ai' },
  { id: 'reports', title: '日报', description: '阅读偏好、接收与邮件', to: '/settings/reports' },
  { id: 'library', title: '知识库', description: '发布与数据导出', to: '/settings/library' },
  { id: 'integrations', title: '同步与集成', description: '日历同步与外部连接', to: '/settings/integrations' },
  { id: 'data', title: '数据与备份', description: '导出、加密备份与恢复', to: '/settings/data' },
  { id: 'advanced', title: '高级', description: '工具、管理与使用指南', to: '/settings/advanced' },
];
