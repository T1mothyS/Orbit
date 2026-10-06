import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalSourceUrl, collectAiHot, collectNewsletters, createAiHotReader, deduplicateCandidates, normalizeNewsletterInputs, type NewsletterInputs, type DigestCandidate, type DigestSourcesSnapshot } from './digest-v2-sources.js';
import { DIGEST_V2_GENERATION, validateDigestV2, type DigestSnapshot, type DigestV2 } from './digest-v2-contract.js';
import { renderDigestV2, digestV2Text, encodeDigestPublication, decodeDigestPublication } from './digest-v2-render.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-sources-test-'));
process.env.APP_ENV = 'development'; process.env.NODE_ENV = 'test'; process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.DIGEST_V2_ENABLED = 'true'; process.env.DIGEST_V2_SOURCES_ENABLED = 'true'; process.env.DIGEST_V2_SOURCES_USER_IDS = 'sources-user';
const api = await import('./index.js'); const db = await import('./db.js'); const activity = await import('./activity-store.js');
const service = await import('./digest-v2-service.js'); const mcp = await import('./daily-report-cloud-mcp.js');
await api.initializeServer();
const now = new Date().toISOString(); const cutoff = '2026-10-06T08:00:00Z'; const userId = 'sources-user';
for (const id of [userId, 'sources-other']) db.createUser({ id, email: `${id}@example.com`, password_hash: 'test', role: 'user', disabled: 0, created_at: now, updated_at: now });
function input(): NewsletterInputs { return {
  bloomberg: { status: 'complete', reason: 'ok', lastMessageAt: '2026-10-05T10:00:00Z', items: [{ id: 'mail-story-1', title: '合成债券市场变化', summary: '明确的新事实短摘录', originalUrl: 'https://www.bloomberg.com/news/articles/example?utm_source=email', publishedAt: '', receivedAt: '2026-10-05T10:00:00Z', signals: [] }] },
  polymarket: { status: 'complete', reason: 'stale', lastMessageAt: '2026-08-13T16:27:49Z', items: [] },
}; }
function snap(): DigestSnapshot { return { date: '2026-10-06', timezone: 'Asia/Shanghai', cutoff, contextVersion: 4,
  calendar: { status: 'complete', items: [] }, mail: { status: 'complete', items: [] }, watchlist: { status: 'complete', items: [] } }; }
function digest(): DigestV2 { return { schema_version: 'daily-digest.v2', date: '2026-10-06', title: '合成验证', executive_signals: [], calendar: [], mail: [], market: [], macro: [], stories: [], watchlist: [], what_matters_next: [], evidence: [], media: [] }; }
const emptyAiHot = async () => ({ candidates: [], status: { source: 'aihot' as const, status: 'failed' as const, freshness: 'unknown' as const, candidateCount: 0, lastMessageAt: '', reasonCodes: ['AIHOT_REQUEST_FAILED'], provenance: 'server_rest' as const } });
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });

test('AIHot ETag cache: 200, fresh reuse, conditional 304, and cacheless 304', async () => {
  let time = 0; const calls: Headers[] = [];
  const reader = createAiHotReader({ now: () => time, fetch: async (_url, options) => {
    calls.push(new Headers(options?.headers));
    return calls.length === 1 ? json({ schemaVersion: 1, items: [] }, { etag: 'fixture-etag', 'cache-control': 'public,max-age=60' }) : new Response(null, { status: 304 });
  } });
  const first = await reader.read('/api/v1/hot-topics'); assert.deepEqual(await reader.read('/api/v1/hot-topics'), first); assert.equal(calls.length, 1);
  time = 61_000; assert.deepEqual(await reader.read('/api/v1/hot-topics'), first); assert.equal(calls[1].get('if-none-match'), 'fixture-etag');
  const missing = createAiHotReader({ fetch: async () => new Response(null, { status: 304 }) });
  await assert.rejects(missing.read('/api/v1/hot-topics'), /AIHOT_CACHE_MISSING/);
});

test('AIHot retries are bounded, honor a short Retry-After, and reject long rate-limit waits', async () => {
  let calls = 0; const delays: number[] = [];
  const reader = createAiHotReader({ sleep: async ms => { delays.push(ms); }, fetch: async () => ++calls === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '1' } }) : json({ items: [] }) });
  await reader.read('/api/v1/hot-topics'); assert.equal(calls, 2); assert.deepEqual(delays, [1000]);
  for (const [status, retryAfter, error] of [[429, '60', 'AIHOT_RATE_LIMIT'], [503, '', 'AIHOT_UPSTREAM_FAILED']] as const) {
    let tries = 0; const failing = createAiHotReader({ sleep: async () => {}, fetch: async () => { tries++; return new Response(null, { status, headers: { 'retry-after': retryAfter } }); } });
    await assert.rejects(failing.read('/api/v1/hot-topics'), new RegExp(error)); assert.equal(tries, status === 429 ? 1 : 2);
  }
});

test('AIHot rejects redirect, invalid MIME/JSON, oversized bodies, and exposes no provider errors', async () => {
  for (const [response, code] of [
    [new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }), 'AIHOT_RESPONSE_INVALID'],
    [new Response('html'), 'AIHOT_RESPONSE_INVALID'],
    [new Response('{broken', { headers: { 'content-type': 'application/json' } }), 'AIHOT_JSON_INVALID'],
    [json('x'.repeat(512_001)), 'AIHOT_BODY_LIMIT'],
  ] as const) await assert.rejects(createAiHotReader({ fetch: async () => response }).read('/api/v1/hot-topics'), new RegExp(code));
  const result = await collectAiHot(cutoff, { read: async () => { throw new Error('private provider message with password=redacted'); } });
  assert.equal(result.status.status, 'failed'); assert.deepEqual(result.status.reasonCodes, ['AIHOT_REQUEST_FAILED']);
});

test('AIHot timeout also bounds a stalled fetch before DNS/headers complete', async () => {
  let requests = 0;
  const reader = createAiHotReader({ fetch: async () => { requests++; return new Promise<Response>(() => {}); } });
  const result = await collectAiHot(cutoff, reader);
  assert.equal(result.status.status, 'failed'); assert.equal(requests, 3);
  assert.deepEqual(result.status.reasonCodes, ['AIHOT_TIMEOUT']); assert.equal(result.candidates.length, 0);
});

test('AIHot normalizes all three actual wire shapes, dedupes provenance and keeps unknown publication time', async () => {
  const item = { id: 'one', title: '同一事件', summary: '新事实', source: { name: '官方来源' }, links: { aihot: 'https://aihot.news/items/one', original: 'https://example.com/story' }, publishedAt: '', discoveredAt: '2026-10-06T07:00:00Z' };
  const result = await collectAiHot(cutoff, { read: async endpoint => endpoint.includes('dailies') ? { schemaVersion: 1, report: { windowEnd: '2026-10-06T00:00:00Z', sections: [{ items: [item] }] } } : { schemaVersion: 1, items: [item] } });
  assert.equal(result.status.status, 'complete'); assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].publishedAt, '');
  assert.equal(result.candidates[0].sourceRefs[0].attributionUrl, 'https://aihot.news/items/one');
  const changed = await collectAiHot(cutoff, { read: async endpoint => endpoint.includes('items?') ? { schemaVersion: 2, items: [] } : { schemaVersion: 1, items: [] } });
  assert.equal(changed.status.status, 'partial'); assert.ok(changed.status.reasonCodes.includes('AIHOT_SCHEMA_CHANGED'));
  for (const sections of [{ unexpected: true }, [null, { items: false }]]) {
    const malformed = await collectAiHot(cutoff, { read: async endpoint => endpoint.includes('dailies') ? { schemaVersion: 1, report: { sections } } : { schemaVersion: 1, items: [] } });
    assert.equal(malformed.status.status, 'partial'); assert.ok(malformed.status.reasonCodes.includes('AIHOT_SCHEMA_CHANGED'));
  }
  const future = await collectAiHot(cutoff, { read: async () => ({ schemaVersion: 1, items: [{ ...item, discoveredAt: '2026-10-06T09:00:00Z' }] }) });
  assert.equal(future.candidates.length, 0); assert.ok(future.status.reasonCodes.includes('AFTER_CUTOFF_EXCLUDED'));
});

test('newsletter normalizer rejects extra fields, secrets, invalid status and invalid time', () => {
  for (const mutate of [
    (v: any) => { v.gmailToken = 'not-allowed'; },
    (v: any) => { v.bloomberg.items[0].html = '<html>private original</html>'; },
    (v: any) => { v.bloomberg.items[0].summary = 'recipient@example.com'; },
    (v: any) => { v.bloomberg.items[0].summary = 'password=example-secret-value'; },
    (v: any) => { v.bloomberg.items[0].receivedAt = 'yesterday'; },
    (v: any) => { v.bloomberg.status = 'failed'; },
    (v: any) => { v.bloomberg.status = ['complete']; },
    (v: any) => { v.bloomberg.items[0].signals = [{ type: ['change'], value: '25', unit: '', window: '', observedAt: '' }]; },
    (v: any) => { v.bloomberg.items[0].signals = [{ type: 'change', value: '25', unit: '', window: '', observedAt: '', previousValue: '42' }]; },
  ]) { const value = input(); mutate(value); assert.throws(() => normalizeNewsletterInputs(value), /SOURCE_/); }
});

test('candidate references strip marketing params and reject mail trackers, signatures and internal URLs', () => {
  assert.equal(canonicalSourceUrl('https://example.com/story?utm_source=email&b=2&a=1#top'), 'https://example.com/story?a=1&b=2');
  for (const url of ['https://e.customeriomail.com/e/c/recipient-token', 'https://links.message.bloomberg.com/a/private', 'https://ci5.googleusercontent.com/proxy', 'https://mail.google.com/mail/u/0/#inbox', 'https://aihot.news/api/img-proxy?sig=abc', 'https://example.com/a?signature=secret', 'https://127.0.0.1/private']) assert.equal(canonicalSourceUrl(url), '');
});

test('mail window and cutoff exclude old/future signals; units stay unknown rather than reconstructed', () => {
  const value = input(); value.polymarket = { status: 'complete', reason: 'ok', lastMessageAt: '2026-10-06T07:00:00Z', items: [{ ...value.bloomberg.items[0], id: 'signal-1', receivedAt: '2026-10-06T07:00:00Z', originalUrl: 'https://e.customeriomail.com/e/c/tracker', signals: [{ type: 'change', value: '+25%', unit: '', window: '', observedAt: '' }] }] };
  const result = collectNewsletters(normalizeNewsletterInputs(value), cutoff);
  assert.equal(result.candidates[1].sourceType, 'signal'); assert.equal(result.candidates[1].originalUrl, '');
  assert.deepEqual(result.candidates[1].signals[0], value.polymarket.items[0].signals[0]);
  assert.ok(result.statuses[1].reasonCodes.includes('SIGNAL_CONTEXT_UNKNOWN'));
  value.polymarket.items[0].receivedAt = '2026-08-13T00:00:00Z'; assert.equal(collectNewsletters(value, cutoff).candidates.length, 1);
  value.polymarket.items[0].receivedAt = '2026-10-06T07:00:00Z'; value.polymarket.items[0].signals[0].observedAt = '2026-10-06T09:00:00Z';
  assert.equal(collectNewsletters(value, cutoff).candidates.length, 1);
});

test('source bounds report truncation, merge duplicate provenance, and retain distinct fact changes', () => {
  const value = input(); value.bloomberg.items = Array.from({ length: 45 }, (_, i) => ({ ...value.bloomberg.items[0], id: `mail-${i}`, title: `事件${i}`, summary: `事实${i}`, originalUrl: `https://example.com/${i}` }));
  const result = collectNewsletters(value, cutoff); assert.equal(result.candidates.length, 40); assert.equal(result.statuses[0].status, 'partial'); assert.ok(result.statuses[0].reasonCodes.includes('TRUNCATED'));
  const original = result.candidates[0]; const copied: DigestCandidate = { ...structuredClone(original), id: 'other', sourceType: 'aggregator', sourceRefs: [{ source: 'aihot', id: 'other', attributionUrl: 'https://aihot.news/items/other' }] };
  const merged = deduplicateCandidates([original, copied, { ...copied, id: 'progress', summary: '新增独立事实' }]);
  assert.equal(merged.length, 2); assert.equal(merged[0].sourceRefs.length, 2); assert.equal(original.sourceRefs.length, 1);
});

test('sources are frozen, concurrent identical input is idempotent, personal snapshot/manifest stay isolated', async () => {
  const run = service.createDigestSnapshotRun(userId, snap()); let calls = 0;
  const collector = async () => { calls++; return emptyAiHot(); };
  const before = activity.exportUserActivity(userId);
  const results = await Promise.all([service.prepareDigestSources(userId, run.runId, input(), collector), service.prepareDigestSources(userId, run.runId, input(), collector)]);
  assert.equal(calls, 1); assert.deepEqual(results[0], results[1]); assert.equal(results[0].fallbackToWebSearch, true);
  const row = activity.getDigestRun(userId, run.runId)!; const stored = JSON.parse(row.snapshot_json!);
  assert.deepEqual({ ...stored, sources: undefined }, { ...snap(), sources: undefined });
  assert.ok(!row.manifest_json.includes('新事实短摘录')); assert.ok(!row.manifest_json.includes('mail-story-1')); assert.ok(!row.manifest_json.includes('2026-08-13'));
  const changed = input(); changed.bloomberg.items[0].summary = '不同摘录';
  await assert.rejects(service.prepareDigestSources(userId, run.runId, changed, collector), /SOURCE_INPUT_FROZEN/);
  assert.equal(activity.updateDigestRunSnapshot('sources-other', run.runId, row.snapshot_json!, snap()), false);
  assert.equal(activity.updateDigestRunSnapshot(userId, run.runId, 'stale revision', snap()), false);
  const after = activity.exportUserActivity(userId); assert.equal(after.dailyReports.length, before.dailyReports.length); assert.equal(after.notifications.length, before.notifications.length); assert.equal(after.digestV2Artifacts.length, before.digestV2Artifacts.length);
  const d = digest(); assert.deepEqual(service.validateDigestRun(userId, run.runId, d).warnings, ['SOURCE_AIHOT_FAILED', 'SOURCE_POLYMARKET_STALE']);
  const dry = await service.publishDigestV2(userId, run.runId, d, 'dry_run'); assert.equal(dry.status, 'VALIDATED_NOT_PUBLISHED');
});

test('source gate, OAuth scopes and cross-account run reject before any fetch', async () => {
  const run = service.createDigestSnapshotRun(userId, snap()); let calls = 0; const collector = async () => { calls++; return emptyAiHot(); };
  process.env.DIGEST_V2_SOURCES_USER_IDS = `${userId},sources-other`;
  try { await assert.rejects(service.prepareDigestSources('sources-other', run.runId, input(), collector), /RUN_NOT_FOUND/); } finally { process.env.DIGEST_V2_SOURCES_USER_IDS = userId; }
  process.env.DIGEST_V2_SOURCES_ENABLED = 'false';
  try { await assert.rejects(service.prepareDigestSources(userId, run.runId, input(), collector), /DIGEST_SOURCES_DISABLED/); } finally { process.env.DIGEST_V2_SOURCES_ENABLED = 'true'; }
  await assert.rejects(mcp.callTool({ userId, clientId: 'test', resource: 'https://example.com/mcp', scopes: ['daily_report:read_context'] }, 'daily_report.prepare_sources_v2', { runId: run.runId, newsletters: input() }), /scope|授权|权限/i);
  const rpc = await mcp.handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { userId: 'sources-other', clientId: 'test', resource: 'https://example.com/mcp', scopes: [] });
  assert.ok(!(rpc as any).result.tools.some((tool: any) => tool.name === 'daily_report.prepare_sources_v2'));
  assert.equal(calls, 0);
});

test('expired source snapshot is unreadable, export strips it, and restoring backup cannot revive excerpts', async () => {
  const expired = { id: 'expired-source-run', user_id: userId, report_date: '2026-10-06', snapshot_json: JSON.stringify({ ...snap(), sources: { privateExcerpt: 'expired synthetic excerpt' } }), manifest_json: '{}', created_at: '2026-09-01T00:00:00Z', expires_at: '2026-09-08T00:00:00Z' };
  activity.createDigestRun(expired);
  await assert.rejects(service.prepareDigestSources(userId, expired.id, input(), emptyAiHot), /SNAPSHOT_EXPIRED/);
  assert.equal(activity.getDigestRun(userId, expired.id)!.snapshot_json, null);
  assert.equal((activity.exportUserActivity(userId).digestV2Runs as any[]).find(row => row.id === expired.id).snapshot_json, null);
  activity.restoreUserActivity('sources-other', { digestV2Runs: [{ ...expired, id: 'restored-expired-source-run' }] }, 'merge');
  assert.equal(activity.getDigestRun('sources-other', 'restored-expired-source-run')!.snapshot_json, null);
  assert.ok(activity.expireDigestSnapshots() >= 1);
});

test('publication/visual preparation closes source ingestion, including an await-boundary race', async () => {
  const run = service.createDigestSnapshotRun(userId, snap()); let calls = 0;
  activity.updateDigestRunManifest(userId, run.runId, { ...run.manifest, preparedVisuals: [{ id: 'prepared' }] });
  await assert.rejects(service.prepareDigestSources(userId, run.runId, input(), async () => { calls++; return emptyAiHot(); }), /SOURCE_STAGE_CLOSED/);
  assert.equal(calls, 0);
  const racing = service.createDigestSnapshotRun(userId, snap());
  await assert.rejects(service.prepareDigestSources(userId, racing.runId, input(), async () => {
    activity.updateDigestRunManifest(userId, racing.runId, { ...racing.manifest, status: 'MEDIA_PREPARING' }); return emptyAiHot();
  }), /SOURCE_STAGE_CLOSED/);
  assert.equal(JSON.parse(activity.getDigestRun(userId, racing.runId)!.snapshot_json!).sources, undefined);
});

test('further reading is optional, limited, cited, escaped, rendered in all formats and frozen for legacy', () => {
  const d = digest(); assert.equal(validateDigestV2(d).valid, true);
  d.further_reading = [{ id: 'reading-1', title: '<script>参考文章</script>', reason: '**市场预期**与事实的关系值得继续阅读。', evidence_ids: ['ref-1'] }];
  d.evidence = [{ id: 'ref-1', url: 'https://example.com/reading', source: '参考来源', published_at: '' }];
  assert.equal(validateDigestV2(d).valid, true);
  const publication = { digest: d, media: [], warnings: [], renderer: DIGEST_V2_GENERATION };
  d.evidence.unshift({ id: 'supporting', url: 'https://example.com/supporting', source: '补充来源', published_at: '' });
  d.further_reading[0].evidence_ids = ['ref-1', 'supporting'];
  for (const email of [true, false]) {
    const html = renderDigestV2(publication, email); assert.match(html, /拓展阅读/); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('href="https://example.com/reading"')); assert.match(html, /参考来源 · 发布时间：时间未知/);
    assert.match(html, /<a href="https:\/\/example.com\/reading"[^>]*>&lt;script&gt;参考文章&lt;\/script&gt;<\/a>/);
  }
  assert.match(digestV2Text(publication), /拓展阅读/); assert.match(digestV2Text(publication), /参考来源.*https:\/\/example.com\/reading/);
  assert.ok(decodeDigestPublication(encodeDigestPublication(publication)));
  d.evidence.find(item => item.id === 'ref-1')!.url = 'https://e.customeriomail.com/e/c/private-tracker';
  assert.ok(validateDigestV2(d).errors.some(issue => issue.code === 'PRIVATE_SOURCE_URL'));
  d.evidence.find(item => item.id === 'ref-1')!.url = 'https://example.com/reading';
  d.further_reading[0].evidence_ids = []; assert.ok(validateDigestV2(d).errors.some(issue => issue.code === 'EVIDENCE_REQUIRED'));
  d.further_reading[0].evidence_ids = ['missing']; assert.ok(validateDigestV2(d).errors.some(issue => issue.code === 'EVIDENCE_NOT_FOUND'));
  d.further_reading = Array(4).fill({ id: 'reading', title: '标题', reason: '原因', evidence_ids: ['ref-1'] }); assert.ok(validateDigestV2(d).errors.some(issue => issue.code === 'TOO_MANY'));
  delete d.further_reading;
  const old = { ...publication, digest: d, renderer: '2026-09-28.1' }; const encoded = encodeDigestPublication(old);
  assert.ok(decodeDigestPublication(encoded)); assert.equal(encodeDigestPublication(decodeDigestPublication(encoded)!), encoded);
  assert.ok(!renderDigestV2(old).includes('拓展阅读'));
  d.watchlist = [{ input_id: 'watch', summary: '已检查', check: 'complete', change: 'unknown', evidence_ids: [] }];
  assert.ok(validateDigestV2(d, undefined, '2026-09-28.1').errors.some(issue => issue.code === 'CHECK_EVIDENCE_REQUIRED'));
  d.further_reading = []; assert.ok(validateDigestV2(d, undefined, '2026-09-28.1').errors.some(issue => issue.code === 'UNKNOWN_FIELD'));
});

test.after(() => { /* Isolated evidence remains in OS temp; background jobs were never started. */ });
