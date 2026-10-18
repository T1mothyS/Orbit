/** Controlled product questions only. The help page never starts an AI request. */
export const helpTopics = [
  { id: 'schedule', title: '日程与待办', description: '在日程页创建和编辑事项；AI 生成的草稿需要你确认后才会写入。无固定日期的待办可放在挂起区。', to: '/schedule', action: '打开日程', question: 'Orbit 中如何创建日程、无日期待办，并确认 AI 生成的事项？' },
  { id: 'recurring', title: '周期事务', description: '为重复事务设置周期，逐次登记完成。完成历史和下一周期由现有规则管理。', to: '/reminders', action: '打开周期提醒', question: 'Orbit 周期事务如何设置、登记完成，以及查看历史？' },
  { id: 'ai', title: 'AI 对话与记事', description: '在对话中描述任务；核对生成结果后再确认。记事可直接保存，发送到对话不会自动完成来源记事。', to: '/assistant', action: '打开对话', question: 'Orbit 的 AI 对话、记事和事项确认分别怎样使用？' },
  { id: 'library', title: '知识库', description: '阅读和管理知识条目，或从“记录经历”开始复盘。仅在明确提及知识库时检索，确认前不写入。', to: '/library', action: '打开知识库', question: 'Orbit 如何查询知识库、管理条目和记录经历？' },
  { id: 'notifications', title: '提醒与通知', description: '通知页统一管理收件邮箱、渠道和免打扰。Android 提醒需要客户端权限和设备绑定，服务端接受不等于手机已收到。', to: '/settings/notifications', action: '设置提醒', question: 'Orbit 的邮件、站内、浏览器和 Android 提醒分别在哪里配置与检查？' },
  { id: 'reports', title: '日报与周报', description: '日报阅读、Cloud 个性化和来源接收各有独立设置。Orbit Weekly 默认关闭；保存偏好不会立即生成或补发。', to: '/settings/reports', action: '打开日报设置', question: 'Orbit 的日报阅读、个性化、邮件开关和 Orbit Weekly 如何配置？' },
  { id: 'security', title: '账户与安全', description: '修改登录密码需要当前密码，成功后所有 Orbit 登录失效。独立日报、知识库令牌和外部授权继续保留。', to: '/settings/account', action: '打开账户与安全', question: 'Orbit 如何修改密码，哪些登录会失效，哪些独立授权继续保留？' },
] as const;
export function helpQuestion(id: unknown): string | null { return helpTopics.find(topic => topic.id === id)?.question || null; }
export function appendHelpQuestion(text: string, question: string): string { return text.endsWith(question) ? text : text ? `${text}\n\n${question}` : question; }
