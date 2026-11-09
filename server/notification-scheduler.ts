import { getDailyActionSnapshot, dailyActionSummary } from './daily-action.js';
import { parseScheduleStart, timePartsInTimezone } from './schedule-time.js';
export { parseScheduleStart } from './schedule-time.js';
import * as db from './db.js';
import * as scheduleStore from './schedule-store.js';
import { todayInTimezone } from './reminder-store.js';
import {
  enqueueUserEmailNotificationDetailed,
  enqueueUserNotificationDetailed,
  type NotificationLogger,
} from './notification-service.js';
import type { DbReminder } from './db.js';
import type { Schedule } from './schedule-store.js';

const MINUTE_MS = 60_000;
const HIGH_PRIORITY_WINDOW_MS = 15 * MINUTE_MS;

export interface DailyDigestScheduleResult {
  scanned: number;
  due: number;
  queued: number;
  created: number;
  deduplicated: number;
  schedulesScanned: number;
  errors: number;
  configuredTimes: Record<string, number>;
}

export interface HighPriorityScheduleResult {
  usersScanned: number;
  schedulesScanned: number;
  due: number;
  queued: number;
  created: number;
  deduplicated: number;
  errors: number;
  skipped: Record<string, number>;
}

export type NotificationSchedulerLogger = NotificationLogger;

function hasExplicitStartTime(schedule: Schedule): boolean {
  return /[T ]\d{2}:\d{2}/.test(String(schedule.start_time || ''));
}

function highPriorityEmailBody(schedule: Schedule, now: Date, timezone: string): string {
  const start = parseScheduleStart(schedule.start_time, timezone);
  const minutes = start ? Math.max(1, Math.ceil((start.getTime() - now.getTime()) / MINUTE_MS)) : 15;
  const details = [
    `距离开始还有约 ${minutes} 分钟。`,
    `开始时间：${schedule.start_time.replace('T', ' ').slice(0, 19)}`,
  ];
  if (schedule.location?.trim()) details.push(`地点：${schedule.location.trim()}`);
  if (schedule.notes?.trim()) details.push(`备注：${schedule.notes.trim()}`);
  return details.join('\n');
}

/** 每分钟调用一次；只负责把到点的每日摘要放入现有通知队列。 */
export function enqueueDueDailyDigestNotifications(
  now = new Date(),
  log?: NotificationSchedulerLogger,
): DailyDigestScheduleResult {
  const reminders = db.getAllEnabledReminders();
  let due = 0;
  let queued = 0;
  let created = 0;
  let deduplicated = 0;
  let schedulesScanned = 0;
  let errors = 0;
  const configuredTimes: Record<string, number> = {};
  for (const reminder of reminders) {
    const configuredTime = `${reminder.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai'}:${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`;
    configuredTimes[configuredTime] = (configuredTimes[configuredTime] || 0) + 1;
    try {
      const timezone = reminder.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
      const local = timePartsInTimezone(now, timezone);
      if (reminder.hour !== local.hour || reminder.minute !== local.minute) continue;
      due += 1;
      const localDate = todayInTimezone(timezone, now);
      const snapshot = getDailyActionSnapshot(reminder.user_id, localDate, now);
      const schedules = snapshot.items;
      schedulesScanned += schedules.length;
      const configuredHour = String(reminder.hour).padStart(2, '0');
      const configuredMinute = String(reminder.minute).padStart(2, '0');
      const notifications = enqueueUserNotificationDetailed({
        userId: reminder.user_id,
        sourceType: 'digest',
        sourceId: localDate,
        kind: 'daily_digest',
        title: `今日行动提醒 · ${schedules.length} 项待处理`,
        body: dailyActionSummary(snapshot),
        scheduledAt: now.toISOString(),
        // 不再按“账号 + 自然日”全局去重；修改当天提醒时间后允许再次触发。
        // 同一配置时间的重复扫描仍保持幂等，避免同一分钟重复入队。
        dedupePrefix: `daily:${reminder.user_id}:${localDate}:${timezone}:${configuredHour}:${configuredMinute}`,
        log,
      });
      queued += notifications.length;
      created += notifications.filter(item => item.created).length;
      deduplicated += notifications.filter(item => !item.created).length;
      log?.('每日摘要扫描命中，通知入队结果已记录', undefined, {
        event: 'daily_digest_enqueue',
        userId: reminder.user_id,
        timezone,
        localDate,
        localTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`,
        configuredTime: `${configuredHour}:${configuredMinute}`,
        incompleteScheduleCount: schedules.length,
        queuedCount: notifications.length,
        createdCount: notifications.filter(item => item.created).length,
        deduplicatedCount: notifications.filter(item => !item.created).length,
        channels: notifications.map(item => item.notification.channel),
        notificationIds: notifications.map(item => item.notification.id),
        dedupeKeys: notifications.map(item => item.notification.dedupeKey),
        notificationStatuses: notifications.map(item => item.notification.status),
        notificationAttempts: notifications.map(item => item.notification.attempts),
      });
    } catch (error) {
      // 无效时区等单账号配置不应阻断其他账号的扫描。
      errors += 1;
      log?.(`跳过账号 ${reminder.user_id} 的每日摘要扫描`, error, {
        event: 'daily_digest_scan_error',
        userId: reminder.user_id,
        configuredTime: `${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`,
        timezone: reminder.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai',
      });
    }
  }
  return {
    scanned: reminders.length,
    due,
    queued,
    created,
    deduplicated,
    schedulesScanned,
    errors,
    configuredTimes,
  };
}

/**
 * 每分钟调用一次；在开始前 1–15 分钟把高优先级日程作为固定邮件入队。
 * 直接写入 email channel，故意绕过每日提醒开关、邮件开关和免打扰时间。
 */
export function enqueueDueHighPriorityScheduleEmails(
  now = new Date(),
  log?: NotificationSchedulerLogger,
): HighPriorityScheduleResult {
  const users = db.getAllUsers().filter(user => !user.disabled);
  let schedulesScanned = 0;
  let due = 0;
  let queued = 0;
  let created = 0;
  let deduplicated = 0;
  let errors = 0;
  const skipped: Record<string, number> = {
    notEventOrTodo: 0,
    notHighPriority: 0,
    completed: 0,
    allDay: 0,
    unscheduled: 0,
    missingExplicitStart: 0,
    invalidStart: 0,
    outsideWindow: 0,
  };
  for (const user of users) {
    const preference: DbReminder | undefined = db.getReminder(user.id);
    const timezone = preference?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
    try {
      const schedules = scheduleStore.getAllSchedules(user.id);
      schedulesScanned += schedules.length;
      for (const schedule of schedules) {
        if (schedule.type !== 'event' && schedule.type !== 'todo') {
          skipped.notEventOrTodo += 1;
          continue;
        }
        if (schedule.priority !== 'high') {
          skipped.notHighPriority += 1;
          continue;
        }
        if (schedule.is_completed) {
          skipped.completed += 1;
          continue;
        }
        if (schedule.all_day) {
          skipped.allDay += 1;
          continue;
        }
        if (schedule.is_unscheduled) {
          skipped.unscheduled += 1;
          continue;
        }
        if (!hasExplicitStartTime(schedule)) {
          skipped.missingExplicitStart += 1;
          continue;
        }
        const start = parseScheduleStart(schedule.start_time, timezone);
        if (!start) {
          skipped.invalidStart += 1;
          continue;
        }
        const remaining = start.getTime() - now.getTime();
        if (remaining <= 0 || remaining > HIGH_PRIORITY_WINDOW_MS) {
          skipped.outsideWindow += 1;
          continue;
        }
        due += 1;
        const notification = enqueueUserEmailNotificationDetailed({
          userId: user.id,
          sourceType: 'schedule',
          sourceId: schedule.id,
          kind: 'high_priority_schedule',
          title: `【高优先级提醒】${schedule.title}`,
          body: highPriorityEmailBody(schedule, now, timezone),
          scheduledAt: now.toISOString(),
          dedupeKey: `high-priority:${schedule.id}:${schedule.start_time}`,
          log,
        });
        queued += 1;
        if (notification.created) created += 1;
        else deduplicated += 1;
        log?.('高优先级日程命中，邮件通知入队结果已记录', undefined, {
          event: 'high_priority_email_enqueue',
          userId: user.id,
          scheduleId: schedule.id,
          timezone,
          scheduleStart: schedule.start_time,
          remainingSeconds: Math.max(0, Math.round(remaining / 1_000)),
          notificationId: notification.notification.id,
          created: notification.created,
          notificationStatus: notification.notification.status,
          notificationAttempts: notification.notification.attempts,
          dedupeKey: notification.notification.dedupeKey,
        });
      }
    } catch (error) {
      // 单账号日程读取失败不应阻断其他账号的高优先级扫描。
      errors += 1;
      log?.(`跳过账号 ${user.id} 的高优先级扫描`, error, {
        event: 'high_priority_scan_error',
        userId: user.id,
      });
    }
  }
  return {
    usersScanned: users.length,
    schedulesScanned,
    due,
    queued,
    created,
    deduplicated,
    errors,
    skipped,
  };
}
