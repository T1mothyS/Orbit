import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { enqueueNotificationDetailed } from './activity-store.js';
import { getReminder, getUserById } from './db.js';
import { addLog } from './log-service.js';
import { operationsDirectory, readOperations } from './operations-state.js';
import { atomicWriteFile } from './persistence.js';
import { evaluatePerformanceAlert, type ApiTiming } from './performance-alert-rules.js';
import type { RequestPhases } from './request-timing.js';

const EVENT_FILE = 'system-events.json';
const MAX_EVENTS = 80;
const MAX_TIMINGS = 1000;
const MAX_HISTORY_MS = 10 * 60_000;
const COOLDOWN_MS = 30 * 60_000;
const labels: Record<string, string> = {
  'POST /api/schedules': '新增日程',
  'PATCH /api/schedules/:id': '修改日程',
  'PUT /api/schedules/:id': '保存日程',
  'POST /api/schedules/:id/toggle': '切换事项完成状态',
  'POST /api/schedules/:id/actions': '处理日程事项',
  'POST /api/completions': '提交完成记录',
  'POST /api/orbit/requests': '提交 AI 对话',
  'event-loop': '服务事件循环',
};

interface SystemEvent {
  id: string;
  severity: 'P1' | 'P2';
  source: string;
  rule: string;
  openedAt: number;
  recoveredAt?: number;
  correlationId: string;
  metrics: { count: number; p50Ms?: number | null; p95Ms: number | null; p99Ms?: number | null;
    errorRate: number | null; slowOperations: number; lagMs?: number; triggeringRequestMs?: number; phases?: RequestPhases };
  queuedOpen?: boolean;
  queuedRecovery?: boolean;
}

const timings = new Map<string, { rows: ApiTiming[]; checkedAt: number }>();
function readEvents(): SystemEvent[] {
  const result = readOperations<unknown>(EVENT_FILE, []);
  return Array.isArray(result) ? result : [];
}
const writeEvents = (events: SystemEvent[]) => atomicWriteFile(path.join(operationsDirectory(), EVENT_FILE), Buffer.from(JSON.stringify(events.slice(-MAX_EVENTS))));

export function systemAlertsEnabled(): boolean {
  return process.env.ORBIT_SYSTEM_ALERTS_ENABLED === 'true' && process.env.DIGEST_SHADOW_ONLY !== 'true';
}

export function systemEventRoleAllowed(userId: string): boolean {
  const user = getUserById(userId);
  return Boolean(user && user.role === 'admin' && !user.disabled);
}

export function listSystemEvents(userId: string, id?: string, limit = 20) {
  if (!systemEventRoleAllowed(userId)) return null;
  return readEvents().filter(event => !id || event.id === id).reverse().slice(0, limit).map(event => ({
    id: event.id, severity: event.severity, source: event.source, rule: event.rule, operation: labels[event.source],
    openedAt: new Date(event.openedAt).toISOString(),
    recoveredAt: event.recoveredAt === undefined ? null : new Date(event.recoveredAt).toISOString(),
    correlationId: event.correlationId, metrics: event.metrics,
  }));
}

export function observesOperation(route: string): boolean {
  return Object.hasOwn(labels, route) && route !== 'event-loop';
}

export function observeOperation(route: string, timing: ApiTiming, correlationId: string) {
  if (!systemAlertsEnabled() || !observesOperation(route) || (timing.status >= 400 && timing.status < 500)) return;
  const state = timings.get(route) ?? { rows: [], checkedAt: 0 };
  timings.set(route, state);
  state.rows.push(timing);
  if (state.rows.length > MAX_TIMINGS) state.rows.shift();
  if (timing.observedAt < state.checkedAt + 1000) return;
  state.checkedAt = timing.observedAt;
  state.rows = state.rows.filter(sample => sample.observedAt > timing.observedAt - MAX_HISTORY_MS);
  try {
    const events = readEvents();
    const prior = events.filter(event => event.source === route).at(-1);
    const open = prior && prior.recoveredAt === undefined ? prior : undefined;
    const verdict = evaluatePerformanceAlert(state.rows, timing.observedAt, open?.openedAt);
    if (open && verdict.recovered) {
      open.recoveredAt = timing.observedAt;
      writeEvents(events);
    } else if (!open && verdict.active && (!prior?.recoveredAt || timing.observedAt - prior.recoveredAt >= COOLDOWN_MS)) {
      events.push({
        id: randomUUID(), severity: 'P1', source: route, openedAt: timing.observedAt,
        rule: verdict.rule, correlationId, metrics: { ...verdict.metrics, triggeringRequestMs: Math.round(timing.durationMs), phases: timing.phases },
      });
      writeEvents(events);
    }
  } catch {
    // This path runs after the response. A storage error must never affect API behavior.
    addLog('warn', 'system', '无法保存性能告警', { event: 'SYSTEM_EVENT_WRITE_FAILED' });
  }
}

let eventLoop: ReturnType<typeof monitorEventLoopDelay> | undefined;
export function observeRuntimeEvents() {
  if (!systemAlertsEnabled()) return;
  try {
    if (!eventLoop) {
      eventLoop = monitorEventLoopDelay({ resolution: 20 });
      eventLoop.enable();
    } else {
      const lagMs = Math.round(eventLoop.max / 1_000_000);
      eventLoop.reset();
      const events = readEvents();
      const now = Date.now();
      const prior = events.filter(event => event.source === 'event-loop').at(-1);
      if (lagMs >= 1000 && (!prior || now - prior.openedAt >= COOLDOWN_MS)) {
        const id = randomUUID();
        events.push({
          id, severity: 'P2', source: 'event-loop', rule: 'EVENT_LOOP_DELAY', openedAt: now,
          correlationId: id, metrics: { lagMs, count: 1, p95Ms: null, errorRate: null, slowOperations: 0 },
        });
        writeEvents(events);
        addLog('warn', 'system', '服务事件循环短时等待', { event: 'EVENT_LOOP_DELAY', lagMs, correlationId: id });
      }
    }
    flushSystemEvents();
  } catch {
    addLog('warn', 'system', '系统事件暂未处理', { event: 'SYSTEM_EVENT_PROCESS_FAILED' });
  }
}

function flushSystemEvents() {
  const events = readEvents();
  const recipients = [...new Set((process.env.ORBIT_SYSTEM_ALERT_ADMINS || '').split(',').map(id => id.trim()).filter(Boolean))]
    .slice(0, 10).filter(id => systemEventRoleAllowed(id) && getReminder(id)?.in_app_enabled === 1);
  let changed = false;
  for (const event of events.filter(item => item.severity === 'P1')) {
    for (const phase of ['open', 'recovery'] as const) {
      const flag = phase === 'open' ? 'queuedOpen' : 'queuedRecovery';
      if (event[flag] || (phase === 'recovery' && event.recoveredAt === undefined)) continue;
      const title = phase === 'open' ? 'Orbit 系统告警 · P1' : 'Orbit 系统恢复';
      for (const userId of recipients) enqueueNotificationDetailed({
        userId, sourceType: 'system_event', sourceId: event.id, channel: 'in_app', kind: 'system_event', title,
        body: phase === 'open' ? '系统观察到重要异常，可在对话中继续分析。' : '系统重新观察到正常操作，可在对话中查看关联事件。',
        scheduledAt: new Date().toISOString(), dedupeKey: `system:${userId}:${event.id}:${phase}`,
      });
      event[flag] = true;
      changed = true;
    }
  }
  if (changed) writeEvents(events);
}
