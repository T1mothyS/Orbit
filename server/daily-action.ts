import { getReminder } from './db.js';
import { getAllSchedules, type Schedule } from './schedule-store.js';
import { cycleReminderDates, readReminderProjectionSources, todayInTimezone } from './reminder-store.js';
import { isValidDateKey } from './date-key.js';
import { parseScheduleStart, scheduleDateInTimezone } from './schedule-time.js';
import { orbitObjectPath } from '../src/utils/orbit-links.js';
import type { DailyActionItem, DailyActionMeta, DailyActionSnapshot } from '../src/utils/daily-action.js';

export function dailyActionTimezone(userId: string): string {
  return getReminder(userId)?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
}

/** Legacy restores can contain malformed timestamps; one bad row must not hide valid actions. */
export function dailyActionScheduleDate(schedule: Pick<Schedule, 'start_time' | 'all_day'>, timezone: string): string | null {
  const date = schedule.start_time.slice(0, 10);
  if (!isValidDateKey(date)) return null;
  if (schedule.all_day || schedule.start_time === date) return date;
  const instant = parseScheduleStart(schedule.start_time, timezone);
  return instant ? scheduleDateInTimezone(instant.toISOString(), timezone, false) : null;
}

function scheduleItem(schedule: Schedule): DailyActionItem {
  return {
    id: `schedule:${schedule.id}`, sourceType: 'schedule', sourceId: schedule.id,
    instanceId: null, scheduleId: schedule.id, type: schedule.type,
    title: schedule.title, startTime: schedule.start_time, endTime: schedule.end_time || null,
    dueDate: null, allDay: schedule.all_day, completed: schedule.is_completed,
  };
}

/** Pure account-scoped read: never creates cycles, deliveries or calendar projections. */
export function getDailyActionSnapshot(userId: string, date: string, now = new Date()): DailyActionSnapshot {
  const timezone = dailyActionTimezone(userId);
  if (date === 'today') date = todayInTimezone(timezone, now);
  if (!isValidDateKey(date)) throw new Error('日期格式不正确，请使用 YYYY-MM-DD');
  const schedules = getAllSchedules(userId);
  const scheduleMap = new Map(schedules.map(item => [item.id, item]));
  const projections = readReminderProjectionSources(userId);
  const items = schedules.filter(item => !item.id.startsWith('reminder-cycle:') && !item.is_unscheduled
    && !item.is_completed && dailyActionScheduleDate(item, timezone) === date).map(scheduleItem);

  for (const { task, cycle, current } of projections) {
    if (!current || !task.enabled || !cycle || !['pending', 'expired'].includes(cycle.status)) continue;
    // A reminder can fire before its due date. Use its actual local trigger instant,
    // converted to the account's day, rather than the calendar projection's due date.
    const triggers = cycleReminderDates(task, cycle).flatMap(reminder => {
      const at = parseScheduleStart(`${reminder.date}T${task.config.reminderTime || '12:00'}:00`, task.timezone);
      return at && scheduleDateInTimezone(at.toISOString(), timezone, false) === date ? [at.toISOString()] : [];
    }).sort();
    const plannedDate = cycle.plannedDate || cycle.dueDate;
    if (plannedDate !== date && !triggers.length) continue;
    const projectionId = `reminder-cycle:${cycle.id}`;
    items.push({
      id: `reminder:${task.id}:${cycle.id}`, sourceType: 'reminder', sourceId: task.id,
      instanceId: cycle.id, scheduleId: scheduleMap.has(projectionId) ? projectionId : null,
      type: 'reminder', title: task.name, startTime: triggers[0] || `${plannedDate}T00:00:00`,
      endTime: null, dueDate: cycle.dueDate, allDay: !triggers.length, completed: false,
    });
  }
  items.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const aTime = parseScheduleStart(a.startTime, timezone)?.getTime() || 0;
    const bTime = parseScheduleStart(b.startTime, timezone)?.getTime() || 0;
    return aTime - bTime || a.id.localeCompare(b.id);
  });
  return { date, timezone, capturedAt: now.toISOString(), items: withCurrentAccess(userId, items) };
}

/** Frozen evidence stays intact; only these live capabilities are recalculated. */
export function withCurrentAccess(userId: string, items: DailyActionItem[]): DailyActionItem[] {
  const timezone = dailyActionTimezone(userId);
  const schedules = new Map(getAllSchedules(userId).map(item => [item.id, item]));
  const projections = readReminderProjectionSources(userId);
  return items.map(item => {
    let current: NonNullable<DailyActionItem['current']> = {
      available: false, completed: item.completed, editable: false, scheduleId: null, href: null,
    };
    if (item.sourceType === 'schedule') {
      const schedule = schedules.get(item.sourceId);
      if (schedule && !schedule.id.startsWith('reminder-cycle:')) current = {
        available: true, completed: schedule.is_completed, editable: true, scheduleId: schedule.id,
        href: orbitObjectPath({ type: 'schedule', id: schedule.id, date: dailyActionScheduleDate(schedule, timezone) || undefined }),
      };
    } else if (item.sourceType === 'reminder') {
      const source = projections.find(p => p.task.id === item.sourceId && p.cycle?.id === item.instanceId);
      if (source?.cycle) {
        const scheduleId = `reminder-cycle:${source.cycle.id}`;
        const editable = source.current && source.task.enabled && ['pending', 'expired'].includes(source.cycle.status);
        current = { available: true, completed: source.cycle.status === 'completed', editable,
          scheduleId: editable && schedules.has(scheduleId) ? scheduleId : null,
          href: orbitObjectPath({ type: 'reminder', id: source.task.id, instanceId: source.cycle.id }),
        };
      }
    }
    return { ...item, current };
  });
}

export function freezeDailyAction(snapshot: DailyActionSnapshot): Omit<DailyActionMeta, 'weather'> {
  return { schemaVersion: 1, date: snapshot.date, timezone: snapshot.timezone, capturedAt: snapshot.capturedAt,
    items: snapshot.items.map(({ current: _current, ...item }) => item) };
}

export function dailyActionHistory(userId: string, meta: DailyActionMeta): DailyActionMeta {
  if (meta.schemaVersion !== 1 || !Array.isArray(meta.items)) {
    return { date: meta.date, weather: meta.weather, legacy: true };
  }
  return { ...meta, legacy: false, items: withCurrentAccess(userId, meta.items) };
}

export function dailyActionSummary(snapshot: DailyActionSnapshot): string {
  if (!snapshot.items.length) return '本次提醒没有待处理事项。';
  return snapshot.items.map(item => {
    const at = parseScheduleStart(item.startTime, snapshot.timezone);
    const time = item.allDay ? '全天' : at ? new Intl.DateTimeFormat('zh-CN', {
      timeZone: snapshot.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(at) : '';
    return `${time} ${item.title}${item.type === 'reminder' ? ` · 周期提醒（${item.dueDate} 到期）` : ''}`;
  }).join('\n');
}
