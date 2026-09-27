import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import { validateDigestV2, digestHash, DIGEST_V2_GENERATION, type DigestV2, type DigestSnapshot } from './digest-v2-contract.js';
import type { ObjectStorage } from './digest-v2-media.js';
import { renderDigestV2, digestV2Text, digestV2Cover, encodeDigestPublication, decodeDigestPublication } from './digest-v2-render.js';

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
  assert.deepEqual(validateDigestV2(digest(), snapshot()).warnings, ['MAIL_READ_FAILED']);
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

test('input reader covers synthetic account calendar and watchlist, and rejects omitted IDs', async () => {
  const schedules = await import('./schedule-store.js');
  const cloudContext = await import('./daily-report-cloud-store.js');
  const inputUserId = 'digest-input-reader-user';
  const otherUserId = 'digest-input-reader-other';
  const date = '2026-10-14';
  for (const id of [inputUserId, otherUserId]) {
    db.createUser({ id, email: `${id}@example.com`, password_hash: 'test', role: 'user', disabled: 0, created_at: now, updated_at: now });
  }
  const makeSchedule = (id: string, owner: string, unscheduled = false) => schedules.createSchedule({
    id, user_id: owner, calendar_id: 'personal', type: 'todo', title: id,
    start_time: `${date}T09:00:00`, all_day: false, category: 'other', priority: 'medium',
    is_completed: false, is_repeated: false, reminders: [], is_high_risk: false, is_unscheduled: unscheduled,
  });
  makeSchedule('owned-calendar-input', inputUserId);
  makeSchedule('other-account-calendar-input', otherUserId);
  makeSchedule('unscheduled-calendar-input', inputUserId, true);
  cloudContext.replaceDailyReportCloudContext(inputUserId, { watchlist: { stocks: [{ name: '合成关注项', symbol: 'TEST' }] } });

  const run = await service.readDigestV2Inputs(inputUserId, date);
  assert.equal(run.snapshot.calendar.status, 'complete');
  assert.deepEqual(run.snapshot.calendar.items.map(item => item.id), ['owned-calendar-input']);
  assert.equal(run.snapshot.watchlist.status, 'complete');
  assert.equal(run.snapshot.watchlist.items.length, 1);
  assert.equal(run.snapshot.watchlist.items[0].title, '合成关注项 TEST');
  assert.equal(run.snapshot.mail.status, 'not_configured');
  assert.deepEqual(run.manifest.warnings, ['MAIL_NOT_CONFIGURED']);

  const d = digest();
  d.date = date;
  d.calendar = [{ input_id: run.snapshot.calendar.items[0].id, text: '合成日程已覆盖' }];
  d.watchlist = [{ input_id: run.snapshot.watchlist.items[0].id, summary: '合成关注项待核验', check: 'incomplete', change: 'unknown', evidence_ids: [] }];
  assert.equal(service.validateDigestRun(inputUserId, run.runId, d).valid, true);
  const missingCalendar = structuredClone(d); missingCalendar.calendar = [];
  assert.ok(service.validateDigestRun(inputUserId, run.runId, missingCalendar).errors.some(issue => issue.code === 'INPUT_OMITTED'));
  const missingWatchlist = structuredClone(d); missingWatchlist.watchlist = [];
  assert.ok(service.validateDigestRun(inputUserId, run.runId, missingWatchlist).errors.some(issue => issue.code === 'INPUT_OMITTED'));
  const foreign = structuredClone(d); foreign.calendar[0].input_id = 'other-account-calendar-input';
  assert.ok(service.validateDigestRun(inputUserId, run.runId, foreign).errors.some(issue => issue.code === 'UNKNOWN_INPUT'));
  const result = await service.publishDigestV2(inputUserId, run.runId, d, 'shadow');
  assert.equal(result.status, 'SHADOW_SAVED');
  assert.equal(result.emailStatus, 'NOT_QUEUED');
});

test('new digest layout gives the lead a large image, other stories side images, and shows missing images', () => {
  const d = illustrated();
  d.evidence.push({ id: 'e2', url: 'https://example.com/second', source: 'Second source', published_at: now });
  d.media.push({ id: 'm2', evidence_id: 'e2', url: 'https://images.example.com/second.jpg', category: 'Market' });
  d.stories.push({ id: 's2', title: '次要新闻', summary: '另一条消息', evidence_ids: ['e2'], media_ids: ['m2'], verification: 'verified' });
  d.stories.push({ id: 's3', title: '缺图新闻', summary: '图片仍待补齐', evidence_ids: ['e2'], media_ids: [], verification: 'partial' });
  const media = d.media.map(m => ({ id: m.id, publicUrl: m.url, fallback: false, kind: undefined, credit: { caption: m.id, author: 'Test', sourcePage: 'https://example.com/story', licenseName: 'Test', licenseUrl: 'https://example.com/license' } })) as any;
  const publication = { digest: d, media, warnings: [], renderer: DIGEST_V2_GENERATION };
  for (const email of [false, true]) {
    const html = renderDigestV2(publication, email);
    assert.equal((html.match(/digest-v2-story--lead/g) || []).length, 1);
    assert.equal((html.match(/digest-v2-story--compact/g) || []).length, 1);
    assert.equal((html.match(/digest-v2-story--no-image/g) || []).length, 1);
    assert.ok(html.includes('class="digest-v2-cover"'));
    assert.ok(html.includes('width="680"'));
    assert.ok(html.includes('width="116"'));
    assert.ok(html.includes('此条暂无可用配图'));
  }
  const legacy = renderDigestV2({ ...publication, renderer: '2026-09-24.1' });
  assert.ok(!legacy.includes('digest-v2-story--lead'));
  assert.ok(!legacy.includes('此条暂无可用配图'));
  assert.ok(digestV2Text({ ...publication, renderer: '2026-09-24.1' }).includes('本期无新增内容。'));
});

test('report list uses the lead news title and image instead of the draft title or a source icon', () => {
  const d = illustrated(); d.title = 'Daily Digest V2.5｜2026-09-21 · 逐条配图验收';
  d.executive_signals = ['与头条无关的市场信号'];
  const photo = { id: 'm1', publicUrl: 'https://images.example.com/lead.jpg', fallback: false, credit: { caption: '公司资料照片，非新闻现场', author: 'Photographer', sourcePage: 'https://example.com/photo', licenseName: 'CC BY', licenseUrl: 'https://example.com/license' } } as any;
  const cover = digestV2Cover({ digest: d, media: [{ ...photo, id: 'icon', kind: 'source_icon' }, photo], warnings: [], renderer: DIGEST_V2_GENERATION });
  assert.equal(cover.headline, '有来源的新闻');
  assert.equal(cover.excerpt, '一项可核验的新变化');
  assert.equal(cover.heroImageUrl, photo.publicUrl);
  assert.equal(cover.heroImageCredit, '公司资料照片，非新闻现场 · Photographer · CC BY');
  assert.equal(cover.heroImageSourceUrl, 'https://example.com/photo');
  assert.equal(cover.heroImageLicenseUrl, 'https://example.com/license');
  const publication = { digest: d, media: [photo], warnings: [], renderer: DIGEST_V2_GENERATION };
  assert.ok(renderDigestV2(publication).includes('>今日重点新闻</h1>'));
  assert.ok(!renderDigestV2(publication).includes(d.title));
  assert.ok(digestV2Text(publication).includes('今日重点新闻'));
  assert.ok(!digestV2Text(publication).includes(d.title));
  assert.ok(renderDigestV2({ ...publication, renderer: '2026-09-24.1' }).includes(d.title));
  const fallback = digestV2Cover({ digest: d, media: [{ id: 'story-art', storyId: 's1', publicUrl: 'https://images.example.com/art.png', fallback: true } as any], warnings: [], renderer: DIGEST_V2_GENERATION });
  assert.equal(fallback.heroImageCredit, '原创编辑插画，非新闻现场图片');
  const empty = digestV2Cover({ digest: digest(), media: [], warnings: [], renderer: DIGEST_V2_GENERATION });
  assert.equal(empty.heroImageUrl, null);
  assert.ok(renderDigestV2({ digest: digest(), media: [], warnings: [], renderer: DIGEST_V2_GENERATION }).includes('今日情报简报'));
});

test('editorial digest renders selective emphasis, one opening cover, numbered sources and concise credits', () => {
  const d = illustrated();
  d.executive_signals = ['美国**长端国债收益率**仍高，**高无风险利率**约束估值。'];
  d.stories[0].summary = '**Akamai与Anthropic**宣布合作，图片仅作背景，不代表公告现场。';
  d.evidence[0] = { id: 'e1', url: 'https://example.com/story', source: 'Example source', published_at: '' };
  d.evidence.push({ id: 'e2', url: 'https://photos.example.com/image', source: 'Photo archive', published_at: now });
  d.media[0].evidence_id = 'e2';
  d.stories[0].evidence_ids = ['e1', 'e2'];
  d.market = [{ id: 'market', title: '市场跟踪', summary: '同一来源显示**利率继续走高**，需要关注估值变化。', evidence_ids: ['e1'], media_ids: [], verification: 'verified' }];
  const photo = { id: 'm1', publicUrl: 'https://images.example.com/lead.jpg', fallback: false, credit: { caption: '资料照片，非公告现场', author: 'Photographer', sourcePage: 'https://photos.example.com/image', licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' } } as any;
  const icon = { id: 'source-icon:example.com', kind: 'source_icon', sourceHost: 'example.com', publicUrl: 'https://images.example.com/icon.png', fallback: false } as any;
  const p = { digest: d, media: [photo, icon], warnings: [], renderer: DIGEST_V2_GENERATION };
  assert.equal(validateDigestV2(d).valid, true);
  for (const email of [false, true]) {
    const html = renderDigestV2(p, email);
    assert.ok(html.indexOf('class="digest-v2-cover"') < html.indexOf('>今日重点新闻</h1>'));
    assert.equal((html.match(/lead\.jpg/g) || []).length, 1);
    assert.ok(html.includes('<strong>长端国债收益率</strong>'));
    assert.ok(html.includes('href="#digest-source-1"'));
    assert.ok(html.includes('id="digest-source-1"'));
    assert.equal((html.match(/id="digest-source-1"/g) || []).length, 1);
    assert.ok(html.includes('icon.png'));
    assert.ok(html.includes('Example source · 发布时间：时间未知'));
    assert.ok(html.includes('>原文链接</a>'));
    assert.ok(html.includes('Photographer'));
    assert.ok(html.includes('已编辑'));
    assert.ok(!html.includes('证据已核对'));
    assert.ok(!html.includes('发布时间未提供'));
    assert.ok(!html.includes('已缩放'));
    assert.ok(!html.includes('Photo archive · 发布时间'));
  }
  assert.ok(!digestV2Text(p).includes('**'));
  assert.ok(digestV2Cover(p).excerpt.includes('Akamai与Anthropic'));
  assert.ok(!digestV2Cover(p).excerpt.includes('**'));
  const missing = structuredClone(d); missing.stories[0].summary = '这是一段足够长但完全没有标出重点的正文内容。';
  assert.ok(validateDigestV2(missing).errors.some(issue => issue.code === 'EMPHASIS_REQUIRED'));
  const halfMarked = structuredClone(d); halfMarked.stories[0].summary = '第一句说明了**关键事实**。第二句足够长却完全没有标出任何重点内容，读者无法快速抓住核心变化。';
  assert.ok(validateDigestV2(halfMarked).errors.some(issue => issue.code === 'EMPHASIS_REQUIRED'));
  const broken = structuredClone(d); broken.stories[0].summary = '这一段有**没有结束的标记';
  assert.ok(validateDigestV2(broken).errors.some(issue => issue.code === 'EMPHASIS_INVALID'));
  const escaped = structuredClone(p); escaped.digest.stories[0].summary = '**<img src=x onerror=alert(1)>** 后续内容。';
  assert.ok(renderDigestV2(escaped).includes('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>'));
  assert.ok(!renderDigestV2(escaped).includes('<img src=x'));
  const oldDigest = structuredClone(d);
  oldDigest.stories[0].summary = '这是旧版已经保存的较长正文，其中没有任何新的加粗标记。';
  const oldPublication = { ...p, digest: oldDigest, renderer: '2026-09-26.1' };
  assert.ok(decodeDigestPublication(encodeDigestPublication(oldPublication)));
  assert.ok(renderDigestV2(oldPublication).includes('发布时间未提供'));
});

test('mail snapshot state distinguishes unconfigured, failed, partial, and empty success in every receipt', async () => {
  const date = '2026-10-09';
  const cases = [
    { status: 'not_configured', warning: 'MAIL_NOT_CONFIGURED', message: '日报邮箱尚未配置，本期未读取邮件。' },
    { status: 'failed', warning: 'MAIL_READ_FAILED', message: '邮箱读取失败，未取得可展示的邮件摘要。' },
    { status: 'partial', warning: 'MAIL_INCOMPLETE', message: '未取得可展示的邮件摘要。' },
    { status: 'complete', warning: null, message: '本期无新增内容。' },
  ] as const;
  for (const entry of cases) {
    const snap = snapshot(); snap.date = date; snap.mail = { status: entry.status, items: [] };
    const d = digest(); d.date = date;
    const run = service.createDigestSnapshotRun(userId, snap);
    const manifest = JSON.parse(activity.getDigestRun(userId, run.runId)!.manifest_json);
    assert.deepEqual(manifest.warnings, entry.warning ? [entry.warning] : []);
    const validated = service.validateDigestRun(userId, run.runId, d);
    assert.deepEqual(validated.warnings, manifest.warnings);
    const result = await service.publishDigestV2(userId, run.runId, d, 'shadow');
    assert.deepEqual(result.warnings, manifest.warnings);
    const artifact = activity.getDigestArtifact(userId, String(result.artifactId))!;
    const publication = JSON.parse(artifact.payload_json).publication;
    assert.deepEqual(publication.warnings, manifest.warnings);
    for (const email of [false, true]) {
      const html = renderDigestV2(publication, email);
      assert.ok(html.includes(entry.message));
      if (entry.warning) assert.ok(html.includes('本期信息不完整'));
      else assert.ok(!html.includes('本期信息不完整'));
    }
    assert.ok(digestV2Text(publication).includes(entry.message));
  }
});

test('an unexpired legacy run keeps its warning hash and frozen artifact on retry', async () => {
  const date = '2026-10-10';
  const snap = snapshot(); snap.date = date; snap.mail = { status: 'not_configured', items: [] };
  const d = digest(); d.date = date;
  assert.deepEqual(validateDigestV2(d, snap, '2026-09-21.1').warnings, []);
  assert.deepEqual(validateDigestV2(d, { ...snap, mail: { status: 'failed', items: [] } }, '2026-09-21.1').warnings, ['MAIL_INCOMPLETE']);
  const runId = crypto.randomUUID();
  activity.createDigestRun({ id: runId, user_id: userId, report_date: date, snapshot_json: JSON.stringify(snap), manifest_json: JSON.stringify({ generationVersion: '2026-09-22.2', warnings: [] }), created_at: now, expires_at: new Date(Date.now() + 86400000).toISOString() });
  const validated = service.validateDigestRun(userId, runId, d);
  assert.deepEqual(validated.warnings, []);
  assert.equal(validated.contentHash, digestHash({ digest: d, inputWarnings: [] }));
  const first = await service.publishDigestV2(userId, runId, d, 'shadow');
  const artifact = activity.getDigestArtifact(userId, String(first.artifactId))!;
  const publication = JSON.parse(artifact.payload_json).publication;
  assert.equal(publication.renderer, '2026-09-22.2');
  assert.ok(renderDigestV2(publication).includes('本期无新增内容。'));
  assert.ok(!renderDigestV2(publication).includes('日报邮箱尚未配置'));
  assert.ok(!digestV2Text(publication).includes('日报邮箱尚未配置'));
  const second = await service.publishDigestV2(userId, runId, d, 'shadow');
  assert.equal(second.artifactId, first.artifactId);
  assert.equal(activity.getDigestArtifact(userId, String(first.artifactId))!.payload_json, artifact.payload_json);
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
  const withImage = illustrated(); withImage.date = '2026-10-11';
  const imageRun = service.createDigestSnapshotRun(userId, { ...snapshot(), date: withImage.date });
  const published = await service.publishDigestV2(userId, imageRun.runId, withImage, 'shadow', options);
  assert.deepEqual(published.imageCoverage, { total: 1, real: 1, illustration: 0, missing: 0 });
  assert.equal((published.media as any).real, 1);
  const listItem = service.digestArtifactView(activity.getDigestArtifact(userId, String(published.artifactId))!);
  assert.equal(listItem.headline, '有来源的新闻');
  const publishedMedia = JSON.parse(activity.getDigestArtifact(userId, String(published.artifactId))!.payload_json).publication.media[0];
  assert.equal(publishedMedia.filename, real[0].filename);
  assert.notEqual(publishedMedia.key, real[0].key);
  assert.equal(listItem.heroImageUrl, publishedMedia.publicUrl);
  assert.equal(listItem.excerpt, '一项可核验的新变化');
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
  assert.equal(refs[0].key, refs[1].key, 'same-date references share one object');
  const later = illustrated(); later.date = '2026-10-12';
  const laterRefs = await prepareDigestMedia(later, options);
  assert.equal(laterRefs[0].filename, refs[0].filename, 'local content-addressed mirror stays shared');
  assert.notEqual(laterRefs[0].key, refs[0].key, 'later date gets its own tmp expiration');
  assert.match(laterRefs[0].key, /^tmp\/2026-10-12\//);
  objects.delete(refs[0].key); objects.delete(laterRefs[0].key);
  await restoreDigestObjects([...refs, ...laterRefs], storage, options.mediaRoot);
  assert.ok(objects.has(refs[0].key)); assert.ok(objects.has(laterRefs[0].key));
  const beforeBadRestore = uploads;
  await assert.rejects(restoreDigestObjects([refs[0], { ...laterRefs[0], key: `tmp/2026-10-12/${'0'.repeat(64)}.jpg` }], storage, options.mediaRoot), /MEDIA_BACKUP_PATH/);
  assert.equal(uploads, beforeBadRestore, 'a bad later reference cannot cause an earlier upload');
});

test('new Shadow gives every story without a licensed photo a distinct, labeled original illustration', async () => {
  const d = illustrated(); d.date = '2026-10-12'; d.media = []; d.stories[0].media_ids = [];
  d.stories.push({ id: 's2', title: '另一条新闻', summary: '第二条可核验消息', evidence_ids: ['e1'], media_ids: [], verification: 'partial' });
  const run = service.createDigestSnapshotRun(userId, { ...snapshot(), date: d.date });
  const receipt = await service.publishDigestV2(userId, run.runId, d, 'shadow', { storage, rules: [], mediaRoot: path.join(root, 'daily-report-media') });
  assert.deepEqual(receipt.imageCoverage, { total: 2, real: 0, illustration: 2, missing: 0 });
  assert.equal((receipt.media as any).fallback, 2);
  const artifact = activity.getDigestArtifact(userId, String(receipt.artifactId))!;
  const publication = JSON.parse(artifact.payload_json).publication;
  assert.equal(publication.media.length, 2);
  assert.equal(new Set(publication.media.map((m: any) => m.sha256)).size, 2);
  assert.ok(publication.media.every((m: any) => m.storyId && m.fallback && m.publicUrl && m.licenseRef === 'code-owned-editorial-illustration'));
  const html = renderDigestV2(publication);
  assert.ok(html.includes('digest-v2-story--lead'));
  assert.ok(html.includes('digest-v2-story--compact'));
  assert.equal((html.match(/原创编辑插画，非新闻现场图片/g) || []).length, 2);
  assert.ok(!html.includes('此条暂无可用配图'));
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
  assert.deepEqual(results[0].imageCoverage, { total: 1, real: 0, illustration: 1, missing: 0 });
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

test('user backup restores V2 runs, immutable publications and independently stored image bytes', async () => {
  for (const date of ['2026-10-20', '2026-10-21']) {
    const d = illustrated(); d.date = date;
    const run = service.createDigestSnapshotRun(userId, { ...snapshot(), date });
    await service.publishDigestV2(userId, run.runId, d, 'shadow', { storage, rules: [] });
  }
  const before = activity.exportUserActivity(userId);
  const saved = backup.createUserBackup(userId, 'restore-test-password');
  const decoded: any = backup.decryptBackup(saved, 'restore-test-password');
  const references = before.digestV2Artifacts.flatMap((row: any) => JSON.parse(row.payload_json).publication.media.map((media: any) => media.filename));
  const sharedFilename = references.find((filename: string, index: number) => references.indexOf(filename) !== index);
  assert.ok(sharedFilename, 'separate artifacts share a content-addressed local media file');
  assert.equal(decoded.digestMedia.filter((item: any) => item.filename === sharedFilename).length, 1);
  const first = decoded.digestMedia.find((item: any) => item.filename === sharedFilename);
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
    if (name === 'data-revision') d.stories[0].summary = '合成数据：前值 1.0，**修订值 1.1**；不构成真实数据发布。';
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

test('audited single-image rules retain attribution and reject siblings, redirects and changed copies', async () => {
  const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#123456' } }).png().toBuffer();
  const sourceFile = path.join(root, 'reviewed-source.png'); fs.writeFileSync(sourceFile, png);
  const sourceSha256 = crypto.createHash('sha256').update(png).digest('hex');
  const rule = { pageHost: 'example.com', pageUrl: 'https://example.com/story', imageHosts: ['images.example.com'], imageUrls: ['https://images.example.com/image.jpg'], policy: 'LICENSED' as const, licenseRef: 'reviewed file', credit: { caption: '历史资料图 <not today>', author: 'Author & Co', sourcePage: 'https://example.com/license', licenseName: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/' }, sourceFile, sourceSha256 };
  const options = { storage, mode: 'shadow' as const, mediaRoot: path.join(root, 'daily-report-media'), rules: [rule], fetchOptions: { fetcher: async () => { throw new Error('MUST_NOT_FETCH'); } } };
  const result = await prepareDigestMedia(illustrated(), options);
  assert.equal(result[0].fallback, false); assert.equal(result[0].sourceTransport, 'audited_copy'); assert.equal(result[0].sourceSha256, sourceSha256);
  const publication = { digest: illustrated(), media: result, warnings: [], renderer: 'test' };
  for (const email of [false, true]) { const html = renderDigestV2(publication, email); assert.ok(html.includes('Author &amp; Co')); assert.ok(html.includes('历史资料图 &lt;not today&gt;')); assert.ok(html.includes(rule.credit.licenseUrl)); assert.ok(html.includes('已缩放')); }
  assert.ok(decodeDigestPublication(encodeDigestPublication(publication))!.media[0].credit);
  const sibling = illustrated(); sibling.media[0].url = 'https://images.example.com/unapproved.jpg';
  assert.equal((await prepareDigestMedia(sibling, options))[0].failure, 'LICENSE_NOT_APPROVED');
  const page = illustrated(); page.evidence[0].url = 'https://example.com/other';
  assert.equal((await prepareDigestMedia(page, options))[0].failure, 'LICENSE_NOT_APPROVED');
  fs.writeFileSync(sourceFile, Buffer.from('changed'));
  assert.equal((await prepareDigestMedia(illustrated(), options))[0].fallback, true);
  const { sourceFile: _file, sourceSha256: _hash, ...networkRule } = rule;
  const redirected = await prepareDigestMedia(illustrated(), { ...options, rules: [networkRule], fetchOptions: { lookup: async () => [{ address: '93.184.216.34', family: 4 as const }], fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://images.example.com/unapproved.jpg' } }) } });
  assert.equal(redirected[0].fallback, true);
});

test('source icons use reviewed exact URLs, stay optional, and never count as story images', async () => {
  const d=illustrated();d.media=[];d.stories[0].media_ids=[];
  const png=await sharp({create:{width:32,height:32,channels:4,background:'#bb5500'}}).png().toBuffer();
  const options={storage,mode:'shadow' as const,mediaRoot:path.join(root,'daily-report-media'),rules:[{kind:'source_icon' as const,pageHost:'example.com',imageHosts:['images.example.com'],imageUrls:['https://images.example.com/icon.png'],policy:'EXTERNAL_ALLOWED' as const,licenseRef:'test source identification approval'}],fetchOptions:{fetcher:async()=>new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}}),lookup:async()=>[{address:'93.184.216.34',family:4 as const}]}};
  const icons=await prepareDigestMedia(d,options);
  assert.equal(icons.length,1);assert.equal(icons[0].kind,'source_icon');assert.equal(icons[0].mime,'image/png');assert.equal(icons[0].width,32);
  const publication={digest:d,media:icons,warnings:[],renderer:'test'};
  for(const email of [true,false]){const html=renderDigestV2(publication,email);assert.ok(html.includes('width="16"'));assert.ok(html.includes('Example source'));assert.ok(!html.includes('<figure'));}
  assert.ok(decodeDigestPublication(encodeDigestPublication(publication)));
  const failed=await prepareDigestMedia(d,{...options,fetchOptions:{...options.fetchOptions,fetcher:async()=>new Response('',{status:429})}});
  assert.ok(failed[0].failure);assert.equal(failed[0].publicUrl,'');assert.ok(!renderDigestV2({...publication,media:failed}).includes('<img '));assert.ok(renderDigestV2({...publication,media:failed}).includes('Example source'));
});

test('source ICO decoder handles bottom-up BGRA and mask, rejecting malformed ranges and dimensions', async () => {
  const {transformDigestIcon}=await import('./digest-v2-media.js');
  const width=8,height=8,stride=4;const dib=Buffer.alloc(40+width*height*4+stride*height);
  dib.writeUInt32LE(40,0);dib.writeInt32LE(width,4);dib.writeInt32LE(height*2,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);
  for(let i=40;i<40+width*height*4;i+=4){dib[i]=11;dib[i+1]=22;dib[i+2]=33;dib[i+3]=255;}
  dib[40+width*height*4+(height-1)*stride]=128;
  const ico=Buffer.alloc(22+dib.length);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=width;ico[7]=height;ico.writeUInt32LE(dib.length,14);ico.writeUInt32LE(22,18);dib.copy(ico,22);
  const r=await transformDigestIcon(ico);assert.equal(r.info.format,'png');const raw=await sharp(r.data).raw().toBuffer();assert.deepEqual([...raw.subarray(0,8)],[33,22,11,0,33,22,11,255]);
  const bad=Buffer.from(ico);bad.writeUInt32LE(0xffffffff,18);await assert.rejects(transformDigestIcon(bad),/ICON_INVALID/);
  const huge=Buffer.from(ico);huge.writeInt32LE(100000,26);await assert.rejects(transformDigestIcon(huge),/ICON_DIMENSIONS/);
  await assert.rejects(transformDigestIcon(Buffer.from([0])));
});
