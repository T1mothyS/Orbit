import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CreditCardConfig, GenericReminderConfig, SimConfig } from './reminder-store.js';
import { freezeReviewedV3Citation, recordReviewedV3Source } from './digest-v3-local-flow.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const schedules = await import('./schedule-store.js');
const reminders = await import('./reminder-store.js');
const reminderCalendarSync = await import('./reminder-calendar-sync.js');
const activity = await import('./activity-store.js');
const attachments = await import('./attachment-service.js');
const backups = await import('./backup-service.js');
const dailyReportMedia = await import('./daily-report-media-service.js');
const actionCenter = await import('./action-center.js');
const scheduleCompletion = await import('./schedule-completion-service.js');
const email = await import('./email-service.js');
const emailImport = await import('./email-import-service.js');
const dailyReportTokens = await import('./daily-report-token-service.js');

await db.initDb();
await schedules.initScheduleDb();
await reminders.initReminderDb();
await activity.initActivityDb();

const userId = 'test-user';
db.createUser({
  id: userId,
  email: 'test@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

test('不存在的账单日按该月最后一天计算', () => {
  assert.equal(reminders.clampDateForMonth(2025, 2, 31), '2025-02-28');
  assert.equal(reminders.clampDateForMonth(2024, 2, 31), '2024-02-29');
  assert.equal(reminders.clampDateForMonth(2026, 4, 31), '2026-04-30');
});

test('同一时刻按用户时区计算各自的本地日期', () => {
  const instant = new Date('2026-08-24T16:30:00.000Z');
  assert.equal(reminders.todayInTimezone('Asia/Shanghai', instant), '2026-08-25');
  assert.equal(reminders.todayInTimezone('America/Los_Angeles', instant), '2026-08-24');
});

test('未来年度周期使用明确填写的本期到期日，编辑后同步当前周期', () => {
  const task = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '车辆年检日期测试',
    config: {
      templateKey: 'vehicle_inspection',
      rule: { frequency: 'yearly', anchorDate: '2027-04-18', month: 4, dayOfMonth: 18, interval: 1, advancePolicy: 'calendar' },
      reminderOffsets: [30, 7, 1],
      reminderTime: '09:00',
      actionGuide: '预约年检',
      priority: 'medium',
    },
  });
  assert.equal(task.currentCycle?.dueDate, '2027-04-18');
  assert.equal(task.currentCycle?.status, 'pending');

  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as GenericReminderConfig),
      rule: { frequency: 'yearly', anchorDate: '2028-05-19', month: 5, dayOfMonth: 19, interval: 1, advancePolicy: 'calendar' },
    },
  });
  assert.equal(updated?.currentCycle?.dueDate, '2028-05-19');
  assert.equal(updated?.currentCycle?.status, 'pending');
});

test('编辑 SIM 卡提前天数会重建当前周期的待发送提醒', () => {
  const lastOperationDate = reminders.todayInTimezone();
  const task = reminders.createReminderTask({
    userId,
    type: 'sim',
    name: 'SIM 卡提醒编辑测试',
    config: {
      provider: '测试运营商',
      numberMasked: '138****0000',
      region: '中国大陆',
      intervalDays: 60,
      lastOperationDate,
      actionGuide: '测试操作',
      reminderOffsets: [10],
      reminderTime: '09:00',
      priority: 'medium',
    },
  });
  const firstNextDate = task.nextReminderDate;
  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as SimConfig),
      reminderOffsets: [3],
    },
  });

  assert.equal(firstNextDate, reminders.addDays(task.currentCycle!.dueDate, -10));
  assert.equal(updated?.nextReminderDate, reminders.addDays(task.currentCycle!.dueDate, -3));
  assert.notEqual(updated?.nextReminderDate, firstNextDate);
});

test('编辑信用卡日期会同步当前周期的账单日和还款日', () => {
  const task = reminders.createReminderTask({
    userId,
    type: 'credit_card',
    name: '信用卡日期编辑测试',
    config: {
      statementDay: 22,
      paymentDay: 20,
      paymentMonthOffset: 1,
      reminderOffsets: [7, 1, 0],
      reminderTime: '09:00',
      priority: 'high',
    },
  });
  const originalPeriodStart = task.currentCycle!.periodStart;
  const periodMonth = originalPeriodStart.slice(0, 7);
  const [year, month] = periodMonth.split('-').map(Number);
  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as CreditCardConfig),
      statementDay: 5,
      paymentDay: 28,
      paymentMonthOffset: 0,
    },
  });

  assert.equal(updated?.currentCycle?.periodStart, `${periodMonth}-05`);
  assert.equal(updated?.currentCycle?.dueDate, `${year}-${String(month).padStart(2, '0')}-28`);
  assert.notEqual(updated?.currentCycle?.periodStart, originalPeriodStart);
});

test('邮件测试时间按 GMT+8 输出', () => {
  assert.equal(
    email.formatDateTimeInTimezone(new Date('2026-07-15T15:11:00.000Z'), 'Asia/Shanghai'),
    '2026-07-15 23:11:00 GMT+8',
  );
});

test('邮箱导入令牌只接受完整的 32 位十六进制格式', () => {
  assert.equal(
    emailImport.extractEmailImportToken('[AI-IMPORT 0123456789abcdef0123456789abcdef] 测试'),
    '0123456789abcdef0123456789abcdef',
  );
  assert.equal(emailImport.extractEmailImportToken('[AI-IMPORT short-token] 测试'), null);
});

test('邮箱验证码以带密钥摘要保存并仍可正常校验', () => {
  const now = new Date();
  db.createEmailCode({
    id: 'email-code-hash-test',
    email: 'test@example.com',
    code: '123456',
    purpose: 'register',
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    created_at: now.toISOString(),
  });
  const verified = db.verifyEmailCode('test@example.com', '123456', 'register');
  assert.ok(verified);
  assert.notEqual(verified?.code, '123456');
  assert.equal(db.verifyEmailCode('test@example.com', '000000', 'register'), undefined);
});

test('日报令牌只保存哈希，可轮换、撤销并按账号隔离', () => {
  const generated = dailyReportTokens.generateDailyReportToken(userId);
  assert.match(generated.token, /^drr_/);
  const stored = db.getDailyReportToken(userId)!;
  assert.notEqual(stored.token_hash, generated.token);
  assert.equal(stored.token_hash, dailyReportTokens.hashDailyReportToken(generated.token));
  assert.deepEqual(dailyReportTokens.authenticateDailyReportToken(generated.token), { userId });

  const rotated = dailyReportTokens.generateDailyReportToken(userId);
  assert.notEqual(rotated.token, generated.token);
  assert.equal(dailyReportTokens.authenticateDailyReportToken(generated.token), null);
  assert.deepEqual(dailyReportTokens.authenticateDailyReportToken(rotated.token), { userId });

  dailyReportTokens.revokeDailyReportToken(userId);
  assert.equal(dailyReportTokens.authenticateDailyReportToken(rotated.token), null);
  assert.equal(dailyReportTokens.getDailyReportTokenStatus(userId).active, false);
});

test('日历按用户隔离并自动迁移默认日历', () => {
  const own = schedules.getAllCalendars(userId);
  const other = schedules.getAllCalendars('other-user');
  assert.ok(own.length >= 3);
  assert.ok(own.every(item => item.user_id === userId));
  assert.ok(other.every(item => item.user_id === 'other-user'));
  assert.equal(own.some(item => other.some(candidate => candidate.id === item.id)), false);
});

test('AI 会话和消息按用户隔离', () => {
  const otherUserId = 'other-session-user';
  db.createUser({
    id: otherUserId,
    email: 'other-session@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  db.createSession({ id: 'session-user-a', user_id: userId, title: '用户 A', model: 'test', sdk_session_id: null, created_at: now, updated_at: now });
  db.createSession({ id: 'session-user-b', user_id: otherUserId, title: '用户 B', model: 'test', sdk_session_id: null, created_at: now, updated_at: now });
  db.createMessage({ id: 'message-user-a', session_id: 'session-user-a', role: 'user', content: 'A 私有消息', model: null, created_at: now, tool_calls: null }, userId);

  assert.equal(db.getAllSessions(userId).some(item => item.id === 'session-user-b'), false);
  assert.equal(db.getSession('session-user-b', userId), undefined);
  assert.equal(db.getMessagesBySession('session-user-a', otherUserId).length, 0);
  assert.throws(
    () => db.createMessage({ id: 'message-cross-user', session_id: 'session-user-a', role: 'user', content: '越权', model: null, created_at: now, tool_calls: null }, otherUserId),
    /无权访问/,
  );
});

test('AI 助手历史按用户隔离并逐条清理超过三天的记录', () => {
  const now = Date.now();
  const oldTime = new Date(now - 3 * 24 * 60 * 60 * 1000 - 1).toISOString();
  const freshTime = new Date(now).toISOString();
  db.createAiScheduleMessage({
    id: 'ai-history-old', user_id: userId, role: 'user', type: 'text', content: '旧消息',
    intent: null, schedule_items: null, plan: null, created_at: oldTime,
  });
  db.createAiScheduleMessage({
    id: 'ai-history-fresh', user_id: userId, role: 'assistant', type: 'text', content: '新消息',
    intent: 'chat', schedule_items: '[]', plan: null,
    knowledge_sources: JSON.stringify([{ id: 'library-entry', title: '历史知识' }]),
    created_at: freshTime,
  });
  db.createAiScheduleMessage({
    id: 'ai-history-other-user', user_id: 'other-session-user', role: 'user', type: 'text', content: '其他用户消息',
    intent: null, schedule_items: null, plan: null, created_at: oldTime,
  });

  const deleted = db.deleteExpiredAiScheduleMessages(new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(), userId);
  assert.equal(deleted, 1);
  assert.equal(db.getAiScheduleMessages(userId, 0).some(item => item.id === 'ai-history-old'), false);
  assert.equal(db.getAiScheduleMessages(userId, 0).some(item => item.id === 'ai-history-fresh'), true);
  assert.deepEqual(JSON.parse(db.getAiScheduleMessages(userId, 0).find(item => item.id === 'ai-history-fresh')?.knowledge_sources || 'null'), [{ id: 'library-entry', title: '历史知识' }]);
  assert.equal(db.getAiScheduleMessages('other-session-user', 0).some(item => item.id === 'ai-history-other-user'), true);
});

test('通用周期任务、逾期手动完成和下一周期生成', () => {
  const upcomingDueDate = reminders.addDays(reminders.todayInTimezone(), 1);
  const task = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '测试房租',
    config: {
      templateKey: 'rent',
      rule: {
        frequency: 'monthly',
        anchorDate: upcomingDueDate,
        dayOfMonth: Number(upcomingDueDate.slice(8, 10)),
        interval: 1,
        advancePolicy: 'calendar',
      },
      reminderOffsets: [3, 1, 0],
      reminderTime: '09:00',
      actionGuide: '支付房租',
      priority: 'high',
    },
  });
  assert.ok(task.currentCycle);
  const linked = reminderCalendarSync.syncReminderTaskToCalendar(task);
  assert.equal(linked?.all_day, true);
  assert.equal(linked?.type, 'todo');
  assert.equal(linked?.start_time.slice(0, 10), task.currentCycle?.dueDate);
  assert.equal(actionCenter.getActionCenter(userId, 14).today.some(item => item.sourceId === linked?.id), false);
  const firstCycle = task.currentCycle!;
  const completed = reminders.completeReminderCycle(task.id, userId, task.currentCycle!.id, task.currentCycle!.dueDate, '已支付');
  assert.equal(completed?.currentCycle?.status, 'pending');
  assert.notEqual(completed?.currentCycle?.id, task.currentCycle?.id);
  const completedCycle = reminders.getReminderHistory(task.id, userId).find(cycle => cycle.id === firstCycle.id)!;
  reminderCalendarSync.syncReminderCycleToCalendar(completed!, completedCycle);
  reminderCalendarSync.syncReminderTaskToCalendar(completed!);
  assert.equal(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(firstCycle.id))?.is_completed, true);
  assert.ok(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(completed!.currentCycle!.id)));
  const expiredTask = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '过期证件',
    config: {
      templateKey: 'document',
      rule: { frequency: 'once', anchorDate: '2020-01-01', advancePolicy: 'calendar' },
      reminderOffsets: [7, 1],
      reminderTime: '09:00',
      actionGuide: '补办证件',
      priority: 'high',
    },
  });
  assert.equal(expiredTask.currentCycle?.status, 'expired');
  const expiredCycleId = expiredTask.currentCycle!.id;
  reminders.completeReminderCycle(expiredTask.id, userId, expiredCycleId, reminders.todayInTimezone(), '逾期后补办');
  activity.createCompletion({ userId, sourceType: 'reminder', sourceId: expiredTask.id, instanceId: expiredCycleId, note: '逾期后手动完成' });
  assert.ok(actionCenter.getActionCenter(userId, 7).completedToday.some(item => item.instanceId === expiredCycleId));
});

test('行动中心聚合待办并记录完成证明', () => {
  const today = reminders.todayInTimezone();
  const schedule = schedules.createSchedule({
    id: 'schedule-one', user_id: userId, calendar_id: 'personal', type: 'todo', title: '测试待办',
    description: undefined, start_time: today + 'T09:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'high', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.today.some(item => item.sourceId === schedule.id));
  const tomorrowSchedule = schedules.createSchedule({
    id: 'schedule-tomorrow', user_id: userId, calendar_id: 'personal', type: 'event', title: '明天的会议',
    description: undefined, start_time: reminders.addDays(today, 1) + 'T10:00:00', end_time: reminders.addDays(today, 1) + 'T11:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const withTomorrow = actionCenter.getActionCenter(userId, 7);
  assert.ok(withTomorrow.tomorrow.some(item => item.sourceId === tomorrowSchedule.id));
  assert.ok(withTomorrow.upcoming.some(item => item.sourceId === tomorrowSchedule.id));
  const completion = activity.createCompletion({ userId, sourceType: 'schedule', sourceId: schedule.id, note: '完成证明' });
  schedules.updateSchedule(schedule.id, { is_completed: true });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file = attachments.saveBase64Attachment({ userId, completionId: completion.id, originalName: 'proof.png', mimeType: 'image/png', base64: pngHeader.toString('base64') });
  assert.equal(attachments.readAttachment(file).equals(pngHeader), true);
  assert.equal(activity.listAttachments(userId, completion.id).length, 1);
  assert.equal(activity.getAttachment(file.id, 'other-user'), null);
  const updated = activity.updateCompletion(completion.id, userId, { note: '更新后的证明，金额 123.45 元' });
  assert.equal(updated?.note, '更新后的证明，金额 123.45 元');
});

test('完成证明拒绝非法金额、日期和过长备注', () => {
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    amountCents: -1,
  }), /金额/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    billDate: '2026-99-99',
  }), /账单日期/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    billDate: '2026-02-31',
  }), /账单日期/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    note: 'x'.repeat(10_001),
  }), /完成备注/);
});

test('行动中心显示未完成的历史待办，并按用户时区识别带偏移量的今天', () => {
  const today = reminders.todayInTimezone();
  const overdue = schedules.createSchedule({
    id: 'schedule-overdue-action-center', user_id: userId, calendar_id: 'personal', type: 'todo', title: '历史逾期待办',
    description: undefined, start_time: reminders.addDays(today, -2) + 'T09:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'high', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const overdueEvent = schedules.createSchedule({
    id: 'schedule-overdue-event-action-center', user_id: userId, calendar_id: 'personal', type: 'event', title: '历史逾期日程',
    description: undefined, start_time: reminders.addDays(today, -2) + 'T10:00:00', end_time: reminders.addDays(today, -2) + 'T11:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const staleCompletionEvent = schedules.createSchedule({
    id: 'schedule-stale-completion-event-action-center', user_id: userId, calendar_id: 'personal', type: 'event', title: '带历史完成脏记录的逾期日程',
    description: undefined, start_time: reminders.addDays(today, -3) + 'T12:00:00', end_time: reminders.addDays(today, -3) + 'T13:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  activity.createCompletion({ userId, sourceType: 'schedule', sourceId: staleCompletionEvent.id, note: '遗留完成记录' });
  const todayWithOffset = new Date(`${today}T00:30:00+08:00`).toISOString();
  const todaySchedule = schedules.createSchedule({
    id: 'schedule-today-offset-action-center', user_id: userId, calendar_id: 'personal', type: 'todo', title: '带偏移量的今天待办',
    description: undefined, start_time: todayWithOffset, end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });

  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.overdue.some(item => item.sourceId === overdue.id));
  assert.ok(center.overdue.some(item => item.sourceId === overdueEvent.id));
  assert.ok(center.overdue.some(item => item.sourceId === staleCompletionEvent.id));
  assert.equal(center.overdue.find(item => item.sourceId === staleCompletionEvent.id)?.completionId, null);
  assert.ok(center.today.some(item => item.sourceId === todaySchedule.id));
  assert.equal(center.overdue.some(item => item.sourceId === todaySchedule.id), false);
});

test('无日期待办只出现在行动中心的挂起区域', () => {
  const today = reminders.todayInTimezone();
  const suspended = schedules.createSchedule({
    id: 'schedule-suspended-todo', user_id: userId, calendar_id: 'personal', type: 'todo', title: '长期挂起事项',
    description: undefined, start_time: today + 'T00:00:00', end_time: undefined,
    all_day: false, is_unscheduled: true, location: undefined, notes: '想到时再处理', category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  assert.equal(suspended.end_time, undefined);
  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.unscheduled.some(item => item.sourceId === suspended.id));
  assert.equal(center.today.some(item => item.sourceId === suspended.id), false);
  assert.equal(schedules.getSchedulesByDate(today, userId).some(item => item.id === suspended.id), false);
});

test('日程分类只保留六个统一分类，未知值归入其他', () => {
  const schedule = schedules.createSchedule({
    id: 'schedule-legacy-category', user_id: userId, calendar_id: 'personal', type: 'event', title: '旧分类日程',
    description: undefined, start_time: reminders.todayInTimezone() + 'T12:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'personal', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  assert.equal(schedule.category, 'other');
});

test('日历取消完成会同步行动中心，全天事项保留全天语义和备注', () => {
  const today = reminders.todayInTimezone();
  const schedule = schedules.createSchedule({
    id: 'schedule-all-day-undo', user_id: userId, calendar_id: 'personal', type: 'todo', title: '全天回退测试',
    description: undefined, start_time: `${today}T00:00:00`, end_time: `${today}T23:59:59`,
    all_day: true, location: undefined, notes: '携带账单原件', category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });

  const before = actionCenter.getActionCenter(userId, 7).today.find(item => item.sourceId === schedule.id);
  assert.equal(before?.allDay, true);
  assert.equal(before?.nextAction, '携带账单原件');

  assert.equal(scheduleCompletion.toggleScheduleCompletion(schedule.id, userId)?.is_completed, true);
  assert.ok(actionCenter.getActionCenter(userId, 7).completedToday.some(item => item.sourceId === schedule.id));

  assert.equal(scheduleCompletion.toggleScheduleCompletion(schedule.id, userId)?.is_completed, false);
  const reopened = actionCenter.getActionCenter(userId, 7);
  assert.equal(reopened.completedToday.some(item => item.sourceId === schedule.id), false);
  assert.ok(reopened.today.some(item => item.sourceId === schedule.id));
});

test('通知队列幂等且可重试', () => {
  const input = { userId, sourceType: 'test', sourceId: 'one', channel: 'in_app' as const, kind: 'test', title: '测试通知', body: '内容', scheduledAt: new Date().toISOString(), dedupeKey: 'test:one' };
  const first = activity.enqueueNotification(input);
  const second = activity.enqueueNotification(input);
  assert.equal(first.id, second.id);
  assert.equal(activity.claimNotification(first.id), true);
  activity.markNotificationFailed(first.id, 'temporary');
  const failed = activity.getNotification(first.id);
  assert.equal(failed?.attempts, 1);
  assert.ok(failed?.nextRetryAt);
  assert.equal(activity.retryNotification(first.id, userId)?.status, 'pending');
});

test('用户加密备份可检查并合并恢复', () => {
  const password = 'test-password-123';
  const encrypted = backups.createUserBackup(userId, password);
  const preview = backups.inspectUserBackup(encrypted, password) as any;
  assert.ok(preview.counts.schedules >= 1);
  assert.ok(preview.counts.attachments >= 1);
  assert.throws(() => backups.inspectUserBackup(encrypted, 'wrong-password'), /密码错误|损坏/);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 0xff;
  assert.throws(() => backups.inspectUserBackup(damaged, password), /密码错误|损坏/);
  const restored = backups.restoreUserBackup(userId, encrypted, password, 'merge') as any;
  assert.equal(restored.mode, 'merge');
});

test('跨账号恢复会重映射关联 ID，替换恢复会清理旧附件文件', () => {
  const targetUserId = 'other-session-user';
  const password = 'cross-account-password';
  const sourceScheduleIds = new Set(schedules.getAllSchedules(userId).map(item => item.id));
  const encrypted = backups.createUserBackup(userId, password);
  const merged = backups.restoreUserBackup(targetUserId, encrypted, password, 'merge') as any;
  assert.equal(merged.idsRemapped, true);
  const targetSchedules = schedules.getAllSchedules(targetUserId);
  assert.ok(targetSchedules.length > 0);
  assert.equal(targetSchedules.some(item => sourceScheduleIds.has(item.id)), false);

  const completion = activity.createCompletion({
    userId: targetUserId,
    sourceType: 'schedule',
    sourceId: targetSchedules[0].id,
    note: '等待替换恢复清理',
  });
  const uniquePdf = Buffer.from('%PDF-1.4\nunique-target-attachment\n%%EOF', 'utf8');
  const orphan = attachments.saveBase64Attachment({
    userId: targetUserId,
    completionId: completion.id,
    originalName: 'old-proof.pdf',
    mimeType: 'application/pdf',
    base64: uniquePdf.toString('base64'),
  });
  const orphanPath = path.join(tempDir, orphan.storagePath);
  assert.equal(fs.existsSync(orphanPath), true);

  const replaced = backups.restoreUserBackup(targetUserId, encrypted, password, 'replace') as any;
  assert.equal(replaced.idsRemapped, true);
  assert.equal(fs.existsSync(orphanPath), false);
  assert.equal(activity.getAttachment(orphan.id, targetUserId), null);
});

test('S2-04 账号备份恢复 V3 引用，兼容旧备份并拒绝断裂引用', () => {
  const source = 'v3-backup-source';
  const target = 'v3-backup-target';
  const legacyTarget = 'v3-legacy-target';
  const now = '2026-09-24T04:00:00.000Z';
  const password = 'v3-backup-password';
  for (const [id, email] of [[source, 'v3-source@example.test'], [target, 'v3-target@example.test'], [legacyTarget, 'v3-legacy@example.test']]) {
    db.createUser({ id, email, password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now });
  }
  const v3 = activity.digestV3Store;
  const baseEvidence = (userId: string) => ({
    id: 'source-1', userId, url: 'https://example.test/source-1', publisherKey: 'example',
    documentType: 'release', language: 'en', sourceFact: 'launch confirmed',
    publishedAt: '2026-09-24', publishedPrecision: 'date' as const, retrievedAt: now,
    independenceKey: 'source-1', reviewState: 'verified' as const,
  });
  const firstRevision = (userId: string) => ({
    id: 'revision-1', userId, eventId: 'event-1', revisionNo: 1,
    previousRevisionId: null, changeKind: 'initial' as const,
    facts: [{ factKey: 'launch', value: 'confirmed', unit: null, scope: 'mission', evidenceIds: ['source-1'] }],
    evidenceIds: ['source-1'], recordedAt: now,
  });
  const firstEvent = (userId: string, title: string) => ({
    id: 'event-1', userId, eventType: 'mission', subjectKey: 'mission', occurrenceKey: 'launch',
    title, lifecycle: 'active' as const, currentRevisionId: 'revision-1', createdAt: now,
  });
  v3.addEvidence(baseEvidence(source));
  v3.createEvent(firstEvent(source, 'source event'), firstRevision(source));
  v3.addEvidence({ ...baseEvidence(source), id: 'source-2', sourceFact: 'updated detail',
    relatedEvidenceId: 'source-1', relation: 'update', linkedRevisionId: 'revision-1' });
  v3.appendRevision({ ...firstRevision(source), id: 'revision-2', revisionNo: 2,
    previousRevisionId: 'revision-1', changeKind: 'progress', evidenceIds: ['source-2'],
    facts: [{ factKey: 'launch', value: 'complete', unit: null, scope: 'mission', evidenceIds: ['source-2'] }] });
  v3.addAnalysis({ id: 'analysis-1', userId: source, eventRevisionId: 'revision-2',
    comparedRevisionIds: ['revision-1'], evidenceIds: ['source-2'], analysisKind: 'change_assessment',
    body: 'The launch progressed.', authorKind: 'ai', recordedAt: now,
    factKey: 'launch', scope: 'mission', check: 'complete', assessment: 'material' });
  v3.addEvidence(baseEvidence(target));
  v3.createEvent(firstEvent(target, 'target existing event'), firstRevision(target));

  const encrypted = backups.createUserBackup(source, password);
  const inspected = backups.inspectUserBackup(encrypted, password) as any;
  assert.equal(inspected.counts.digestV3Events, 1);
  assert.equal(inspected.counts.digestV3Revisions, 2);
  assert.equal(inspected.counts.digestV3Evidence, 2);
  assert.equal(inspected.counts.digestV3Analyses, 1);
  const merged = backups.restoreUserBackup(target, encrypted, password, 'merge') as any;
  assert.equal(merged.idsRemapped, true);
  const targetRows = activity.exportUserActivity(target) as Record<string, any[]>;
  const copied = targetRows.digestV3Events.find(row => row.title === 'source event');
  assert.ok(copied);
  assert.notEqual(copied.id, 'event-1');
  assert.equal(v3.getEvent(target, 'event-1')?.title, 'target existing event');
  const copiedRevision = v3.getRevision(target, copied.current_revision_id)!;
  assert.equal(copiedRevision.revisionNo, 2);
  assert.equal(copiedRevision.eventId, copied.id);
  const copiedEvidenceId = copiedRevision.evidenceIds[0];
  assert.equal(v3.getEvidence(target, copiedEvidenceId)?.sourceFact, 'updated detail');
  assert.equal(copiedRevision.facts[0].evidenceIds[0], copiedEvidenceId);
  const copiedAnalysis = targetRows.digestV3Analyses.find(row => row.event_revision_id === copiedRevision.id);
  assert.equal(v3.getAnalysis(target, copiedAnalysis.id)?.comparedRevisionIds?.length, 1);
  assert.equal(v3.getAnalysis(source, 'analysis-1')?.body, 'The launch progressed.');

  v3.addEvidence({ ...baseEvidence(source), id: 'extra-source', sourceFact: 'temporary' });
  backups.restoreUserBackup(source, encrypted, password, 'replace');
  assert.equal(v3.getEvidence(source, 'extra-source'), null);
  assert.equal(v3.getRevision(source, 'revision-2')?.facts[0].evidenceIds[0], 'source-2');
  const expectedActivity = backups.decryptBackup<any>(encrypted, password).activity;
  const restoredActivity = activity.exportUserActivity(source) as Record<string, any[]>;
  for (const key of Object.keys(expectedActivity).filter(key => key.startsWith('digestV3'))) {
    assert.deepEqual(restoredActivity[key], expectedActivity[key]);
  }

  const oldPayload = backups.decryptBackup<any>(encrypted, password);
  for (const key of Object.keys(oldPayload.activity).filter(key => key.startsWith('digestV3'))) delete oldPayload.activity[key];
  const oldBackup = backups.encryptBackup(oldPayload, password);
  assert.equal((backups.inspectUserBackup(oldBackup, password) as any).counts.digestV3Events, 0);
  const before = activity.exportUserActivity(source);
  assert.throws(() => backups.restoreUserBackup(source, oldBackup, password, 'replace'), /旧备份不含 V3/);
  assert.deepEqual(activity.exportUserActivity(source), before);
  backups.restoreUserBackup(source, oldBackup, password, 'merge');
  assert.equal(v3.getEvent(source, 'event-1')?.currentRevisionId, 'revision-2');
  backups.restoreUserBackup(legacyTarget, oldBackup, password, 'replace');
  assert.equal(v3.hasUserData(legacyTarget), false);
  const conflicting = backups.decryptBackup<any>(encrypted, password);
  conflicting.activity.digestV3Events[0].title = 'conflicting title';
  const beforeConflict = activity.exportUserActivity(source);
  assert.throws(() => backups.restoreUserBackup(source, backups.encryptBackup(conflicting, password), password, 'merge'), /恢复与目标记录冲突/);
  assert.deepEqual(activity.exportUserActivity(source), beforeConflict);
  const broken = backups.decryptBackup<any>(encrypted, password);
  broken.activity.digestV3AnalysisEvidence[0].evidence_id = 'missing-evidence';
  assert.throws(() => backups.inspectUserBackup(backups.encryptBackup(broken, password), password), /引用断裂/);
  const partial = backups.decryptBackup<any>(encrypted, password);
  delete partial.activity.digestV3Analyses;
  assert.throws(() => backups.inspectUserBackup(backups.encryptBackup(partial, password), password), /缺少关联表/);
});

test('D09 frozen citations survive encrypted same-account and cross-account restore', () => {
  const source = 'd09-source';
  const target = 'd09-target';
  const now = '2026-09-27T04:00:00.000Z';
  const password = 'd09-backup-password';
  for (const [id, emailAddress] of [[source, 'd09-source@example.test'], [target, 'd09-target@example.test']]) {
    db.createUser({ id, email: emailAddress, password_hash: 'synthetic', role: 'user',
      disabled: 0, created_at: now, updated_at: now });
  }
  const submission = (requestKey: string, value: string) => ({
    requestKey, cutoff: now, eventId: 'shared-d09-event',
    event: { eventType: 'mission', subjectKey: 'nasa:artemis-i',
      occurrenceKey: 'flight:artemis-i', title: `${value} title` },
    source: { url: 'https://www.nasa.gov/missions/artemis-i/', publisherKey: 'nasa',
      documentType: 'mission_blog', language: 'en', sourceFact: `${value} source`,
      publishedAt: '2022-11-16', publishedPrecision: 'date', independenceKey: requestKey },
    fact: { factKey: 'mission_milestone', value, unit: null, scope: 'artemis-i-flight' },
    analysis: { body: `${value} analysis` },
  });
  const v3 = activity.digestV3Store;
  const first = recordReviewedV3Source(v3, source, submission('d09-source-key', 'liftoff'), () => new Date(now));
  recordReviewedV3Source(v3, target, submission('d09-target-key', 'other-account'), () => new Date(now));
  const freeze = freezeReviewedV3Citation(v3, source, {
    reportDate: '2026-09-27', reportVersionKey: 'morning-draft', citationKey: 'lead', cutoff: now,
    eventId: first.eventId, revisionId: first.revisionId, analysisId: first.analysisId,
    evidenceIds: [first.evidenceId],
  }, () => new Date(now));
  const original = v3.getFrozenCitation(source, freeze.freezeId)!;
  const encrypted = backups.createUserBackup(source, password);
  assert.equal((backups.inspectUserBackup(encrypted, password) as any).counts.digestV3FrozenCitations, 1);
  const restored = backups.restoreUserBackup(target, encrypted, password, 'merge') as any;
  assert.equal(restored.idsRemapped, true);
  const targetRows = activity.exportUserActivity(target) as Record<string, any[]>;
  assert.equal(targetRows.digestV3FrozenCitations.length, 1);
  const mapped = v3.getFrozenCitation(target, targetRows.digestV3FrozenCitations[0].id)!;
  assert.notEqual(mapped.id, original.id);
  assert.notEqual(mapped.reportVersionKey, original.reportVersionKey);
  assert.notEqual(mapped.revisionId, original.revisionId);
  assert.notEqual(mapped.evidenceIds[0], original.evidenceIds[0]);
  assert.equal(mapped.snapshotSha256, original.snapshotSha256);
  assert.deepEqual(mapped.snapshot, original.snapshot);
  assert.equal(v3.getRevision(target, mapped.revisionId)?.eventId, mapped.eventId);
  assert.equal(v3.getEvidence(target, mapped.evidenceIds[0])?.sourceFact, 'liftoff source');
  assert.equal(v3.getFrozenCitation(target, original.id), null);

  backups.restoreUserBackup(source, encrypted, password, 'replace');
  assert.deepEqual(v3.getFrozenCitation(source, original.id), original);
  const oldSeven = backups.decryptBackup<any>(encrypted, password);
  delete oldSeven.activity.digestV3FrozenCitations;
  const oldSevenEncrypted = backups.encryptBackup(oldSeven, password);
  assert.equal((backups.inspectUserBackup(oldSevenEncrypted, password) as any).counts.digestV3FrozenCitations, 0);
  const before = activity.exportUserActivity(source);
  assert.throws(() => backups.restoreUserBackup(source, oldSevenEncrypted, password, 'replace'), /不含 V3 冻结引用/);
  assert.deepEqual(activity.exportUserActivity(source), before);
  const broken = backups.decryptBackup<any>(encrypted, password);
  broken.activity.digestV3FrozenCitations[0].evidence_ids_json = '["missing"]';
  assert.throws(() => backups.inspectUserBackup(backups.encryptBackup(broken, password), password), /冻结引用备份无效/);
  const changed = backups.decryptBackup<any>(encrypted, password);
  changed.activity.digestV3FrozenCitations[0].snapshot_json = '{}';
  assert.throws(() => backups.inspectUserBackup(backups.encryptBackup(changed, password), password), /冻结引用备份无效/);
  const unsafe = backups.decryptBackup<any>(encrypted, password);
  const unsafeRow = unsafe.activity.digestV3FrozenCitations[0];
  const unsafeSnapshot = JSON.parse(unsafeRow.snapshot_json);
  unsafeSnapshot.evidence[0].url = 'http://127.0.0.1/private';
  unsafeRow.snapshot_json = JSON.stringify(unsafeSnapshot);
  unsafeRow.snapshot_sha256 = crypto.createHash('sha256').update(unsafeRow.snapshot_json).digest('hex');
  assert.throws(() => backups.inspectUserBackup(backups.encryptBackup(unsafe, password), password), /冻结引用备份无效/);
  const beforeTarget = activity.exportUserActivity(target);
  const beforeTargetBackup = backups.decryptBackup<any>(backups.createUserBackup(target, password), password);
  assert.throws(() => backups.restoreUserBackup(target, oldSevenEncrypted, password, 'replace'), /不含 V3 冻结引用/);
  assert.deepEqual(activity.exportUserActivity(target), beforeTarget);
  const afterTargetBackup = backups.decryptBackup<any>(backups.createUserBackup(target, password), password);
  assert.deepEqual({ ...afterTargetBackup, exportedAt: beforeTargetBackup.exportedAt }, beforeTargetBackup);
  const oldMerge = backups.restoreUserBackup(target, oldSevenEncrypted, password, 'merge') as any;
  assert.equal(oldMerge.idsRemapped, true);
  const afterOldMerge = activity.exportUserActivity(target) as Record<string, any[]>;
  assert.deepEqual(afterOldMerge.digestV3FrozenCitations, (beforeTarget as Record<string, any[]>).digestV3FrozenCitations);
  assert.equal(afterOldMerge.digestV3Events.length, (beforeTarget as Record<string, any[]>).digestV3Events.length + 1);
  const newReplace = backups.restoreUserBackup(target, encrypted, password, 'replace') as any;
  assert.equal(newReplace.idsRemapped, true);
  const afterNewReplace = activity.exportUserActivity(target) as Record<string, any[]>;
  assert.equal(afterNewReplace.digestV3Events.length, 1);
  assert.equal(afterNewReplace.digestV3FrozenCitations.length, 1);
  const replaced = v3.getFrozenCitation(target, afterNewReplace.digestV3FrozenCitations[0].id)!;
  assert.deepEqual(replaced.snapshot, original.snapshot);
  assert.equal(v3.getRevision(target, replaced.revisionId)?.eventId, replaced.eventId);
});

test('全站恢复统一替换四个数据库和附件且不遗留暂存文件', () => {
  const previousKey = process.env.BACKUP_ENCRYPTION_KEY;
  const previousMaintenance = process.env.MAINTENANCE_MODE;
  process.env.BACKUP_ENCRYPTION_KEY = 'system-restore-test-password';
  process.env.MAINTENANCE_MODE = 'true';
  try {
    const attachmentRoot = attachments.attachmentsRoot();
    const originalAttachment = path.join(attachmentRoot, 'system-restore-test', 'proof.txt');
    fs.mkdirSync(path.dirname(originalAttachment), { recursive: true });
    fs.writeFileSync(originalAttachment, 'original attachment', 'utf8');
    const mediaRoot = dailyReportMedia.dailyReportMediaRoot();
    const originalMedia = path.join(mediaRoot, `${'d'.repeat(64)}.png`);
    fs.writeFileSync(originalMedia, 'original media', 'utf8');
    const bridgeRoot = path.join(tempDir, 'caldav-bridge'); fs.mkdirSync(bridgeRoot, { recursive: true });
    fs.writeFileSync(path.join(bridgeRoot, 'state.json'), JSON.stringify({ version: 2, binding: 'synthetic', entries: {} }));
    fs.writeFileSync(path.join(bridgeRoot, 'control.json'), JSON.stringify({ version: 1, enabled: true, failures: 0 }));
    const snapshot = backups.createSystemSnapshot(false);
    const encrypted = backups.readSystemSnapshot(snapshot.filename);
    const databaseNames = ['chat.db', 'schedule.db', 'reminder.db', 'activity.db'];
    const expectedHashes = new Map(databaseNames.map(name => [
      name,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(tempDir, name))).digest('hex'),
    ]));

    for (const name of databaseNames) fs.appendFileSync(path.join(tempDir, name), 'changed-after-snapshot');
    fs.writeFileSync(originalAttachment, 'changed attachment', 'utf8');
    fs.writeFileSync(path.join(attachmentRoot, 'extra.txt'), 'remove me', 'utf8');
    fs.writeFileSync(originalMedia, 'changed media', 'utf8');
    fs.writeFileSync(path.join(bridgeRoot, 'state.json'), 'changed after snapshot');

    backups.restoreSystemSnapshot(encrypted, 'RESTORE AI CALENDAR');

    for (const name of databaseNames) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(tempDir, name))).digest('hex');
      assert.equal(actual, expectedHashes.get(name));
    }
    assert.equal(fs.readFileSync(originalAttachment, 'utf8'), 'original attachment');
    assert.equal(fs.existsSync(path.join(attachmentRoot, 'extra.txt')), false);
    assert.equal(fs.readFileSync(originalMedia, 'utf8'), 'original media');
    assert.equal(JSON.parse(fs.readFileSync(path.join(bridgeRoot, 'state.json'), 'utf8')).binding, 'synthetic');
    assert.equal(JSON.parse(fs.readFileSync(path.join(bridgeRoot, 'control.json'), 'utf8')).enabled, false);
    assert.equal(fs.readdirSync(tempDir).some(name => name.includes('.restore-') || name.includes('.pre-restore-')), false);
  } finally {
    if (previousKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previousKey;
    if (previousMaintenance === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previousMaintenance;
  }
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
