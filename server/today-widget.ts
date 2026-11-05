import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getActionCenter } from './action-center.js';
import { getReminder, getUserById } from './db.js';
import { addDays, todayInTimezone } from './reminder-store.js';
import { orbitObjectPath } from '../src/utils/orbit-links.js';
import type { JwtPayload } from './auth.js';

const audience = 'orbit:today-widget';
const dayMs = 24 * 60 * 60 * 1000;

export function createTodayWidgetAccess(secret: string) {
  const key = createHmac('sha256', secret).update(audience).digest();
  return {
    issue(user: JwtPayload) {
      const now = Math.floor(Date.now() / 1000);
      const exp = Math.min(user.exp ?? now, now + 24 * 60 * 60);
      if (exp <= now) return null;
      return { credential: jwt.sign({ sub: user.userId, authVersion: user.authVersion, aud: audience, exp }, key), expiresAt: exp * 1000 };
    },
    verify(credential: string) {
      try {
        const payload = jwt.verify(credential, key, { audience, algorithms: ['HS256'] });
        if (typeof payload === 'string' || !payload.sub) return undefined;
        const user = getUserById(payload.sub);
        return user && !user.disabled && (user.auth_version ?? 0) === payload.authVersion ? user.id : undefined;
      } catch { return undefined; }
    },
  };
}

export function todayWidgetSnapshot(userId: string, now = new Date()) {
  const timezone = getReminder(userId)?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
  const date = todayInTimezone(timezone, now);
  const actionCenter = getActionCenter(userId, 3, now, date);
  const pending = actionCenter.today.filter(item => item.itemType !== 'event');
  const completed = actionCenter.completedToday.filter(item => item.itemType !== 'event');
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const snapshotItems = [...pending, ...completed].slice(0, 12).map(item => ({
    title: item.title.slice(0, 160),
    time: item.allDay ? '全天' : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(item.dueAt) && Number.isFinite(Date.parse(item.dueAt))
      ? clock.format(new Date(item.dueAt)) : item.dueAt.slice(11, 16),
    completed: item.status === 'completed',
    path: orbitObjectPath({ type: item.sourceType, id: item.sourceId, instanceId: item.instanceId || undefined, date }),
  }));
  // A cached snapshot expires at the next midnight in the account's timezone.
  let lo = now.getTime(), hi = lo + dayMs + 2 * 60 * 60 * 1000;
  const next = addDays(date, 1);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (todayInTimezone(timezone, new Date(mid)) < next) lo = mid;
    else hi = mid;
  }
  return { date, generatedAt: now.getTime(), validUntil: hi, remaining: pending.length, completed: completed.length, items: snapshotItems };
}
