import * as schedules from './schedule-store.js';
import { parseScheduleStart } from './notification-scheduler.js';
import { addDateDays } from './orbit-time.js';

export function schedulesForQuery(userId: string, date: string, timezone: string) {
  const start = parseScheduleStart(`${date}T00:00:00`, timezone)!.getTime();
  const end = parseScheduleStart(`${addDateDays(date,1)}T00:00:00`, timezone)!.getTime();
  return schedules.getAllSchedules(userId).filter(item => {
    if (item.is_unscheduled) return false;
    if (item.all_day) return item.start_time.slice(0,10) <= date && (item.end_time || item.start_time).slice(0,10) >= date;
    const begins = parseScheduleStart(item.start_time,timezone)?.getTime();
    if (begins === undefined) return false;
    const finishes = item.type === 'todo' ? begins : parseScheduleStart(item.end_time || item.start_time,timezone)?.getTime() ?? begins;
    return finishes === begins ? begins >= start && begins < end : begins < end && finishes > start;
  });
}
