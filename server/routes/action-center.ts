import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';

import { sendDailyReminderEmail, summarizeEmailSendResult } from '../email-service.js';
import { createTodayWidgetAccess, todayWidgetSnapshot } from '../today-widget.js';
import { getActionCenter } from '../action-center.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';

export function createActionCenterRouter({ authenticate, JWT_SECRET }: Pick<ReturnType<typeof createAuth>, 'authenticate'> & { JWT_SECRET: string }) {
  const app = Router();
  app.get("/api/action-center", authenticate, (req, res) => {
    try {
      const userId = (req as any).user.userId;
      const upcomingDays = Number(req.query.upcomingDays || 7);
      res.json(getActionCenter(userId, upcomingDays));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || '获取今日行动中心失败' });
    }
  });

  const widget = createTodayWidgetAccess(JWT_SECRET);
  app.post('/api/action-center/widget/access', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const access = widget.issue((req as any).user as JwtPayload);
    if (!access) return res.status(401).json({ error: '请重新登录后同步小组件' });
    res.json(access);
  });
  app.get('/api/action-center/widget', (req, res, next) => {
    const authorization = req.get('Authorization') || '';
    if (!authorization.startsWith('OrbitWidget ')) return authenticate(req, res, next);
    const userId = widget.verify(authorization.slice('OrbitWidget '.length));
    if (!userId) return res.status(401).json({ error: '请打开 Orbit 更新小组件登录状态' });
    res.locals.widgetUserId = userId;
    next();
  }, (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(todayWidgetSnapshot(res.locals.widgetUserId || (req as any).user.userId));
  });

  app.post("/api/action-center/send-email", authenticate, async (req, res) => {
    try {
      const payload = (req as any).user as JwtPayload;
      const reminderEmail = db.getReminderEmail(payload.userId) || payload.email;
      if (!reminderEmail) return res.status(400).json({ error: '没有绑定通知邮箱，请先在设置中配置。' });
      const sendResult = await sendDailyReminderEmail(reminderEmail, payload.userId);
      addLog('info', 'mail', '用户手动发送今日安排邮件成功', {
        event: 'manual_daily_email_sent',
        userId: payload.userId,
        recipient: reminderEmail,
        ...summarizeEmailSendResult(sendResult),
      });
      res.json({ success: true, message: `今天的安排已发送至 ${reminderEmail}` });
    } catch (error: any) {
      addLog('error', 'mail', '手动发送今日安排邮件失败', describeErrorData(error, {
        event: 'manual_daily_email_failed',
        userId: (req as any).user?.userId,
      }));
      res.status(502).json({ error: error?.message || '邮件发送失败，请稍后重试。' });
    }
  });

  // ============= AI 记事条目 =============
  return app;
}
