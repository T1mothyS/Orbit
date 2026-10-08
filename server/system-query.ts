import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json';
import * as db from './db.js';
import * as activity from './activity-store.js';
import { queryAll } from './database/connection.js';
import { getSchedule, getAllSchedules } from './schedule-store.js';
import { readReminderProjectionSources, readReminderDeliveries, todayInTimezone } from './reminder-store.js';
import { getScheduleReminder } from './orbit-proactive.js';
import { reminderScheduleId } from './reminder-calendar-sync.js';
import { allLogs } from './log-service.js';
import { readOperations, diagnosticCode } from './operations-state.js';
import { isValidDateKey } from './date-key.js';
import { getDailyReportViewsForDate } from './daily-report-service.js';
import { readFileSync } from 'node:fs';

export class SystemQueryError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type SystemQueryKind = 'status' | 'deployments' | 'errors' | 'tasks' | 'daily-report-status' | 'reminder-status';
export interface SystemQueryOptions { date?: string; source?: string; id?: string; limit?: number }
function parse(value: string | null) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function identity(userId: string) { const user = db.getUserById(userId); if (!user || user.disabled) throw new SystemQueryError('请登录后查询', 401); return user; }
function smallCode(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : undefined; }
function time(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function workerView(s: any) { return { service: smallCode(s?.service), state: smallCode(s?.state), health: smallCode(s?.health), version: smallCode(s?.version), commit: smallCode(s?.commit) }; }
function jobView(j: any) { return {name:smallCode(j?.name),status:smallCode(j?.status),reason:j?.reason?diagnosticCode(j.reason):null,lastStartedAt:time(j?.lastStartedAt),lastFinishedAt:time(j?.lastFinishedAt),lastSuccessAt:time(j?.lastSuccessAt),lastFailureAt:time(j?.lastFailureAt),lastSkippedAt:time(j?.lastSkippedAt)}; }
function stageEvent(event: any) { return { status: smallCode(event.status), at: time(event.at), failedPhase: smallCode(event.failedPhase), code: smallCode(event.code), retryable: typeof event.retryable === 'boolean' ? event.retryable : undefined,
  inputSections:Array.isArray(event.inputSections)?event.inputSections.slice(0,3).map((s:any)=>({section:smallCode(s.section),status:smallCode(s.status)})):undefined,
  errors: Array.isArray(event.errors) ? event.errors.slice(0,10).map((e: any) => ({ code: smallCode(e.code) })) : undefined,
  failedStories: Array.isArray(event.failedStories) ? event.failedStories.slice(0,20).map((s: any) => ({ storyId: smallCode(s.storyId), media: Array.isArray(s.media) ? s.media.slice(0,5).map((m: any) => ({ code: smallCode(m.code), stage: smallCode(m.stage), reason: smallCode(m.reason), attempts: Number(m.attempts) || 0 })) : [] })) : undefined } }
const reasons: Record<string,string> = { STORY_IMAGE_NOT_READY: '逐条配图未准备完成，发布被完整性检查阻止', INPUTS_FAILED: '输入准备失败', VALIDATION_FAILED: '日报内容校验未通过', transport_failure: '推送传输失败', 'messaging/registration-token-not-registered': '手机注册凭据已失效', configuration_missing: '发送配置缺失', SMTP_FAILED: '邮件发送失败' };
Object.assign(reasons,{EMAIL_CONFIG:'邮件发送配置缺失',EMAIL_AUTH_FAILED:'邮件服务拒绝认证',NETWORK_TIMEOUT:'传输连接超时',DNS_LOOKUP_FAILED:'域名解析失败',HEALTH_CHECK_FAILED:'固定健康检查未得到成功响应',SERVICE_NOT_ACTIVE:'登记的服务未处于活动状态',STATIC_ASSET_FAILED:'发布的静态资源验收未通过',DEPENDENCY_DECLARATION_MISSING:'缺少可核验的依赖声明',LINUX_RUNTIME_UNVERIFIED:'Linux 依赖恢复证据不完整',NOTIFICATION_QUEUE_FAILED:'日报已保存，通知入队失败',PUBLICATION_FAILED:'发布阶段发生错误，未记录更细错误码'});
export function querySystem(userId: string, kind: SystemQueryKind, options: SystemQueryOptions = {}) {
  const user = identity(userId), admin = user.role === 'admin';
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SystemQueryError('limit 须为 1–100');
  if (options.id !== undefined && (!options.id || options.id.length > 100 || !/^[\w:-]+$/.test(options.id))) throw new SystemQueryError('对象编号不正确');
  if (options.source !== undefined && !['local','cloud','shadow'].includes(options.source)) throw new SystemQueryError('source 只能为 local、cloud 或 shadow');
  const date = options.date || todayInTimezone(db.getReminder(userId)?.timezone || 'Asia/Shanghai');
  if (!isValidDateKey(date)) throw new SystemQueryError('date 须为有效的 YYYY-MM-DD');
  const observedAt = new Date().toISOString();
  const envelope = { domain: 'runtime', observedAt, service: process.env.DIGEST_SHADOW_ONLY === 'true' ? 'shadow' : 'main' };
  if (kind === 'status') {
    const snapshot = readOperations<any>('status.json', null);
    const age = Date.now() - Date.parse(snapshot?.observedAt);
    const fresh = Number.isFinite(age) && age >= 0 && age <= 420_000;
    let deployed: any = {};
    try { deployed = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.deploy'), 'utf8')); } catch { /* Local checkout is not a deployed release. */ }
    return { ...envelope, version: pkg.version, deployment: { commit: smallCode(deployed.commit || deployed.base_commit), releaseId: smallCode(deployed.release_id || deployed.release), status: deployed.commit || deployed.base_commit ? 'observed' : 'unobserved' }, health: { api: 'responding' },
      hostObservation: { status: fresh ? 'observed' : snapshot ? 'stale' : 'unobserved', observedAt: time(snapshot?.observedAt),
        services: fresh && Array.isArray(snapshot.services) ? snapshot.services.filter((s:any)=>admin || ['main','shadow'].includes(s.service)).slice(0,10).map(workerView) : [] },
      ...(admin ? { retention: snapshot?.retention ? {observedAt:time(snapshot.retention.observedAt),managedLogBytes:Number(snapshot.retention.managedLogBytes)||0,capacityWarning:snapshot.retention.capacityWarning===true,warnings:Array.isArray(snapshot.retention.warnings)?snapshot.retention.warnings.slice(0,30).map((w:any)=>({code:diagnosticCode(w.code)})):[]} : null } : {}) };
  }
  if (kind === 'deployments') {
    const ledger = readOperations<any>('deployments.json', { records: [] });
    const records = Array.isArray(ledger.records) ? ledger.records : [];
    const lastSuccess = new Map<string, number>();
    for (const r of records) if (r.status === 'success') lastSuccess.set(r.service, Math.max(lastSuccess.get(r.service) || 0, Date.parse(r.finishedAt) || 0));
    return { ...envelope, status: records.length ? 'observed' : 'unobserved', records: records.filter((r: any) => r.status !== 'failed' || (Date.parse(r.finishedAt) || 0) > (lastSuccess.get(r.service) || 0))
      .sort((a: any,b: any) => (Date.parse(b.finishedAt || b.startedAt)||0)-(Date.parse(a.finishedAt || a.startedAt)||0)).slice(0,limit)
      .map((r: any) => ({ id: smallCode(r.id), service: smallCode(r.service), status: smallCode(r.status), version: smallCode(r.version), commit: smallCode(r.commit), startedAt: time(r.startedAt), finishedAt: time(r.finishedAt), rollbackReady: r.rollbackReady === true, ...(admin ? { errorCode: diagnosticCode(r.errorCode), failureStage: diagnosticCode(r.failureStage) } : {}) })) };
  }
  if (kind === 'errors') {
    if (!admin) throw new SystemQueryError('仅管理员可查询全站错误', 403);
    const errors = allLogs().filter(e => ['error','warn'].includes(e.level)).slice(-limit).map(e => { const data = e.data as any; const code = diagnosticCode(data?.errorCode || data?.event); return { at: e.timestamp, source: 'application', category: e.category, code, reason: reasons[code] || '此错误没有可公开的详细原因；请用任务编号查询对应结构化记录' }; });
    const snapshot = readOperations<any>('status.json', null);
    for (const e of Array.isArray(snapshot?.errors) ? snapshot.errors.slice(-limit) : []) errors.push({ at: time(e.at) || observedAt, source: smallCode(e.service) || 'worker', category: 'system', code: diagnosticCode(e.code), reason: reasons[e.code] || 'worker 记录了错误；未提供更详细的受控回执' });
    // Closed deployment failures are kept outside the visible history for a bounded diagnostic period.
    const ledger = readOperations<any>('deployments.json', { records: [] });
    for (const r of Array.isArray(ledger.records)?ledger.records:[]) if (r.status === 'failed' && Date.now()-Date.parse(r.finishedAt) >= 0 && Date.now()-Date.parse(r.finishedAt) < 7*86400000 && r.errorCode) errors.push({ at:time(r.finishedAt)!, source:`deployment.${smallCode(r.service) || 'unobserved'}`, category:'system', code:diagnosticCode(r.errorCode), reason: `部署 ${smallCode(r.id) || 'unobserved'} 失败阶段：${smallCode(r.failureStage) || 'unobserved'}；${reasons[r.errorCode] || '已记录错误码，未提供更细受控原因'}` });
    return { ...envelope, errors: errors.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,limit) };
  }
  if (kind === 'tasks') {
    const requests = queryAll<any>('SELECT id,conversation_id,state,error,created_at FROM orbit_requests WHERE user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC LIMIT ?', [userId,options.id||null,options.id||null,limit]);
    const jobs = readOperations<Record<string,unknown>>('jobs.json', {}), snapshot = readOperations<any>('status.json', null);
    const matchingJobs=Object.values(jobs||{}).filter((j:any)=>!options.id||j?.name===options.id).slice(0,30).map(jobView);
    if(options.id&&!requests.length&&!(admin&&matchingJobs.length))throw new SystemQueryError('对象不存在或无权查询',404);
    return { ...envelope, requests: requests.map(r => ({ id:r.id, conversationId:r.conversation_id, state:r.state, createdAt:r.created_at, errorCode:r.error ? 'AI_REQUEST_FAILED' : null })), ...(admin ? { jobs:matchingJobs,jobsObservation:matchingJobs.length?'observed':'unobserved',backgroundJobsEnabled:process.env.BACKGROUND_JOBS_ENABLED==='true', workers:Array.isArray(snapshot?.services)?snapshot.services.slice(0,10).map(workerView):[],workersObservedAt:time(snapshot?.observedAt),workersObservation:Number.isFinite(Date.parse(snapshot?.observedAt))&&Date.now()-Date.parse(snapshot.observedAt)<=420000?'observed':snapshot?'stale':'unobserved' } : {}) };
  }
  if (kind === 'daily-report-status') {
    const runs = options.source === 'local' ? [] : activity.listDigestRuns(userId, date).map(row => { const m = parse(row.manifest_json); const event = stageEvent(m); const validation=allLogs().filter(log=>{const d=log.data as any;return d?.event==='digest_validation_result'&&d.userId===userId&&d.runId===row.id;}).slice(-10).map(log=>{const d=log.data as any;return {...stageEvent({...d,at:log.timestamp}),source:'application_log'};}); return { id: row.id, mode:smallCode(m.mode) || 'unobserved', createdAt:row.created_at, ...event, reason:reasons[m.code] || undefined, events:Array.isArray(m.events) ? m.events.slice(-50).map(stageEvent) : [], validation, snapshotExpired: row.expires_at <= observedAt }; }).filter(r=>!options.source || r.mode==='unobserved' || r.mode===(options.source==='cloud'?'production':'shadow')).slice(0,limit);
    const reports = options.source === 'shadow' ? [] : getDailyReportViewsForDate(userId,date).reports.filter(r => !options.source || r.source === options.source).map(r => ({ id:r.id, source:r.source, deliveryStatus:r.deliveryStatus, publishedAt:r.publishedAt, emailStatus:r.emailStatus }));
    const artifacts = options.source === 'local' ? [] : activity.listDigestArtifacts(userId, options.source === 'shadow' ? 'shadow' : options.source === 'cloud' ? 'production' : undefined, date).slice(0,limit).map(r => ({ id:r.id, runId:r.run_id, mode:r.mode, createdAt:r.created_at, status:smallCode(parse(r.payload_json).status) }));
    const notifications = reports.flatMap(r=>activity.listNotifications(userId,{sourceType:'daily_report',sourceId:r.id,limit})).slice(0,limit).map(notificationView);
    return { ...envelope, date, source:options.source || 'all', status:runs.length || reports.length || artifacts.length ? 'observed' : 'no_record', externalScheduler:'unobserved', modelExecution:'unobserved', runs, artifacts, reports, notifications,
      reason: runs.length || reports.length || artifacts.length ? undefined : '当前账号没有该日期的服务器执行或发布记录；不能由此认定外部调度或模型失败' };
  }
  if (kind === 'reminder-status') {
    const projections=readReminderProjectionSources(userId).filter(p=>!options.id||p.task.id===options.id||p.cycle&&reminderScheduleId(p.cycle.id)===options.id).slice(0,100);
    if (options.id) { const s = getSchedule(options.id); if ((!s || s.user_id !== userId) && !projections.length) throw new SystemQueryError('对象不存在或无权查询',404); }
    const ids=options.id?[...new Set([options.id,...projections.flatMap(p=>[p.task.id,...p.cycle?[reminderScheduleId(p.cycle.id)]:[]])])]:[];
    const reminder = db.getReminder(userId);
    const notifications = (ids.length?ids.flatMap(sourceId=>activity.listNotifications(userId,{sourceId,limit})):activity.listNotifications(userId,{limit:100})).filter(n => n.sourceType !== 'daily_report').slice(0,limit).map(notificationView);
    const push = queryAll<any>(`SELECT id,schedule_id,status,attempts,next_retry_at,error,trigger_at,sent_at FROM android_push_deliveries WHERE user_id=? AND kind<>'test' ${ids.length?`AND schedule_id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY created_at DESC LIMIT ?`, [userId,...ids,limit]).map(r=>({...r,error: r.error ? diagnosticCode(r.error) : null, sentMeaning:'provider_accepted'}));
    const androidEnabled=queryAll<{enabled:number}>('SELECT enabled FROM android_push_preferences WHERE user_id=?',[userId])[0]?.enabled===1;
    const devices=queryAll<{permission:number}>('SELECT permission FROM android_push_devices WHERE user_id=? AND revoked=0',[userId]);
    const schedules = getAllSchedules(userId).filter(s=>!options.id||ids.includes(s.id)).slice(0,limit).map(s=>({id:s.id,title:s.title,startTime:s.start_time,completed:!!s.is_completed,rule:getScheduleReminder(userId,s.id)}));
    const cycles=projections.slice(0,limit).map(p=>({taskId:p.task.id,enabled:p.task.enabled,timezone:p.task.timezone,reminderTime:p.task.config.reminderTime,reminderOffsets:p.task.config.reminderOffsets,current:p.current,cycle:p.cycle?{id:p.cycle.id,status:p.cycle.status,dueDate:p.cycle.dueDate,plannedDate:p.cycle.plannedDate}:null}));
    const cycleDeliveries=readReminderDeliveries(userId,options.id?projections[0]?.task.id || options.id:undefined,limit).map(d=>({...d,last_error:undefined,errorCode:d.last_error?safeFailure(d.last_error):null,sentMeaning:'queue_handoff'}));
    return {...envelope,status:'observed',id:options.id || null, preferences:{ enabled:!!reminder?.enabled,timezone:reminder?.timezone,quietHoursEnabled:!!reminder?.quiet_hours_enabled,quietStart:reminder?.quiet_start,quietEnd:reminder?.quiet_end,emailEnabled:!!reminder?.email_enabled,inAppEnabled:!!reminder?.in_app_enabled,browserEnabled:!!reminder?.browser_enabled }, schedules, notifications, push,
      cycles,cycleDeliveries,android:{enabled:androidEnabled,configured:!!process.env.FIREBASE_SERVICE_ACCOUNT_FILE,scannerEnabled:process.env.ANDROID_PUSH_ENABLED==='true',registeredDevices:devices.length,permittedDevices:devices.filter(d=>d.permission===1).length},phoneDisplay:'unobserved', note:'服务端接受不能证明此次手机展示或邮件收件箱到达；用户已验证的 Android 后台能力不因此失效' };
  }
  throw new SystemQueryError('不支持的查询');
}
function safeFailure(value:string) { if(/邮件服务尚未配置|SMTP_PASS/.test(value))return 'EMAIL_CONFIG';if(/\bEAUTH\b/.test(value))return 'EMAIL_AUTH_FAILED';if(/\bETIMEDOUT\b/.test(value))return 'NETWORK_TIMEOUT';if(/\bENOTFOUND\b/.test(value))return 'DNS_LOOKUP_FAILED';return diagnosticCode(value); }
function notificationView(n: activity.NotificationDelivery) {
  const logged=allLogs().filter(log=>{const d=log.data as any;return d?.userId===n.userId&&d?.notificationId===n.id&&d?.errorCode;}).at(-1)?.data as any;
  const errorCode=n.lastError?logged?.errorCode?diagnosticCode(logged.errorCode):safeFailure(n.lastError):null;
  return {id:n.id,sourceId:n.sourceId,instanceId:n.instanceId,channel:n.channel,status:n.status,attempts:n.attempts,maxAttempts:n.maxAttempts,scheduledAt:n.scheduledAt,nextRetryAt:n.nextRetryAt,sentAt:n.sentAt,errorCode,reason:errorCode?reasons[errorCode]||undefined:undefined,sentMeaning:n.channel==='email'?'smtp_accepted':n.channel==='push'?'provider_accepted':'channel_recorded'};
}
