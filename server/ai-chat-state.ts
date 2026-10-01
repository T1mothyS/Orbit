import { queryOne as dbQueryOne, run as dbQueryRun } from './database/connection.js';
import { orbitContext, conversation, getRequest } from './orbit-store.js';
import { normaliseScheduleApiFields } from './schedule-input.js';
import { normaliseReminderConfig } from './reminder-input.js';
import { getLocalDateString } from './local-date.js';
import { withPersistenceTransaction } from './persistence.js';

import { v4 as uuidv4 } from 'uuid';
import * as dbModule from './db.js';
import * as scheduleStore from './schedule-store.js';
import * as reminderStore from './reminder-store.js';
import * as reminderCalendarSync from './reminder-calendar-sync.js';
import { getDailyWeather, type WeatherLocation } from './weather-service.js';
import { addLog } from './log-service.js';
import { type KnowledgeSearchMatch } from './search-service.js';
import { rawOperationsFromSnapshot, scheduleFingerprint, type PendingAiOperation } from './ai-plan.js';
import * as db from './db.js';
import { parseHistoryJson } from './ai-history.js';
import { recordKnowledgeCitations } from './orbit-statistics.js';

export { resolveQueryDates as parseQueryDatesForCards } from './orbit-time.js';

// 检查登录状态的辅助函数
export const AI_CATEGORY_LABELS_CN: Record<string, string> = {
  travel: '出行', work: '工作', social: '社交', life: '生活', health: '健康', other: '其他'
};

export function formatAiQueryDateLabel(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00`);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

export function joinAiLabels(labels: string[]) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return labels.join('和');
  return labels.slice(0, -1).join('、') + '和' + labels[labels.length - 1];
}

export function buildCompactScheduleQueryReply(items: any[], queryDates: string[], today: string) {
  const subject = queryDates.length === 1 && queryDates[0] === today
    ? '今天'
    : queryDates.map(formatAiQueryDateLabel).join('、') || '所选日期';
  if (items.length === 0) return `${subject}暂无安排。`;

  const describePeriod = (label: string, periodItems: any[]) => {
    if (periodItems.length === 0) return '';
    const categories = [...new Set(periodItems.map(item => AI_CATEGORY_LABELS_CN[item.category] || '其他'))];
    return `${label}有${joinAiLabels(categories)}安排`;
  };
  const allDayItems = items.filter(item => item.all_day);
  const timedItems = items.filter(item => !item.all_day);
  const morning = timedItems.filter(item => Number(item.start_time.slice(11, 13)) < 12);
  const afternoon = timedItems.filter(item => {
    const hour = Number(item.start_time.slice(11, 13));
    return hour >= 12 && hour < 18;
  });
  const evening = timedItems.filter(item => Number(item.start_time.slice(11, 13)) >= 18);
  const details = [
    describePeriod('上午', morning),
    describePeriod('下午', afternoon),
    describePeriod('晚上', evening),
    allDayItems.length > 0 ? `另有 ${allDayItems.length} 项全天安排` : '',
  ].filter(Boolean);
  const density = items.length >= 4 ? '日程较满' : '已有安排';
  const summary = details.length > 0
    ? `${subject}${density}，${details.join('，')}，请注意合理安排时间。`
    : `${subject}${density}，请注意合理安排时间。`;
  return `${subject}共有 ${items.length} 项安排，以下是详情：\n\n${summary}`;
}

export function weatherDateForQuestion(text: string, timezone: string, fallback?: string): string {
  const today = reminderStore.todayInTimezone(timezone);
  if (/后天/.test(text)) return reminderStore.addDays(today, 2);
  if (/明天/.test(text)) return reminderStore.addDays(today, 1);
  return fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : today;
}

export function homeWeatherLocation(preference: dbModule.DbReminder | undefined): WeatherLocation | null {
  if (!preference?.home_location_name || preference.home_latitude == null || preference.home_longitude == null) return null;
  return {
    id: 0,
    name: preference.home_location_name,
    admin1: preference.home_location_admin1 || null,
    admin2: null,
    country: preference.home_location_country || null,
    countryCode: null,
    latitude: Number(preference.home_latitude),
    longitude: Number(preference.home_longitude),
    timezone: preference.home_timezone || preference.timezone || 'Asia/Shanghai',
    displayName: [preference.home_location_name, preference.home_location_admin1, preference.home_location_country].filter(Boolean).join(' · '),
  };
}

export function formatWeatherReply(location: WeatherLocation, weather: Awaited<ReturnType<typeof getDailyWeather>>): string {
  const temperatures = weather.temperatureMin == null || weather.temperatureMax == null
    ? '气温数据暂缺'
    : `${Math.round(weather.temperatureMin)}～${Math.round(weather.temperatureMax)}℃`;
  const rain = weather.precipitationProbabilityMax == null
    ? ''
    : `，最高降雨概率 ${Math.round(weather.precipitationProbabilityMax)}%`;
  const wind = weather.windSpeedMax == null ? '' : `，最大风速约 ${Math.round(weather.windSpeedMax)} km/h`;
  const source = weather.source === 'cache'
    ? `天气数据来自 Open-Meteo 缓存（${weather.retrievedAt} 获取，已缓存约 ${Math.max(1, Math.round(weather.cacheAgeMs / 60_000))} 分钟），仅供参考`
    : '天气数据来自 Open-Meteo 实时请求';
  return `${location.displayName} ${weather.date}：${weather.description}，${temperatures}${rain}${wind}。${source}，出行前建议再关注临近预报。`;
}

export interface PendingAiSchedulePlan {
  id: string;
  userId: string;
  targetCalendarId: string;
  today: string;
  intent: string;
  reply: string;
  warnings: string[];
  operations: PendingAiOperation[];
  expiresAt: number;
  historyMessageId?: string;
  confirmedResult?: any;
}

export interface AiChatRequestRecord {
  userId: string;
  state: 'processing' | 'completed';
  expiresAt: number;
  response?: any;
}

export const AI_SCHEDULE_PLAN_TTL_MS = 15 * 60 * 1000;
export const aiSchedulePlans = new Map<string, PendingAiSchedulePlan>();
export const aiChatRequestRecords = new Map<string, AiChatRequestRecord>();

export function buildAiKnowledgeSources(matches: KnowledgeSearchMatch[]) {
  return matches.map(match => ({
    id: match.id,
    title: match.title,
    summary: match.summary,
    snippet: match.snippet,
    sourceId: match.sourceId,
    sourceType: match.sourceType,
    sourceRef: match.sourceRef,
    sourceUrl: match.sourceUrl,
    type: match.type,
    tags: match.tags,
    updatedAt: match.updatedAt,
    target: match.target,
  }));
}

export function saveAiScheduleHistoryMessage(input: {
  userId: string;
  role: 'user' | 'assistant';
  type: string;
  content: string;
  intent?: string | null;
  scheduleItems?: unknown;
  plan?: unknown;
  knowledgeSources?: unknown;
}): dbModule.DbAiScheduleMessage {
  const context=orbitContext.getStore();
  if(context?.controller?.signal.aborted) throw new Error('生成已取消');
  if(context) {
    conversation(input.userId,context.conversationId);
    const user=db.getUserById(input.userId);if(!user || user.disabled) throw new Error('账号不可用');
    if(context.requestId && !getRequest(input.userId,context.requestId)) throw new Error('请求已移除');
  }
  const id = context?.requestId && input.role === 'user' ? `orbit-user:${input.userId}:${context.requestId}` : uuidv4();
  const existing = context?.requestId && input.role==='user' ? dbQueryOne<dbModule.DbAiScheduleMessage>('SELECT * FROM ai_schedule_messages WHERE id=? AND user_id=?',[id,input.userId]) : null;
  if(existing) return existing;
  if(context?.conversationId) dbQueryRun('UPDATE orbit_conversations SET updated_at=? WHERE id=? AND user_id=?',[new Date().toISOString(),context.conversationId,input.userId]);
  const message=db.createAiScheduleMessage({
    conversation_id: context?.conversationId || null,
    id,
    user_id: input.userId,
    role: input.role,
    type: input.type,
    content: input.content,
    intent: input.intent || null,
    schedule_items: input.scheduleItems === undefined ? null : JSON.stringify(input.scheduleItems),
    plan: input.plan === undefined ? null : JSON.stringify(input.plan),
    knowledge_sources: input.knowledgeSources === undefined ? null : JSON.stringify(input.knowledgeSources),
    created_at: new Date().toISOString(),
  });
  if(input.role==='assistant')recordKnowledgeCitations(input.userId,message.id,input.knowledgeSources);
  return message;
}

export function saveAiScheduleResponseHistory(userId: string, response: any): dbModule.DbAiScheduleMessage {
  const type = response.requiresConfirmation
    ? 'plan'
    : response.intent === 'chat' || response.intent === 'query' || response.intent === 'weather'
      ? 'text'
      : response.intent === 'update' || response.intent === 'delete'
        ? 'update'
        : 'schedules';
  return saveAiScheduleHistoryMessage({
    userId,
    role: 'assistant',
    type,
    content: String(response.reply || ''),
    intent: response.intent || null,
    scheduleItems: response.scheduleItems || [],
    plan: response.plan,
    knowledgeSources: response.knowledgeSources || [],
  });
}

export function cleanupExpiredAiScheduleState(): void {
  const now = Date.now();
  for (const [id, plan] of aiSchedulePlans) if (plan.expiresAt <= now) aiSchedulePlans.delete(id);
  for (const [id, request] of aiChatRequestRecords) if (request.expiresAt <= now) aiChatRequestRecords.delete(id);
}

export function hydratePendingAiSchedulePlans(userId: string, messages: dbModule.DbAiScheduleMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'assistant' || message.type !== 'plan' || !message.plan) continue;
    const snapshot = parseHistoryJson(message.plan);
    if (!snapshot?.id || !snapshot?.expiresAt || Date.parse(String(snapshot.expiresAt)) <= Date.now()) continue;
    const operations = rawOperationsFromSnapshot(snapshot);
    if (!operations.length) continue;
    aiSchedulePlans.set(String(snapshot.id), {
      id: String(snapshot.id),
      userId,
      targetCalendarId: String(snapshot.targetCalendarId || 'personal'),
      today: String(snapshot.today || getLocalDateString()),
      intent: String(snapshot.intent || 'create'),
      reply: String(snapshot.reply || '已整理出待确认的执行计划。'),
      warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.map(String) : [],
      operations,
      expiresAt: Date.parse(String(snapshot.expiresAt)),
      historyMessageId: message.id,
      confirmedResult: dbModule.getOperationResult(userId, 'ai-plan', String(snapshot.id)),
    });
  }
}

export function isAiChatRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,120}$/.test(value);
}

export function buildAiPlanWarnings(text: string, operations: any[], modelWarnings: unknown): string[] {
  const warnings = new Set<string>(Array.isArray(modelWarnings) ? modelWarnings.map(String).slice(0, 10) : []);
  const hasRecurringLanguage = /(每天|每日|每周|每月|每年|每隔\s*\d*\s*[天周月年])/.test(text);
  const hasRecurringOperation = operations.some(operation => operation?.type === 'create_recurring');
  if (hasRecurringLanguage && !hasRecurringOperation) {
    warnings.add('原文包含周期表述，但计划未生成周期事项；确认前请改为“周期事项”或补充周期。');
  }
  if (/(周[一二三四五六日天].{0,3}(前|内)|周内|下周|本周)/.test(text)) {
    warnings.add('原文含相对日期，请逐项核对计划中显示的公历日期与时间。');
  }
  if (operations.length > 1) {
    warnings.add('这是多事项计划；确认后会一次执行全部列出的操作。');
  }
  return [...warnings].slice(0, 10);
}

export function executeAiScheduleOperations(plan: PendingAiSchedulePlan) {
  const aggregate: ReturnType<typeof executeAiScheduleOperationBatch> = { createdSchedules: [], updatedSchedules: [], deletedIds: [], createdReminderTasks: [], failures: [], changed: false };
  for (const [index, operation] of plan.operations.entries()) {
    try {
      const result = withPersistenceTransaction(() => {
        const item = executeAiScheduleOperationBatch({ ...plan, operations: [operation] });
        if (item.failures.length) throw new Error(item.failures.map(failure => failure.message).join('；'));
        return item;
      });
      aggregate.createdSchedules.push(...result.createdSchedules);
      aggregate.updatedSchedules.push(...result.updatedSchedules);
      aggregate.deletedIds.push(...result.deletedIds);
      aggregate.createdReminderTasks.push(...result.createdReminderTasks);
      aggregate.changed ||= result.changed;
    } catch (error: any) {
      aggregate.failures.push({ index, type: String(operation.type), message: error?.message || '操作失败' });
    }
  }
  return aggregate;
}

export function executeAiScheduleOperationBatch(plan: PendingAiSchedulePlan) {
  const createdSchedules: any[] = [];
  const updatedSchedules: any[] = [];
  const deletedIds: string[] = [];
  const createdReminderTasks: any[] = [];
  const failures: Array<{ index: number; type: string; message: string }> = [];

  for (const [index, op] of plan.operations.entries()) {
    if (op.type === 'create' && op.data?.title) {
      try {
        const fields = normaliseScheduleApiFields({
          ...op.data,
          calendar_id: plan.targetCalendarId,
          type: op.data.type === 'todo' ? 'todo' : 'event',
          title: String(op.data.title).slice(0, 160),
          start_time: op.data.start_time || (plan.today + 'T09:00:00'),
          end_time: op.data.end_time || undefined,
          is_unscheduled: op.data.is_unscheduled,
          all_day: op.data.all_day,
          category: ['travel', 'work', 'social', 'life', 'health', 'other'].includes(op.data.category) ? op.data.category : 'other',
          priority: ['high', 'medium', 'low'].includes(op.data.priority) ? op.data.priority : 'medium',
          is_completed: false,
          is_repeated: false,
          reminders: [],
          is_high_risk: false,
        }, plan.userId);
        const created = scheduleStore.createSchedule({
          id: uuidv4(),
          user_id: plan.userId,
          ...fields,
        } as Omit<scheduleStore.Schedule, 'created_at' | 'updated_at'>);
        if (created) {
          createdSchedules.push(created);
          addLog('info', 'schedule', 'AI 确认事务暂存日程', { id: created.id, planId: plan.id });
        }
      } catch (error: any) {
        failures.push({ index, type: 'create', message: error?.message || '创建日程失败' });
        addLog('error', 'schedule', 'AI 计划创建失败', { error: error?.message, planId: plan.id });
      }
    } else if (op.type === 'create_recurring' && op.data?.title) {
      try {
        const recurrence = op.recurrence || op.data.recurrence || {};
        const anchorDate = recurrence.anchorDate || String(op.data.start_time || '').slice(0, 10) || plan.today;
        const task = reminderStore.createReminderTask({
          userId: plan.userId,
          type: 'generic',
          name: String(op.data.title).slice(0, 160),
          timezone: reminderStore.DEFAULT_CYCLE_REMINDER_TIMEZONE,
          config: normaliseReminderConfig('generic', {
            templateKey: 'custom',
            rule: {
              frequency: recurrence.frequency || 'interval',
              anchorDate,
              interval: recurrence.interval || 1,
              unit: recurrence.unit || 'day',
              advancePolicy: recurrence.advancePolicy || 'calendar',
              dayOfMonth: recurrence.dayOfMonth,
              month: recurrence.month,
            },
            reminderOffsets: recurrence.reminderOffsets || [1, 0],
            reminderTime: recurrence.reminderTime || reminderStore.DEFAULT_CYCLE_REMINDER_TIME,
            actionGuide: op.data.notes || '完成本周期事项并登记结果',
            priority: op.data.priority || 'medium',
          }),
        });
        createdReminderTasks.push(task);
        addLog('info', 'reminder', 'AI 确认事务暂存周期事项', { taskId: task.id, planId: plan.id });
        try {
          reminderCalendarSync.syncReminderTaskToCalendar(task);
        } catch (syncError: any) {
          failures.push({
            index,
            type: 'create_recurring_calendar_sync',
            message: `周期事项及日历同步未提交：${syncError?.message || '未知错误'}`,
          });
          addLog('warn', 'reminder', 'AI 周期事项同步失败，将回滚该操作', {
            taskId: task.id,
            planId: plan.id,
            error: syncError?.message,
          });
        }
      } catch (error: any) {
        failures.push({ index, type: 'create_recurring', message: error?.message || '创建周期事项失败' });
        addLog('error', 'reminder', 'AI 周期事项创建失败', { error: error?.message, planId: plan.id });
      }
    } else if (op.type === 'update' && op.scheduleId && op.data) {
      try {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== plan.userId) throw new Error('目标日程不存在或无权访问');
        if (op.expectedState && scheduleFingerprint(target) !== op.expectedState) throw new Error('目标事项已发生变化，请重新生成计划');
        if (reminderCalendarSync.isReminderLinkedSchedule(target.id)) {
          if (!op.data.start_time) throw new Error('请指定本周期的安排日期');
          for (const key of ['title','notes','location','category','priority','is_completed','type']) {
            if(op.data[key] !== undefined && (op.data[key] || null) !== ((target as any)[key] || null)) throw new Error('周期事项这里只能调整本周期安排日期，其他字段请前往周期提醒编辑');
          }
          const task = reminderStore.setCyclePlannedDate(target.id.slice('reminder-cycle:'.length), plan.userId, String(op.data.start_time).slice(0, 10));
          const updated = reminderCalendarSync.syncReminderTaskToCalendar(task);
          if (!updated || updated.id !== target.id) throw new Error('该周期已不再是当前周期');
          updatedSchedules.push(updated);
          continue;
        }
        const updates = normaliseScheduleApiFields(op.data, plan.userId, target);
        const updated = scheduleStore.updateSchedule(op.scheduleId, updates);
        if (!updated) throw new Error('更新日程失败');
        updatedSchedules.push(updated);
      } catch (error: any) {
        failures.push({ index, type: 'update', message: error?.message || '更新日程失败' });
        addLog('warn', 'schedule', 'AI 计划更新日程失败', { userId: plan.userId, scheduleId: op.scheduleId, planId: plan.id });
      }
    } else if (op.type === 'delete' && op.scheduleId) {
      try {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== plan.userId) throw new Error('目标日程不存在或无权访问');
        if (reminderCalendarSync.isReminderLinkedSchedule(target.id)) throw new Error('周期事项请前往周期提醒删除');
        if (op.expectedState && scheduleFingerprint(target) !== op.expectedState) throw new Error('目标事项已发生变化，请重新生成计划');
        if (!scheduleStore.deleteSchedule(op.scheduleId)) throw new Error('删除日程失败');
        deletedIds.push(op.scheduleId);
      } catch (error: any) {
        failures.push({ index, type: 'delete', message: error?.message || '删除日程失败' });
        addLog('warn', 'schedule', 'AI 计划删除日程失败', { userId: plan.userId, scheduleId: op.scheduleId, planId: plan.id });
      }
    } else {
      failures.push({ index, type: String(op?.type || 'unknown'), message: '计划操作格式不正确' });
    }
  }

  return {
    createdSchedules,
    updatedSchedules,
    deletedIds,
    createdReminderTasks,
    failures,
    changed: createdSchedules.length + updatedSchedules.length + deletedIds.length + createdReminderTasks.length > 0,
  };
}
