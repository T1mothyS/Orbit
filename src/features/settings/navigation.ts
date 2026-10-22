import { Bell, BookOpen, Bot, ChartNoAxesCombined, Database, Newspaper, RefreshCw, Settings2, UserRound, type LucideIcon } from 'lucide-react';
// The sole category registry for routes, desktop navigation and the mobile index.
export interface SettingsCategory { id: string; title: string; description: string; icon: LucideIcon; to: string; children?: { id: string; title: string; to: string }[] }
export const settingsCategories: SettingsCategory[] = [
  { id: 'account', title: '账户与安全', icon: UserRound, description: '登录信息、头像与密码', to: '/settings/account', children: [
    { id: 'account', title: '账号管理', to: '/settings/account' },
    { id: 'profile', title: '个人资料', to: '/settings/account/profile' },
  ] },
  { id: 'notifications', title: '通知与提醒', icon: Bell, description: '提醒渠道、免打扰与周报', to: '/settings/notifications' },
  { id: 'ai', title: 'AI 与模型', icon: Bot, description: '模型、连接与联网搜索', to: '/settings/ai' },
  { id: 'reports', title: '日报', icon: Newspaper, description: '阅读偏好、接收与邮件', to: '/settings/reports', children: [
    { id: 'personal', title: '个性化', to: '/settings/reports' },
    { id: 'functional', title: '接收与邮件', to: '/settings/reports/delivery' },
  ] },
  { id: 'statistics', title: '使用统计', icon: ChartNoAxesCombined, description: '默认筛选与已保存的个人活动报告', to: '/settings/statistics', children: [
    { id: 'filters', title: '默认筛选', to: '/settings/statistics' },
    { id: 'history', title: '已保存报告', to: '/settings/statistics/history' },
  ] },
  { id: 'library', title: '知识库', icon: BookOpen, description: '发布与数据导出', to: '/settings/library' },
  { id: 'integrations', title: '同步与集成', icon: RefreshCw, description: '日历同步与外部连接', to: '/settings/integrations' },
  { id: 'data', title: '数据与备份', icon: Database, description: '导出、加密备份与恢复', to: '/settings/data' },
  { id: 'advanced', title: '高级', icon: Settings2, description: '工具、管理与使用指南', to: '/settings/advanced' },
];
