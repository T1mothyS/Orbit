import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import { validateDigestV2, digestHash, type DigestV2, type DigestSnapshot } from './digest-v2-contract.js';
import type { ObjectStorage } from './digest-v2-media.js';
import { renderDigestV2, encodeDigestPublication, decodeDigestPublication } from './digest-v2-render.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v2-'));
process.env.DATA_DIR = root;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.DIGEST_V2_ENABLED = 'true';
const { prepareDigestMedia, transformDigestImage, restoreDigestObjects } = await import('./digest-v2-media.js');
const api = await import('./index.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
const service = await import('./digest-v2-service.js');
const backup = await import('./backup-service.js');
const policy = await import('./daily-report-delivery-policy.js');
await api.initializeServer();
const userId = 'digest-user';
const now = new Date().toISOString();
db.createUser({ id: userId, email: 'digest@example.com', password_hash: 'test', role: 'user', disabled: 0, created_at: now, updated_at: now });
db.upsertReminder({ id: 'digest-reminder', user_id: userId, enabled: 0, hour: 8, minute: 0, report_email_enabled: 1, created_at: now, updated_at: now });
function digest(): DigestV2 { return { schema_version: 'daily-digest.v2', date: '2026-09-21', title: '本期重点与后续关注', executive_signals: [], calendar: [{ input_id: 'cal-1', text: '预约与准备资料' }], mail: [], market: [], macro: [], stories: [], watchlist: [], what_matters_next: [], evidence: [], media: [] }; }
function snapshot(): DigestSnapshot { return { date: '2026-09-21', timezone: 'Asia/Shanghai', cutoff: now, contextVersion: 1, calendar: { status: 'complete', items: [{ id: 'cal-1', title: '预约', detail: '' }] }, mail: { status: 'failed', items: [] }, watchlist: { status: 'complete', items: [] } }; }
function illustrated(): DigestV2 {
  const d = digest(); d.evidence = [{ id: 'e1', url: 'https://example.com/story', source: 'Example source', published_at: now }];
  d.media = [{ id: 'm1', evidence_id: 'e1', url: 'https://images.example.com/image.jpg', category: 'AI' }];
  d.stories = [{ id: 's1', title: '有来源的新闻', summary: '一项可核验的新变化', evidence_ids: ['e1'], media_ids: ['m1'], verification: 'verified' }];
  return d;
}
const objects = new Map<string, Buffer>(); let uploads = 0;
const storage: ObjectStorage = { origin: 'https://images.example.com', async put(key, bytes) { if (!objects.has(key)) { objects.set(key, Buffer.from(bytes)); uploads++; } }, async get(key) { return objects.get(key)!; }, async remove(key) { objects.delete(key); } };

test('v2 contract: zero news, partial personal inputs, stable hash, IDs and validation diagnostics', () => {
  assert.deepEqual(validateDigestV2(digest(), snapshot()).warnings, ['MAIL_INCOMPLETE']);
  assert.equal(validateDigestV2(digest(), snapshot()).valid, true);
  const omitted = digest(); omitted.calendar = [];
  assert.equal(validateDigestV2(omitted, snapshot()).errors[0].code, 'INPUT_OMITTED');
  const wrong = digest(); wrong.calendar[0].input_id = 'other';
  assert.ok(validateDigestV2(wrong, snapshot()).errors.some(e => e.code === 'UNKNOWN_INPUT'));
  assert.equal(digestHash({ b: 2, a: 1 }), digestHash({ a: 1, b: 2 }));
  for (const mutate of [
    (d: any) => { delete d.date; }, (d: any) => { d.mail = 'wrong'; }, (d: any) => { d.title = 'a'.repeat(201); },
    (d: any) => { d.executive_signals = Array(6).fill('x'); }, (d: any) => { d.schema_version = 'other'; },
    (d: any) => { d.evidence.push(d.evidence[0]); }, (d: any) => { d.media[0].url = 'https://127.0.0.1/x'; },
    (d: any) => { d.stories[0].media_ids = ['missing']; }, (d: any) => { d.stories[0].evidence_ids = ['missing']; },
    (d: any) => { d.watchlist = [{ input_id: 'w', summary: '没有变化', check: 'incomplete', change: 'nothing_material', evidence_ids: [] }]; },
  ]) { const d = illustrated(); mutate(d); assert.equal(validateDigestV2(d).valid, false); }
});

test('validate and dry_run are pure; foreign account and expired run are rejected', async () => {
  const run = service.createDigestSnapshotRun(userId, snapshot());
  const before = activity.exportActivityDb(); const files = fs.readdirSync(root);
  assert.equal(service.validateDigestRun(userId, run.runId, digest()).valid, true);
  assert.equal((await service.publishDigestV2(userId, run.runId, digest(), 'dry_run')).status, 'VALIDATED_NOT_PUBLISHED');
  assert.deepEqual(activity.exportActivityDb(), before); assert.deepEqual(fs.readdirSync(root), files);
  assert.throws(() => service.validateDigestRun('other', run.runId, digest()), /RUN_NOT_FOUND/);
  activity.createDigestRun({ id: 'expired', user_id: userId, report_date: snapshot().date, snapshot_json: JSON.stringify(snapshot()), manifest_json: '{}', created_at: '2020-01-01', expires_at: '2020-01-02' });
  assert.throws(() => service.validateDigestRun(userId, 'expired', digest()), /SNAPSHOT_EXPIRED/);
  activity.expireDigestSnapshots();
  assert.equal(activity.getDigestRun(userId, 'expired')!.snapshot_json, null);
});

test('media: decode, resize, strip metadata, reject bad or small images, fallback, dedupe and restore', async () => {
  const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#456789' } }).png().toBuffer();
  const converted = await transformDigestImage(png);
  assert.equal(converted.info.width, 1200); assert.equal(converted.info.format, 'jpeg');
  assert.equal((await sharp(converted.data).metadata()).exif, undefined);
  await assert.rejects(transformDigestImage(Buffer.from('<html>wrong</html>')));
  await assert.rejects(transformDigestImage(png.subarray(0, 80)));
  const tooSmall = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(transformDigestImage(tooSmall), /IMAGE_DIMENSIONS/);
  const excessive = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(transformDigestImage(excessive), /pixel limit/);
  const fetcher: typeof fetch = async () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  const options = { storage, mode: 'shadow' as const, mediaRoot: path.join(root, 'daily-report-media'), rules: [{ pageHost: 'example.com', imageHosts: ['images.example.com'], policy: 'OWNED_OPEN' as const, licenseRef: 'test open source' }], fetchOptions: { fetcher, lookup: async () => [{ address: '93.184.216.34', family: 4 as const }] } };
  const real = await prepareDigestMedia(illustrated(), options);
  assert.equal(real[0].fallback, false); assert.ok(real[0].publicUrl);
  const count = uploads; await prepareDigestMedia(illustrated(), options); assert.equal(uploads, count);
  objects.delete(real[0].key); await restoreDigestObjects(real, storage, options.mediaRoot); assert.ok(objects.has(real[0].key));
  for (const status of [403, 404, 500]) {
    const failed = await prepareDigestMedia(illustrated(), { ...options, fetchOptions: { ...options.fetchOptions, fetcher: async () => new Response('', { status }) } });
    assert.equal(failed[0].fallback, true);
  }
  const restricted = await prepareDigestMedia(illustrated(), { ...options, rules: [], fetchOptions: { fetcher: async () => { throw new Error('MUST_NOT_FETCH'); } } });
  assert.equal(restricted[0].failure, 'LICENSE_NOT_APPROVED'); assert.equal(restricted[0].fallback, true);
  const outage = await prepareDigestMedia(illustrated(), { ...options, storage: { ...storage, put: async () => { throw new Error('outage'); } } });
  assert.equal(outage[0].publicUrl, ''); assert.equal(outage[0].failure, 'R2_UPLOAD_FAILED');
  const timedOut = await prepareDigestMedia(illustrated(), { ...options, fetchOptions: { ...options.fetchOptions, timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) } });
  assert.equal(timedOut[0].fallback, true);
  assert.ok(!renderDigestV2({ digest: illustrated(), media: outage, warnings: [], renderer: 'test' }).includes('<img '));
  const shared = illustrated(); shared.media.push({ ...shared.media[0], id: 'm2' }); shared.stories[0].media_ids.push('m2');
  const refs = await prepareDigestMedia(shared, options);
  assert.equal(refs.length, 2); assert.equal(refs[0].sha256, refs[1].sha256); assert.notEqual(refs[0].id, refs[1].id);
});

test('interrupted media-save, report-save and queue steps recover without duplicate deliveries', async t => {
  process.env.DIGEST_PRODUCTION_CONTRACT = 'daily-digest.v2';
  try {
    for (const failAt of [2, 4, 6, 8]) {
      const date = `2026-09-${10 + failAt}`;
      const snap = { ...snapshot(), date }; const d = { ...digest(), date };
      const run = service.createDigestSnapshotRun(userId, snap);
      policy.setDailyReportDeliveryPolicy(userId, ['cloud']);
      const rename = fs.renameSync; let writes = 0;
      const fault = t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
        if (String(args[1]) === path.join(root, 'activity.db') && ++writes === failAt) throw new Error('TEST_WRITE_FAILURE');
        return rename(...args);
      });
      try { await assert.rejects(service.publishDigestV2(userId, run.runId, d, 'production'), /TEST_WRITE_FAILURE/); }
      finally { fault.mock.restore(); }
      const retry = await service.publishDigestV2(userId, run.runId, d, 'production');
      assert.equal(retry.status, 'PUBLISHED');
      const report = activity.getDailyReport(userId, date, 'cloud')!;
      assert.ok(report.emailNotificationId);
      assert.equal(activity.exportUserActivity(userId).notifications.filter((n: any) => n.source_id === report.id).length, 1);
      const manifest = JSON.parse(activity.getDigestRun(userId, run.runId)!.manifest_json);
      assert.ok(manifest.events.some((e: any) => e.status === 'FAILED'));
      assert.equal(manifest.status, 'PUBLISHED');
    }
  } finally { delete process.env.DIGEST_PRODUCTION_CONTRACT; }
});

test('shadow is isolated, retry is idempotent, renderer escapes injection and backup includes media', async () => {
  const reportCount = activity.listDailyReports(userId).length;
  const notificationCount = activity.exportUserActivity(userId).notifications.length;
  const run = service.createDigestSnapshotRun(userId, snapshot());
  const d = illustrated(); d.stories[0].title = '<img src=x onerror=alert(1)>';
  const results = await Promise.all(Array.from({ length: 3 }, () => service.publishDigestV2(userId, run.runId, d, 'shadow', { storage, rules: [] })));
  assert.equal(new Set(results.map(r => r.artifactId)).size, 1);
  assert.equal(activity.listDailyReports(userId).length, reportCount);
  assert.equal(activity.exportUserActivity(userId).notifications.length, notificationCount);
  const artifact = activity.getDigestArtifact(userId, String(results[0].artifactId))!;
  assert.equal(activity.getDigestArtifact('other', artifact.id), null);
  const p = JSON.parse(artifact.payload_json).publication;
  assert.ok(renderDigestV2(p).includes('&lt;img')); assert.ok(renderDigestV2(p).includes('本期信息不完整'));
  assert.ok(decodeDigestPublication(encodeDigestPublication(p)));
  const saved = backup.createUserBackup(userId, 'test-backup-password');
  const decoded: any = backup.decryptBackup(saved, 'test-backup-password');
  assert.ok(decoded.digestMedia.length); assert.ok(decoded.activity.digestV2Artifacts.length);
  const media = decoded.digestMedia[0];
  assert.equal(crypto.createHash('sha256').update(Buffer.from(media.base64, 'base64')).digest('hex'), media.sha256);
});

test('production is gated and repeated/concurrent publication does not duplicate automatic email', async () => {
  const notificationCount = activity.exportUserActivity(userId).notifications.length;
  const run = service.createDigestSnapshotRun(userId, snapshot());
  await assert.rejects(service.publishDigestV2(userId, run.runId, digest(), 'production'), /V2_PRODUCTION_DISABLED/);
  process.env.DIGEST_PRODUCTION_CONTRACT = 'daily-digest.v2';
  const settings = await import('./daily-report-delivery-policy.js');
  settings.setDailyReportDeliveryPolicy(userId, ['cloud']);
  const results = await Promise.all([1, 2, 3].map(() => service.publishDigestV2(userId, run.runId, digest(), 'production')));
  assert.equal(new Set(results.map(r => r.artifactId)).size, 1);
  assert.equal(activity.exportUserActivity(userId).notifications.length, notificationCount + 1);
  const revised = digest(); revised.title = '更新后的日报';
  const result = await service.publishDigestV2(userId, run.runId, revised, 'production');
  assert.equal(result.emailStatus, 'REVISION_NOT_AUTO_SENT');
  assert.equal(activity.exportUserActivity(userId).notifications.length, notificationCount + 1);
  delete process.env.DIGEST_PRODUCTION_CONTRACT;
  await assert.rejects(service.publishDigestV2(userId, run.runId, digest(), 'production'), /V2_PRODUCTION_DISABLED/);
});

test('user backup restores V2 runs, immutable publications and independently stored image bytes', () => {
  const before = activity.exportUserActivity(userId);
  const saved = backup.createUserBackup(userId, 'restore-test-password');
  const decoded: any = backup.decryptBackup(saved, 'restore-test-password');
  const first = decoded.digestMedia[0];
  const imagePath = path.join(root, 'daily-report-media', first.filename);
  assert.ok(fs.existsSync(imagePath), 'fixture must use isolated media root');
  fs.renameSync(imagePath, imagePath + '.held');
  backup.restoreUserBackup(userId, saved, 'restore-test-password', 'replace');
  assert.equal(activity.exportUserActivity(userId).digestV2Artifacts.length, before.digestV2Artifacts.length);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'), first.sha256);
  const corrupt = structuredClone(decoded); corrupt.digestMedia[0].base64 = Buffer.from('corrupt').toString('base64');
  assert.throws(() => backup.restoreUserBackup(userId, backup.encryptBackup(corrupt, 'restore-test-password'), 'restore-test-password', 'replace'), /校验失败/);
  assert.equal(activity.exportUserActivity(userId).digestV2Artifacts.length, before.digestV2Artifacts.length);
});

test('MCP scopes, defaults and HTTP Shadow ownership are enforced', async () => {
  const server = http.createServer(api.app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    db.createOAuthAccessToken({ token_hash: crypto.createHash('sha256').update(token).digest('hex'), client_id: 'test-client', user_id: userId, scope: 'daily_report:read_calendar daily_report:read_mail daily_report:read_context daily_report:read_history daily_report:publish daily_report:media_prepare', resource: 'http://127.0.0.1:0/mcp', expires_at: new Date(Date.now() + 600000).toISOString(), created_at: now, last_used_at: null, revoked_at: null });
    const call = async (name: string, args: unknown, access = token) => {
      const response = await fetch(base + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      return { status: response.status, body: await response.json() as any };
    };
    const run = service.createDigestSnapshotRun(userId, snapshot());
    const before = activity.exportUserActivity(userId).digestV2Artifacts.length;
    const validated = await call('daily_report.publish_v2', { runId: run.runId, digest: digest() });
    assert.equal(validated.body.result?.structuredContent?.status, 'VALIDATED_NOT_PUBLISHED', JSON.stringify(validated.body));
    assert.equal(activity.exportUserActivity(userId).digestV2Artifacts.length, before);
    const limited = crypto.randomBytes(32).toString('base64url');
    db.createOAuthAccessToken({ token_hash: crypto.createHash('sha256').update(limited).digest('hex'), client_id: 'test-client', user_id: userId, scope: 'daily_report:read_history', resource: 'http://127.0.0.1:0/mcp', expires_at: new Date(Date.now() + 600000).toISOString(), created_at: now, last_used_at: null, revoked_at: null });
    const forbidden = await call('daily_report.validate_v2', { runId: run.runId, digest: digest() }, limited);
    assert.ok(forbidden.body.result?.isError || forbidden.status === 403);
    const artifact = activity.listDigestArtifacts(userId, 'shadow')[0];
    const anonymous = await fetch(base + `/api/daily-reports/${artifact.report_date}?shadow=${artifact.id}`);
    assert.equal(anonymous.status, 401);
    const user = db.getUserById(userId)!;
    const jwt = api.signUserToken(user);
    const view = await fetch(base + `/api/daily-reports/${artifact.report_date}?shadow=${artifact.id}`, { headers: { authorization: 'Bearer ' + jwt } });
    assert.equal(view.status, 200);
    assert.equal((await view.json() as any).report.shadow, true);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('a revision never attaches another version\'s orphaned queue item after an interrupted attach', async t => {
  const date = '2026-09-29';
  const d = { ...digest(), date }; const run = service.createDigestSnapshotRun(userId, { ...snapshot(), date });
  process.env.DIGEST_PRODUCTION_CONTRACT = 'daily-digest.v2';
  const rename = fs.renameSync; let writes = 0;
  const fault = t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
    if (String(args[1]) === path.join(root, 'activity.db') && ++writes === 7) throw new Error('TEST_ATTACH_FAILURE');
    return rename(...args);
  });
  try { await assert.rejects(service.publishDigestV2(userId, run.runId, d, 'production'), /TEST_ATTACH_FAILURE/); }
  finally { fault.mock.restore(); }
  try {
    const original = activity.getDailyReport(userId, date, 'cloud')!;
    assert.equal(original.emailNotificationId, null);
    const count = activity.exportUserActivity(userId).notifications.length;
    const revision = await service.publishDigestV2(userId, run.runId, { ...d, title: '同日修订' }, 'production');
    assert.equal(revision.emailStatus, 'REVISION_NOT_AUTO_SENT');
    assert.equal(activity.exportUserActivity(userId).notifications.length, count);
    assert.equal(activity.getDailyReport(userId, date, 'cloud')!.emailNotificationId, null);
    const recovered = await service.publishDigestV2(userId, run.runId, d, 'production');
    assert.equal(recovered.emailStatus, 'QUEUED');
    assert.equal(activity.exportUserActivity(userId).notifications.length, count);
  } finally { delete process.env.DIGEST_PRODUCTION_CONTRACT; }
});

test('seven fixed synthetic scenarios save only isolated Shadow artifacts', async () => {
  const baseline = activity.exportUserActivity(userId).notifications.length;
  const names = ['ordinary', 'zero-news', 'major-news', 'data-revision', 'source-failure', 'personal-failure', 'all-images-failure'];
  for (const [index, name] of names.entries()) {
    const date = `2026-09-0${index + 1}`;
    const snap = { ...snapshot(), date };
    const d = { ...(name === 'zero-news' ? digest() : illustrated()), date, title: `Synthetic: ${name}` };
    if (name !== 'personal-failure') {
      snap.mail = { status: 'complete', items: [{ id: 'mail-1', title: '合成邮件', detail: '' }] };
      d.mail = [{ input_id: 'mail-1', summary: '合成邮件摘要', action: '整理资料' }];
    }
    if (name === 'major-news') d.executive_signals = ['合成重大事件，不代表真实新闻'];
    if (name === 'data-revision') d.stories[0].summary = '合成数据：前值 1.0，修订值 1.1；不构成真实数据发布。';
    if (name === 'source-failure') d.stories[0].verification = 'unverified';
    const run = service.createDigestSnapshotRun(userId, snap);
    const result = await service.publishDigestV2(userId, run.runId, d, 'shadow', { storage: name === 'all-images-failure' ? null : storage, rules: [] });
    assert.equal(result.status, 'SHADOW_SAVED', name);
    assert.equal(result.emailStatus, 'NOT_QUEUED', name);
    const row = activity.getDigestArtifact(userId, String(result.artifactId))!;
    const publication = JSON.parse(row.payload_json).publication;
    assert.equal(renderDigestV2(publication), renderDigestV2(publication));
    if (name === 'all-images-failure') assert.ok(!renderDigestV2(publication).includes('<img '));
    if (name === 'personal-failure') assert.ok(renderDigestV2(publication).includes('未取得可展示的邮件摘要'));
  }
  assert.equal(activity.exportUserActivity(userId).notifications.length, baseline);
});

test('dedicated Shadow mode refuses both formal contracts and email queueing', async () => {
  const run = service.createDigestSnapshotRun(userId, snapshot());
  const before = activity.exportActivityDb();
  process.env.DIGEST_SHADOW_ONLY = 'true';
  process.env.DIGEST_PRODUCTION_CONTRACT = 'daily-digest.v2';
  try {
    await assert.rejects(service.publishDigestV2(userId, run.runId, digest(), 'production'), /SHADOW_ONLY/);
    const legacy = await import('./daily-report-service.js');
    await assert.rejects(legacy.publishDailyReport(userId, '2026-09-21', '# test'), /SHADOW_ONLY/);
    assert.throws(() => activity.enqueueNotificationDetailed({ userId, sourceType: 'test', sourceId: 'test', channel: 'email', kind: 'daily_report', title: 'test', body: 'test', scheduledAt: now, dedupeKey: 'shadow-email-must-fail' }), /SHADOW_ONLY_EMAIL_DISABLED/);
    assert.deepEqual(activity.exportActivityDb(), before);
  } finally { delete process.env.DIGEST_SHADOW_ONLY; delete process.env.DIGEST_PRODUCTION_CONTRACT; }
});

test.after(() => { /* Keep isolated evidence in OS temp; no production files are touched. */ });
