import crypto from 'node:crypto';
import * as store from './activity-store.js';
import * as db from './db.js';
import { getAllSchedules } from './schedule-store.js';
import { scheduleDateInTimezone } from './schedule-time.js';
import { readUserMail } from './user-mail-service.js';
import { getDailyReportCloudContext } from './daily-report-cloud-store.js';
import { isValidDateKey } from './date-key.js';
import { DIGEST_V2_VERSION, DIGEST_V2_GENERATION, DIGEST_V2_SCHEMA, digestHash, validateDigestV2, type DigestSnapshot, type DigestV2, type InputSection } from './digest-v2-contract.js';
import { prepareDigestMedia } from './digest-v2-media.js';
import { encodeDigestPublication, renderDigestV2, snapshotWarnings, type DigestPublication } from './digest-v2-render.js';
import { enqueueUserEmailNotificationDetailed } from './notification-service.js';
import { getDailyReportDeliveryPolicy } from './daily-report-delivery-policy.js';
import { addLog } from './log-service.js';

export function assertDigestV2Enabled(): void { if (process.env.DIGEST_V2_ENABLED !== 'true') throw new Error('DIGEST_V2_DISABLED'); }
export function createDigestSnapshotRun(userId: string, snapshot: DigestSnapshot) {
  if (!isValidDateKey(snapshot.date)) throw new Error('INVALID_DATE');
  store.expireDigestSnapshots();
  const id = crypto.randomUUID(); const now = new Date();
  const manifest = { date: snapshot.date, timezone: snapshot.timezone, cutoff: snapshot.cutoff, contextVersion: snapshot.contextVersion, contractVersion: DIGEST_V2_VERSION, generationVersion: DIGEST_V2_GENERATION, modelVersion: 'unknown', status: 'INPUTS_SNAPSHOTTED', inputCounts: { calendar: snapshot.calendar.items.length, mail: snapshot.mail.items.length, watchlist: snapshot.watchlist.items.length }, warnings: snapshotWarnings(snapshot) };
  store.createDigestRun({ id, user_id: userId, report_date: snapshot.date, snapshot_json: JSON.stringify(snapshot), manifest_json: JSON.stringify(manifest), created_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * 86400000).toISOString() });
  return { runId: id, snapshot, manifest, schema: DIGEST_V2_SCHEMA };
}
export async function readDigestV2Inputs(userId: string, date: string) {
  assertDigestV2Enabled();
  if (!isValidDateKey(date)) throw new Error('INVALID_DATE');
  const timezone = db.getReminder(userId)?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
  let calendar: InputSection = { status: 'failed', items: [] };
  let mail: InputSection = { status: 'failed', items: [] };
  try {
    const schedules = getAllSchedules(userId).filter(s => !s.is_unscheduled && scheduleDateInTimezone(s.start_time, timezone, s.all_day) === date);
    calendar = { status: schedules.length > 300 ? 'partial' : 'complete', items: schedules.slice(0, 300).map(s => ({ id: String(s.id), title: s.title, detail: [s.start_time, s.end_time, s.location, s.notes].filter(Boolean).join(' · ').slice(0, 4000) })) };
  } catch { /* Failure is explicit and cannot be changed by Work. */ }
  try {
    const result = await readUserMail(userId, 100);
    mail = { status: !result.configured || !result.enabled ? 'not_configured' : result.status === 'OK' ? (result.unreadCount > result.messages.length ? 'partial' : 'complete') : result.status === 'PARTIAL' ? 'partial' : 'failed', items: result.messages.map(m => ({ id: m.id, title: m.subject, detail: JSON.stringify(m).slice(0, 4000) })) };
  } catch { /* Never copy provider error strings or credentials into snapshots. */ }
  const context = getDailyReportCloudContext(userId);
  const watch = (context.context.watchlist as { stocks?: Array<{ name?: string; symbol?: string }> })?.stocks || [];
  const snapshot: DigestSnapshot = { date, timezone, cutoff: new Date().toISOString(), contextVersion: context.version, calendar, mail, watchlist: { status: watch.length > 100 ? 'partial' : 'complete', items: watch.slice(0, 100).map((w, i) => ({ id: `watch-${i}-${digestHash(w).slice(0, 12)}`, title: [w.name, w.symbol].filter(Boolean).join(' '), detail: '' })) } };
  return { ...createDigestSnapshotRun(userId, snapshot), context: context.context };
}
function snapshotFor(userId: string, runId: string): DigestSnapshot {
  const row = store.getDigestRun(userId, runId);
  if (!row) throw new Error('RUN_NOT_FOUND');
  if (!row.snapshot_json) throw new Error('SNAPSHOT_EXPIRED');
  return JSON.parse(row.snapshot_json);
}
export function validateDigestRun(userId: string, runId: string, digest: unknown) {
  assertDigestV2Enabled();
  return validateDigestV2(digest, snapshotFor(userId, runId));
}
// A single app process owns sql.js. Serialize by account/date across await boundaries.
const locks = new Map<string, Promise<unknown>>();
export async function publishDigestV2(userId: string, runId: string, value: unknown, mode: string, mediaOptions: Partial<Parameters<typeof prepareDigestMedia>[1]> = {}): Promise<Record<string, unknown>> {
  assertDigestV2Enabled();
  if (!['dry_run', 'shadow', 'production'].includes(mode)) throw new Error('INVALID_MODE');
  if (process.env.DIGEST_SHADOW_ONLY === 'true' && mode === 'production') throw new Error('SHADOW_ONLY');
  const validation = validateDigestRun(userId, runId, value);
  if (!validation.valid) return { status: 'INVALID', ...validation };
  if (mode === 'dry_run') return { status: 'VALIDATED_NOT_PUBLISHED', ...validation };
  if (mode === 'production' && process.env.DIGEST_PRODUCTION_CONTRACT !== 'daily-digest.v2') throw new Error('V2_PRODUCTION_DISABLED');
  if (mode === 'production' && process.env.DIGEST_R2_ENV === 'test') throw new Error('TEST_R2_CANNOT_PUBLISH');
  const digest = value as DigestV2;
  const key = `${userId}:${digest.date}`;
  const task = (locks.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const snapshot = snapshotFor(userId, runId);
    const started = Date.now();
    let phase = 'MEDIA_PREPARING';
    const recordPhase = (status: string, diagnostics: Record<string, unknown> = {}) => {
      const row = store.getDigestRun(userId, runId)!;
      const manifest = JSON.parse(row.manifest_json);
      const event = { status, mode, at: new Date().toISOString(), elapsedMs: Date.now() - started, contentHash: validation.contentHash, ...diagnostics };
      store.updateDigestRunManifest(userId, runId, { ...manifest, ...event, events: [...(manifest.events || []), event].slice(-50) });
      phase = status;
    };
    try {
      recordPhase(phase);
      let existing = store.findDigestArtifact(userId, digest.date, mode, validation.contentHash!);
      let payload: { publication: DigestPublication; reportId?: string; status: string; renderHash: string; emailStatus?: string };
      if (existing) payload = JSON.parse(existing.payload_json);
      else {
        const media = await prepareDigestMedia(digest, { ...mediaOptions, mode: mode as 'shadow' | 'production' });
        const publication = { digest, warnings: validation.warnings, media, renderer: DIGEST_V2_GENERATION };
        payload = { publication, status: 'PREPARED', renderHash: digestHash(publication) };
        existing = store.saveDigestArtifact({ id: crypto.randomUUID(), user_id: userId, run_id: runId, report_date: digest.date, mode: mode as 'shadow' | 'production', content_hash: validation.contentHash!, payload_json: JSON.stringify(payload), created_at: new Date().toISOString() });
      }
      recordPhase('MEDIA_PREPARED', { artifactId: existing.id, mediaFailures: payload.publication.media.filter(m => m.failure).map(m => ({ id: m.id, code: m.failure })) });
      // Re-check the switch after network work, before committing any formal side effect.
      assertDigestV2Enabled();
      if (mode === 'production') {
        if (process.env.DIGEST_PRODUCTION_CONTRACT !== 'daily-digest.v2') throw new Error('V2_PRODUCTION_DISABLED');
        const markdown = encodeDigestPublication(payload.publication);
        const received = getDailyReportDeliveryPolicy(userId).sources.includes('cloud');
        let report = store.getDailyReportCandidate(userId, digest.date, 'cloud', validation.contentHash!);
        if (!report) report = store.createDailyReport({ userId, reportDate: digest.date, source: 'cloud', deliveryStatus: received ? 'received' : 'candidate', markdown, contentHash: validation.contentHash! });
        else if (received && report.deliveryStatus === 'candidate') report = store.promoteDailyReportCandidate(report.id, userId) || report;
        payload.reportId = report.id;
        recordPhase('REPORT_SAVED', { reportId: report.id });
        // Reserve one automatic daily delivery for both contracts; revisions need explicit resend.
        const previousSent = store.dailyReportHasAutomaticDelivery(userId, digest.date, report.id);
        if (received && !previousSent && db.getReminder(userId)?.report_email_enabled === 1) {
          const queued = enqueueUserEmailNotificationDetailed({ userId, sourceType: 'daily_report', sourceId: report.id, kind: 'daily_report', title: `个人情报日报 · ${digest.date}`, body: report.markdown, dedupeKey: `daily-report-v2:${userId}:${digest.date}:email`, maxAttempts: 1 });
          store.attachDailyReportNotification(report.id, userId, queued.notification.id);
          payload.emailStatus = queued.notification.status === 'sent' ? 'SMTP_ACCEPTED' : queued.notification.status === 'failed' ? 'FAILED' : 'QUEUED';
        } else payload.emailStatus = previousSent ? 'REVISION_NOT_AUTO_SENT' : 'DISABLED';
        payload.status = 'PUBLISHED';
      } else payload.status = 'SHADOW_SAVED';
      store.saveDigestArtifact({ ...existing, payload_json: JSON.stringify(payload) });
      recordPhase(payload.status, { emailStatus: payload.emailStatus || 'NOT_QUEUED', renderHash: payload.renderHash });
      addLog('info', 'daily-report', '新版日报运行完成', { event: 'digest_v2_completed', runId, mode, status: payload.status, imageCount: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && !m.fallback).length });
      return { status: payload.status, artifactId: existing.id, contentHash: validation.contentHash, renderHash: payload.renderHash, warnings: snapshotWarnings(snapshot), emailStatus: payload.emailStatus || 'NOT_QUEUED', previewUrl: mode === 'shadow' ? `/reports/${digest.date}?shadow=${existing.id}` : `/reports/${digest.date}?source=cloud`, media: { icons: payload.publication.media.filter(m => m.kind === 'source_icon' && m.publicUrl && !m.fallback).length, real: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && !m.fallback).length, fallback: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && m.fallback).length, failures: payload.publication.media.filter(m => m.failure).map(m => ({ id: m.id, code: m.failure })) } };
    } catch (error) {
      // Keep only bounded, non-sensitive stage diagnostics, never provider error messages.
      try { recordPhase('FAILED', { failedPhase: phase, retryable: true }); } catch { /* Original durable-write failure remains primary. */ }
      throw error;
    }
  });
  locks.set(key, task);
  try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
export function digestArtifactView(row: store.DigestArtifactRow) {
  const payload = JSON.parse(row.payload_json); const p = payload.publication as DigestPublication;
  return { id: row.id, date: row.report_date, headline: p.digest.title, heroImageUrl: null, excerpt: p.digest.executive_signals.join('；'), contentHash: row.content_hash, publishedAt: row.created_at, updatedAt: row.created_at, source: 'cloud', deliveryStatus: 'CANDIDATE', emailStatus: 'DISABLED', emailNotificationId: null, markdown: encodeDigestPublication(p), html: renderDigestV2(p), shadow: true };
}
