import crypto from 'node:crypto';
import * as store from './activity-store.js';
import * as db from './db.js';
import { getAllSchedules } from './schedule-store.js';
import { scheduleDateInTimezone } from './schedule-time.js';
import { readUserMail } from './user-mail-service.js';
import { getDailyReportCloudContext } from './daily-report-cloud-store.js';
import { isValidDateKey } from './date-key.js';
import { DIGEST_V2_VERSION, DIGEST_V2_GENERATION, DIGEST_V2_ILLUSTRATED_GENERATIONS, DIGEST_V2_SCHEMA, digestHash, digestSnapshotWarnings, validateDigestV2, type DigestSnapshot, type DigestV2, type InputSection } from './digest-v2-contract.js';
import { prepareDigestMedia, configuredMediaRules } from './digest-v2-media.js';
import { dailyReportMediaRoot, getDailyReportMediaPublicOrigin, storeProvidedDailyReportMedia } from './daily-report-media-service.js';
import { publicDigestUrl } from './digest-v2-contract.js';
import { NEWS_VISUAL_PLAN_SCHEMA, validateNewsVisualPlans, renderNewsVisual, storyVisualHash, visualRules, digestBytesHash, type PreparedNewsVisual } from './digest-v2-visuals.js';
import { digestV2Cover, encodeDigestPublication, renderDigestV2, type DigestPublication } from './digest-v2-render.js';
import { enqueueUserEmailNotificationDetailed } from './notification-service.js';
import { getDailyReportDeliveryPolicy } from './daily-report-delivery-policy.js';
import { addLog } from './log-service.js';
import { collectAiHot, collectNewsletters, deduplicateCandidates, digestSourcesEnabled, normalizeNewsletterInputs, DIGEST_SOURCE_GUIDANCE, NEWSLETTER_INPUT_SCHEMA, type DigestSourcesSnapshot } from './digest-v2-sources.js';
import { digestPhotosEnabled, findDigestPhotos, PHOTO_REQUEST_SCHEMA } from './digest-v2-photos.js';

export function assertDigestV2Enabled(): void { if (process.env.DIGEST_V2_ENABLED !== 'true') throw new Error('DIGEST_V2_DISABLED'); }
export function createDigestSnapshotRun(userId: string, snapshot: DigestSnapshot) {
  if (!isValidDateKey(snapshot.date)) throw new Error('INVALID_DATE');
  store.expireDigestSnapshots();
  const id = crypto.randomUUID(); const now = new Date();
  const manifest = { date: snapshot.date, timezone: snapshot.timezone, cutoff: snapshot.cutoff, contextVersion: snapshot.contextVersion, contractVersion: DIGEST_V2_VERSION, generationVersion: DIGEST_V2_GENERATION, modelVersion: 'unknown', status: 'INPUTS_SNAPSHOTTED', inputCounts: { calendar: snapshot.calendar.items.length, mail: snapshot.mail.items.length, watchlist: snapshot.watchlist.items.length }, warnings: digestSnapshotWarnings(snapshot) };
  Object.assign(manifest, { visualPreparation: { tool: 'daily_report.prepare_visuals_v2', schema: NEWS_VISUAL_PLAN_SCHEMA, guidance: '照片仍需已有许可；无已审核贴题图时，可提交仅使用本条标题/摘要连续原文短语的新闻信息图方案。返回的 digest 已绑定本站持久媒体；使用它重新校验。信息图明确标为原创、非现场。更改新闻或来源后须重新准备，不复用旧图。' } });
  if (digestSourcesEnabled(userId)) Object.assign(manifest, { sourcePreparation: { tool: 'daily_report.prepare_sources_v2', schema: NEWSLETTER_INPUT_SCHEMA, guidance: DIGEST_SOURCE_GUIDANCE } });
  if (digestPhotosEnabled(userId)) Object.assign(manifest, { photoPreparation: { tool: 'daily_report.find_photos_v2', schema: PHOTO_REQUEST_SCHEMA, guidance: '为每条新闻用具体人物、地点、设施或产品名称找资料照。候选来自 Commons 的文件级开放许可核对，服务端经代理自动下载并托管。把选中图片 pageUrl 加入 evidence，media.url 使用 imageUrl。只有 Shadow 支持此能力；日期未知不猜，不把资料照称为现场。本次 Shadow 逐条配图完整性为硬闸门，不能用类别占位图掩盖失败。' } });
  store.createDigestRun({ id, user_id: userId, report_date: snapshot.date, snapshot_json: JSON.stringify(snapshot), manifest_json: JSON.stringify(manifest), created_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * 86400000).toISOString() });
  return { runId: id, snapshot, manifest, schema: DIGEST_V2_SCHEMA, editorialGuidance: '仅在正文中用 **原文短词组** 标重点；每句一到两处，优先关键对象、数字、结论或行动。标题不加标记，不能整句加粗。邮件逐封保留服务或事项名称、具体动作和已知期限；同一事项突出各封新增事实，未知期限不猜。关注正文面向读者：标的名称、窗口时间：月日至月日、每条以 • 起一行的一句客观事实；参考内容：后按evidence_ids顺序写等量原文标题，可保留已确认的日期，链接由渲染器生成。检索/重试/PDF报错留在执行记录，不放正文。check/change如实保留，未配置、读取失败、未研究不可写成无变化。新闻说明具体事实、关注关系与下一步；候选、排除及失败另留有界记录。图片须贴合具体新闻，不能把类别图形当贴题插画。图片是否为现场只在图注说明，正文不重复。来源和发布时间由服务端生成角标与文末引用，不要写入摘要。' };
}
export function digestWatchlistInput(context: ReturnType<typeof getDailyReportCloudContext>): InputSection {
  if (context.readFailed) return { status: 'failed', items: [] };
  const raw = context.context.watchlist;
  if (raw === undefined || raw === null) return { status: 'not_configured', items: [] };
  const stocks = Array.isArray(raw) ? raw : typeof raw === 'object' && !Array.isArray(raw) ? (raw as { stocks?: unknown }).stocks : undefined;
  if (!Array.isArray(stocks)) return { status: 'failed', items: [] };
  if (!stocks.length) return { status: 'not_configured', items: [] };
  let incomplete = false;
  const items = stocks.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const stock = value as Record<string, unknown>;
    const name = typeof stock.name === 'string' ? stock.name.trim() : '';
    const symbol = typeof stock.symbol === 'string' ? stock.symbol.trim() : '';
    if (!name && !symbol) return [];
    const thesisFile = typeof stock.thesis_file === 'string' ? /^theses\/([A-Za-z0-9_-]+)\.ya?ml$/.exec(stock.thesis_file) : null;
    const theses = context.context.theses;
    const referencedThesis = thesisFile && theses && typeof theses === 'object' && !Array.isArray(theses)
      ? (theses as Record<string, unknown>)[thesisFile[1]] : null;
    const matchedThesis = referencedThesis && typeof referencedThesis === 'object' && !Array.isArray(referencedThesis)
      && typeof (referencedThesis as Record<string, unknown>).symbol === 'string'
      && ((referencedThesis as Record<string, unknown>).symbol as string).toLowerCase() === symbol.toLowerCase()
      ? referencedThesis as Record<string, unknown> : null;
    const thesis = stock.thesis && typeof stock.thesis === 'object' && !Array.isArray(stock.thesis)
      ? stock.thesis as Record<string, unknown> : matchedThesis;
    const complete = !!name && !!symbol && typeof stock.priority === 'string' && !!stock.priority.trim()
      && Array.isArray(stock.sectors) && stock.sectors.every(sector => typeof sector === 'string' && !!sector.trim())
      && thesis && typeof thesis.status === 'string' && !!thesis.status.trim()
      && typeof thesis.priority === 'string' && !!thesis.priority.trim()
      && thesis.thesis && typeof thesis.thesis === 'object' && !Array.isArray(thesis.thesis)
      && thesis.monitor && typeof thesis.monitor === 'object' && !Array.isArray(thesis.monitor);
    const detail = complete ? JSON.stringify({ priority: stock.priority, sectors: stock.sectors,
      thesis: { status: thesis!.status, priority: thesis!.priority, thesis: thesis!.thesis, monitor: thesis!.monitor } }) : '';
    if (!detail || detail.length > 4000) incomplete = true;
    return [{ id: `watch-${index}-${digestHash(value).slice(0, 12)}`, title: [name, symbol].filter(Boolean).join(' '), detail: detail.length <= 4000 ? detail : '' }];
  });
  return { status: !items.length ? 'failed' : incomplete || items.length !== stocks.length || stocks.length > 100 ? 'partial' : 'complete', items: items.slice(0, 100) };
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
  const snapshot: DigestSnapshot = { date, timezone, cutoff: new Date().toISOString(), contextVersion: context.version, calendar, mail, watchlist: digestWatchlistInput(context) };
  return { ...createDigestSnapshotRun(userId, snapshot), context: context.context };
}
function snapshotFor(userId: string, runId: string): { snapshot: DigestSnapshot; generationVersion: string } {
  const row = store.getDigestRun(userId, runId);
  if (!row) throw new Error('RUN_NOT_FOUND');
  if (!row.snapshot_json || Date.parse(row.expires_at) <= Date.now()) throw new Error('SNAPSHOT_EXPIRED');
  const manifest = JSON.parse(row.manifest_json);
  return { snapshot: JSON.parse(row.snapshot_json), generationVersion: manifest.generationVersion || '2026-09-21.1' };
}
const sourceLocks = new Map<string, Promise<unknown>>();
export async function findDigestRunPhotos(userId: string, runId: string, requests: unknown, fetcher?: typeof fetch) {
  assertDigestV2Enabled();
  if (!digestPhotosEnabled(userId)) throw new Error('DIGEST_PHOTOS_DISABLED');
  snapshotFor(userId, runId);
  const result = await findDigestPhotos(requests, fetcher);
  assertDigestV2Enabled();
  if (!digestPhotosEnabled(userId)) throw new Error('DIGEST_PHOTOS_DISABLED');
  snapshotFor(userId, runId);
  return { runId, ...result, emailStatus: 'NOT_QUEUED' };
}
export async function prepareDigestSources(userId: string, runId: string, newsletters: unknown, collector = collectAiHot): Promise<Record<string, unknown>> {
  assertDigestV2Enabled();
  if (!digestSourcesEnabled(userId)) throw new Error('DIGEST_SOURCES_DISABLED');
  const inputs = normalizeNewsletterInputs(newsletters); const inputHash = digestHash(inputs);
  const key = `${userId}:${runId}`;
  const task = (sourceLocks.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const initial = snapshotFor(userId, runId);
    if (initial.generationVersion !== DIGEST_V2_GENERATION) throw new Error('SOURCE_GENERATION_UNSUPPORTED');
    const response = (sources: DigestSourcesSnapshot) => ({ status: 'SOURCES_PREPARED', runId, sources, guidance: DIGEST_SOURCE_GUIDANCE,
      fallbackToWebSearch: sources.statuses.some(item => item.status !== 'complete' || item.freshness !== 'current'), emailStatus: 'NOT_QUEUED' });
    if (initial.snapshot.sources) {
      if (initial.snapshot.sources.inputHash !== inputHash) throw new Error('SOURCE_INPUT_FROZEN_NEW_RUN_REQUIRED');
      return response(initial.snapshot.sources);
    }
    const assertSourceStageOpen = () => {
      const manifest = JSON.parse(store.getDigestRun(userId, runId)!.manifest_json);
      if (manifest.status !== 'INPUTS_SNAPSHOTTED' || manifest.preparedVisuals?.length) throw new Error('SOURCE_STAGE_CLOSED_NEW_RUN_REQUIRED');
    };
    assertSourceStageOpen();
    const aiHot = await collector(initial.snapshot.cutoff);
    const mail = collectNewsletters(inputs, initial.snapshot.cutoff);
    const sources: DigestSourcesSnapshot = { version: 'digest-sources.v1', inputHash, preparedAt: new Date().toISOString(),
      statuses: [aiHot.status, ...mail.statuses], candidates: deduplicateCandidates([...aiHot.candidates, ...mail.candidates]) };
    // Network work can outlive expiry or race visual preparation; re-read and CAS only the snapshot.
    assertDigestV2Enabled(); if (!digestSourcesEnabled(userId)) throw new Error('DIGEST_SOURCES_DISABLED');
    const row = store.getDigestRun(userId, runId); snapshotFor(userId, runId);
    if (!row?.snapshot_json) throw new Error('SNAPSHOT_EXPIRED');
    assertSourceStageOpen();
    const latest: DigestSnapshot = JSON.parse(row.snapshot_json);
    if (latest.sources || !store.updateDigestRunSnapshot(userId, runId, row.snapshot_json, { ...latest, sources })) throw new Error('SOURCE_SNAPSHOT_CONFLICT');
    store.updateDigestRunManifest(userId, runId, { ...JSON.parse(store.getDigestRun(userId, runId)!.manifest_json), sourceCounts: sources.statuses.map(item => ({ source: item.source, status: item.status, freshness: item.freshness, count: item.candidateCount, reasonCodes: item.reasonCodes })) });
    return response(sources);
  });
  sourceLocks.set(key, task); try { return await task; } finally { if (sourceLocks.get(key) === task) sourceLocks.delete(key); }
}
export function validateDigestRun(userId: string, runId: string, digest: unknown) {
  assertDigestV2Enabled();
  const { snapshot, generationVersion } = snapshotFor(userId, runId);
  const validation = validateDigestV2(digest, snapshot, generationVersion);
  if (validation.valid) {
    try { visualRules(digest as DigestV2, preparedVisuals(userId, runId)); }
    catch (error) {
      validation.valid = false; validation.contentHash = null;
      validation.errors.push({ path: '$.media', code: error instanceof Error && error.message.startsWith('VISUAL_') ? error.message : 'VISUAL_FILE_INVALID' });
    }
  }
  return validation;
}
function preparedVisuals(userId: string, runId: string): PreparedNewsVisual[] {
  const manifest = JSON.parse(store.getDigestRun(userId, runId)!.manifest_json);
  return Array.isArray(manifest.preparedVisuals) ? manifest.preparedVisuals : [];
}
const visualLocks = new Map<string, Promise<unknown>>();
export async function prepareDigestVisuals(userId: string, runId: string, value: unknown, rawPlans: unknown): Promise<Record<string, unknown>> {
  assertDigestV2Enabled();
  const key = `${userId}:${runId}`;
  const task = (visualLocks.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const { snapshot, generationVersion } = snapshotFor(userId, runId);
    const validation = validateDigestV2(value, snapshot, generationVersion);
    if (!validation.valid) return { status: 'INVALID', ...validation };
    const digest = structuredClone(value) as DigestV2;
    const plans = validateNewsVisualPlans(digest, rawPlans);
    const origin = getDailyReportMediaPublicOrigin();
    if (process.env.DIGEST_V2_MEDIA_STORE !== 'local' || !publicDigestUrl(origin)) throw new Error('VISUAL_LOCAL_STORE_REQUIRED');
    const entries = preparedVisuals(userId, runId);
    for (const plan of plans) {
      const story = [...digest.market, ...digest.macro, ...digest.stories].find(s => s.id === plan.story_id)!;
      const evidence = digest.evidence.find(e => e.id === plan.evidence_id)!;
      const planHash = digestHash({ version: 'fact-graphic-v1', plan, storyHash: storyVisualHash(story), evidence });
      let entry = entries.find(v => v.storyId === story.id && v.planHash === planHash);
      if (entry) {
        // Missing files can be recreated; an existing corrupt hashed file still fails closed.
        const checkDigest = structuredClone(digest);
        checkDigest.media = [{ id: entry.id, evidence_id: entry.evidenceId, url: entry.url, category: plan.category }];
        for (const s of [...checkDigest.market, ...checkDigest.macro, ...checkDigest.stories]) s.media_ids = s.id === story.id ? [entry.id] : [];
        try { visualRules(checkDigest, [entry]); } catch { entry = undefined; }
      }
      if (!entry) {
        const bytes = await renderNewsVisual(story, plan);
        const sha256 = digestBytesHash(bytes); const filename = `${sha256}.png`;
        storeProvidedDailyReportMedia(filename, bytes, 'image/png', dailyReportMediaRoot());
        entry = { id: `visual:${digestHash({ runId, storyId: story.id, sha256 })}`, storyId: story.id,
          storyHash: storyVisualHash(story), evidenceId: evidence.id, evidenceHash: digestHash(evidence), evidenceUrl: evidence.url,
          planHash, filename, sha256, url: `${origin}/daily-report-media/${filename}` };
        const old = entries.findIndex(v => v.storyId === story.id);
        if (old >= 0) entries[old] = entry; else entries.push(entry);
      }
      story.media_ids = [entry.id];
      digest.media = digest.media.filter(m => [...digest.market, ...digest.macro, ...digest.stories].some(s => s.media_ids.includes(m.id)));
      if (!digest.media.some(m => m.id === entry!.id)) digest.media.push({ id: entry.id, evidence_id: evidence.id, url: entry.url, category: plan.category });
    }
    if (entries.length > 20) throw new Error('VISUAL_PLAN_LIMIT');
    const resultValidation = validateDigestV2(digest, snapshot, generationVersion);
    if (!resultValidation.valid) return { status: 'INVALID', ...resultValidation };
    snapshotFor(userId, runId); // Expiration can occur while rendering; do not authorize an expired run.
    const row = store.getDigestRun(userId, runId)!;
    store.updateDigestRunManifest(userId, runId, { ...JSON.parse(row.manifest_json), preparedVisuals: entries });
    visualRules(digest, entries);
    addLog('info', 'daily-report', '新版日报新闻信息图已准备', { event: 'digest_v2_visuals_prepared', runId, imageCount: plans.length });
    return { status: 'VISUALS_PREPARED', runId, digest, visuals: entries.filter(v => plans.some(p => p.story_id === v.storyId)).map(v => ({ storyId: v.storyId, mediaId: v.id, url: v.url, sha256: v.sha256, visualKind: 'illustration' })), emailStatus: 'NOT_QUEUED' };
  });
  visualLocks.set(key, task);
  try { return await task; } finally { if (visualLocks.get(key) === task) visualLocks.delete(key); }
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
    const { generationVersion } = snapshotFor(userId, runId);
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
        const ownedRules = visualRules(digest, preparedVisuals(userId, runId));
        const rules = ownedRules.length ? [...(mediaOptions.rules || configuredMediaRules()), ...ownedRules] : mediaOptions.rules;
        const media = await prepareDigestMedia(digest, { ...mediaOptions, rules, mode: mode as 'shadow' | 'production', storyIllustrations: DIGEST_V2_ILLUSTRATED_GENERATIONS.includes(generationVersion), allowCommons: mode === 'shadow' && digestPhotosEnabled(userId) });
        const publication = { digest, warnings: validation.warnings, media, renderer: generationVersion };
        if (mode === 'production' || digestPhotosEnabled(userId)) assertStoryImagesReady(publication);
        payload = { publication, status: 'PREPARED', renderHash: digestHash(publication) };
        existing = store.saveDigestArtifact({ id: crypto.randomUUID(), user_id: userId, run_id: runId, report_date: digest.date, mode: mode as 'shadow' | 'production', content_hash: validation.contentHash!, payload_json: JSON.stringify(payload), created_at: new Date().toISOString() });
      }
      if (mode === 'production' || digestPhotosEnabled(userId)) assertStoryImagesReady(payload.publication);
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
      const mediaById = new Map(payload.publication.media.map(m => [m.id, m]));
      const newsItems = [...digest.market, ...digest.macro, ...digest.stories];
      const coverage = { total: newsItems.length, real: 0, archival: 0, illustration: 0, placeholder: 0, missing: 0 };
      for (const story of newsItems) {
        const images = [...story.media_ids.map(id => mediaById.get(id)), ...payload.publication.media.filter(m => m.storyId === story.id)].filter(m => m && m.kind !== 'source_icon' && m.publicUrl);
        if (images.some(m => m!.visualKind === 'photo')) coverage.real++;
        else if (images.some(m => m!.visualKind === 'archive_photo' || (!m!.fallback && !m!.visualKind))) coverage.archival++;
        else if (images.some(m => m!.visualKind === 'illustration')) coverage.illustration++;
        else if (images.length) coverage.placeholder++;
        else coverage.missing++;
      }
      addLog('info', 'daily-report', '新版日报运行完成', { event: 'digest_v2_completed', runId, mode, status: payload.status, imageCount: coverage.real + coverage.archival + coverage.illustration, missingImageCount: coverage.missing });
      return {
        status: payload.status, artifactId: existing.id, contentHash: validation.contentHash, renderHash: payload.renderHash,
        warnings: validation.warnings, reviewIssues: validation.reviewIssues,
        emailStatus: payload.emailStatus || 'NOT_QUEUED',
        previewUrl: mode === 'shadow' ? `/reports/${digest.date}?shadow=${existing.id}` : `/reports/${digest.date}?source=cloud`,
        imageCoverage: coverage,
        media: {
          icons: payload.publication.media.filter(m => m.kind === 'source_icon' && m.publicUrl && !m.fallback).length,
          real: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && m.visualKind === 'photo').length,
          archival: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && (m.visualKind === 'archive_photo' || (!m.fallback && !m.visualKind))).length,
          illustration: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && m.visualKind === 'illustration').length,
          placeholder: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && m.visualKind === 'placeholder').length,
          fallback: payload.publication.media.filter(m => m.kind !== 'source_icon' && m.publicUrl && m.fallback).length,
          failures: payload.publication.media.filter(m => m.failure).map(m => ({ id: m.id, code: m.failure })),
        },
      };
    } catch (error) {
      // Keep only bounded, non-sensitive stage diagnostics, never provider error messages.
      try { recordPhase('FAILED', { failedPhase: phase, retryable: true }); } catch { /* Original durable-write failure remains primary. */ }
      throw error;
    }
  });
  locks.set(key, task);
  try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
function assertStoryImagesReady(publication: DigestPublication): void {
  const media = publication.media;
  for (const story of [...publication.digest.market, ...publication.digest.macro, ...publication.digest.stories]) {
    if (![...story.media_ids.map(id => media.find(item => item.id === id)), ...media.filter(item => item.storyId === story.id)]
      .some(item => item && item.kind !== 'source_icon' && item.publicUrl && !item.failure && !item.fallback
        && ['photo', 'archive_photo', 'illustration'].includes(item.visualKind || 'archive_photo'))) throw new Error('STORY_IMAGE_NOT_READY');
  }
}
export function readDigestShadowArtifact(userId: string, artifactId: string) {
  assertDigestV2Enabled();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(artifactId)) throw new Error('INVALID_ARTIFACT_ID');
  const row = store.getDigestArtifact(userId, artifactId);
  if (!row || row.mode !== 'shadow') throw new Error('SHADOW_ARTIFACT_NOT_FOUND');
  const payload = JSON.parse(row.payload_json);
  const publication = payload.publication as DigestPublication;
  return { readOnly: true, artifactId: row.id, runId: row.run_id, date: row.report_date, contentHash: row.content_hash, generationVersion: publication.renderer, digest: publication.digest };
}
export function digestArtifactView(row: store.DigestArtifactRow) {
  const payload = JSON.parse(row.payload_json); const p = payload.publication as DigestPublication;
  return { id: row.id, date: row.report_date, ...digestV2Cover(p), contentHash: row.content_hash, publishedAt: row.created_at, updatedAt: row.created_at, source: 'cloud', deliveryStatus: 'CANDIDATE', emailStatus: 'DISABLED', emailNotificationId: null, markdown: encodeDigestPublication(p), html: renderDigestV2(p), shadow: true };
}
