import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Schedule } from './schedule-store.js';
import type { DailyActionMeta } from '../src/utils/daily-action.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-daily-action-'));
Object.assign(process.env, { DATA_DIR: root, APP_TIMEZONE: 'Asia/Shanghai', NODE_ENV: 'test' });
const db = await import('./db.js');
const schedules = await import('./schedule-store.js');
const reminders = await import('./reminder-store.js');
const activity = await import('./activity-store.js');
const daily = await import('./daily-action.js');
const scheduler = await import('./notification-scheduler.js');
const sync = await import('./reminder-calendar-sync.js');
await db.initDb();
await schedules.initScheduleDb();
await reminders.initReminderDb();
await activity.initActivityDb();
const stamp = '2026-11-09T00:00:00.000Z';
function owner() {
  const id = randomUUID();
  db.createUser({ id, email: `${id}@example.invalid`, password_hash: 'synthetic-only', role: 'user', disabled: 0, created_at: stamp, updated_at: stamp });
  db.upsertReminder({ id: randomUUID(), user_id: id, enabled: 1, hour: 7, minute: 0, in_app_enabled: 1,
    email_enabled: 0, browser_enabled: 0, timezone: 'Asia/Shanghai', quiet_hours_enabled: 0, created_at: stamp, updated_at: stamp });
  return id;
}
function item(userId: string, overrides: Partial<Schedule> = {}) {
  return schedules.createSchedule({ id: randomUUID(), user_id: userId, calendar_id: 'personal', type: 'todo',
    title: '合成待办', start_time: '2026-11-09T09:30:00', all_day: false, category: 'work', priority: 'medium',
    is_completed: false, is_repeated: false, reminders: [], is_high_risk: false, ...overrides });
}
function cycle(userId: string, date = '2026-11-12', offsets = [3], timezone = 'Asia/Shanghai', time = '10:00') {
  return reminders.createReminderTask({ userId, name: '合成周期事务', type: 'generic', timezone,
    config: { templateKey: 'custom', rule: { frequency: 'once', anchorDate: date, advancePolicy: 'calendar' },
      reminderOffsets: offsets, reminderTime: time, actionGuide: '', priority: 'medium' } });
}

test('daily action includes advance reminders once, with or without calendar projection, and reads without writes', () => {
  const userId = owner();
  const ordinary = item(userId);
  item(userId, { is_unscheduled: true });
  item(userId, { is_completed: true });
  const ahead = cycle(userId, '2026-11-12', [3, 3]);
  const dueToday = cycle(userId, '2026-11-09', [0, 0]);
  sync.syncReminderTaskToCalendar(dueToday);
  const foreign = owner();
  item(foreign); cycle(foreign);
  const beforeSchedules = schedules.exportScheduleDb();
  const beforeReminders = reminders.exportReminderDb();
  const result = daily.getDailyActionSnapshot(userId, '2026-11-09', new Date(stamp));
  assert.equal(result.items.length, 3);
  assert.equal(result.capturedAt, stamp);
  assert.deepEqual(new Set(result.items.map(value => value.sourceId)), new Set([ordinary.id, ahead.id, dueToday.id]));
  const advanceItem = result.items.find(value => value.sourceId === ahead.id)!;
  assert.equal(advanceItem.dueDate, '2026-11-12');
  assert.equal(advanceItem.startTime, '2026-11-09T02:00:00.000Z');
  assert.equal(advanceItem.scheduleId, null);
  assert.equal(advanceItem.current?.editable, true);
  assert.match(advanceItem.current!.href!, /\/reminders\?task=/);
  assert.equal(result.items.find(value => value.sourceId === dueToday.id)!.current?.scheduleId, `reminder-cycle:${dueToday.currentCycle!.id}`);
  assert.deepEqual(schedules.exportScheduleDb(), beforeSchedules);
  assert.deepEqual(reminders.exportReminderDb(), beforeReminders);
  const queued = scheduler.enqueueDueDailyDigestNotifications(new Date('2026-11-08T23:00:00.000Z'));
  assert.equal(queued.errors, 0);
  const notification = activity.listNotifications(userId).find(value => value.kind === 'daily_digest')!;
  assert.match(notification.title, /3 项待处理/);
  assert.match(notification.body, /2026-11-12 到期/);
});

test('account-local dates cover offset and Z schedules, all-day values and cross-timezone reminders', () => {
  const userId = owner();
  const z = item(userId, { start_time: '2026-11-08T16:30:00Z' });
  const offset = item(userId, { start_time: '2026-11-09T00:30:00+08:00' });
  const tomorrow = item(userId, { start_time: '2026-11-09T17:00:00Z' });
  const allDay = item(userId, { all_day: true, start_time: '2026-11-09' });
  const crossZone = cycle(userId, '2026-11-10', [2], 'America/New_York', '20:30');
  const result = daily.getDailyActionSnapshot(userId, '2026-11-09');
  assert.deepEqual(new Set(result.items.map(value => value.sourceId)), new Set([z.id, offset.id, allDay.id, crossZone.id]));
  assert.ok(!result.items.some(value => value.sourceId === tomorrow.id));
  assert.match(result.items.find(value => value.sourceId === z.id)!.current!.href!, /date=2026-11-09/);
  assert.equal(result.items.find(value => value.sourceId === crossZone.id)?.startTime, '2026-11-09T01:30:00.000Z');
  assert.throws(() => daily.getDailyActionSnapshot(userId, '2026-02-30'), /日期格式/);
});

test('today uses the current account timezone, while malformed restored dates cannot break a daily read', () => {
  const userId = owner();
  const valid = item(userId);
  const now = new Date('2026-11-09T01:00:00.000Z');
  const frozen = daily.freezeDailyAction(daily.getDailyActionSnapshot(userId, 'today', now));
  assert.equal(frozen.date, '2026-11-09');
  db.upsertReminder({ ...db.getReminder(userId)!, timezone: 'America/Los_Angeles' });
  const latest = daily.getDailyActionSnapshot(userId, 'today', now);
  assert.equal(latest.date, '2026-11-08');
  assert.equal(latest.timezone, 'America/Los_Angeles');
  assert.equal(frozen.timezone, 'Asia/Shanghai');
  assert.equal(daily.dailyActionScheduleDate({ start_time: '2026-11-09', all_day: false }, latest.timezone), '2026-11-09');
  const invalidTimes = ['invalidZ', '2026-11-09T99:00:00Z', '2026-11-09T99:00:00', '2026-02-30T09:00:00Z'];
  schedules.restoreUserScheduleData(userId, { schedules: invalidTimes.map(start_time => ({ ...valid, id: randomUUID(), start_time })) }, 'merge');
  const before = schedules.exportScheduleDb();
  const result = daily.getDailyActionSnapshot(userId, '2026-11-09');
  assert.deepEqual(result.items.map(value => value.sourceId), [valid.id]);
  for (const start_time of invalidTimes) assert.equal(daily.dailyActionScheduleDate({ start_time, all_day: false }, latest.timezone), null);
  assert.deepEqual(schedules.exportScheduleDb(), before);
});

test('frozen facts survive edits, completion and deletion while current access stays owner scoped', () => {
  const userId = owner();
  const ordinary = item(userId);
  const recurring = cycle(userId);
  const frozen: DailyActionMeta = { ...daily.freezeDailyAction(daily.getDailyActionSnapshot(userId, '2026-11-09', new Date(stamp))), weather: { state: 'unconfigured' } };
  assert.ok(frozen.items!.every(value => !value.current));
  const original = JSON.stringify(frozen);
  item(userId, { title: '后来新增' });
  schedules.updateSchedule(ordinary.id, { title: '已改标题', start_time: '2026-11-10T09:00:00', is_completed: true });
  let read = daily.dailyActionHistory(userId, frozen);
  assert.equal(read.items!.length, 2);
  const old = read.items!.find(value => value.sourceId === ordinary.id)!;
  assert.equal(old.title, '合成待办');
  assert.equal(old.startTime, '2026-11-09T09:30:00');
  assert.equal(old.completed, false);
  assert.equal(old.current?.completed, true);
  assert.match(old.current!.href!, /2026-11-10/);
  assert.equal(daily.getDailyActionSnapshot(userId, '2026-11-09').items.length, 2);
  reminders.completeReminderCycle(recurring.id, userId, recurring.currentCycle!.id, '2026-11-09');
  const completedCycle = daily.dailyActionHistory(userId, frozen).items!.find(value => value.sourceId === recurring.id)!;
  assert.equal(completedCycle.completed, false);
  assert.equal(completedCycle.current?.completed, true);
  assert.equal(completedCycle.current?.editable, false);
  assert.equal(daily.getDailyActionSnapshot(userId, '2026-11-09').items.length, 1);
  schedules.deleteSchedule(ordinary.id);
  reminders.deleteReminderTask(recurring.id, userId);
  read = daily.dailyActionHistory(userId, frozen);
  assert.ok(read.items!.every(value => !value.current!.available && !value.current!.editable && value.current!.href === null));
  assert.equal(JSON.stringify(frozen), original);
  const foreign = owner();
  assert.ok(daily.withCurrentAccess(foreign, frozen.items!).every(value => !value.current!.available));
  assert.deepEqual(daily.dailyActionHistory(userId, { date: '2026-11-09', weather: { state: 'unconfigured' } }),
    { date: '2026-11-09', weather: { state: 'unconfigured' }, legacy: true });
});
