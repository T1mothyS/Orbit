import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { recordReviewedV3Source, renderLocalDigestV3Preview } from './digest-v3-local-flow.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v3-local-flow-'));
process.env.DATA_DIR = root;
const SQL = await initSqlJs();
const legacy = new SQL.Database();
legacy.run(`
  CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO schema_meta VALUES ('version', '3');
  CREATE TABLE daily_reports (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, report_date TEXT NOT NULL,
    source TEXT NOT NULL, delivery_status TEXT NOT NULL, markdown TEXT NOT NULL,
    content_hash TEXT NOT NULL, published_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    email_notification_id TEXT
  );
  INSERT INTO daily_reports VALUES
    ('old-report', 'fixture-user', '2022-11-16', 'cloud', 'candidate',
     'old body', 'old-hash', '2022-11-16T00:00:00.000Z', '2022-11-16T00:00:00.000Z', NULL);
  CREATE TABLE digest_v2_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, report_date TEXT NOT NULL,
    snapshot_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
`);
fs.writeFileSync(path.join(root, 'activity.db'), legacy.export());
legacy.close();
const activity = await import('./activity-store.js');
const store = activity.digestV3Store;
const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'daily-digest-v3-s2-01-cases.json'), 'utf8'));
const p01 = cases.pairs.find((item: { id: string }) => item.id === 'P01');
const [launch, splashdown] = p01.sources;
const userId = 'fixture-user';
const time = '2026-09-27T04:00:00.000Z';
const clock = () => new Date(time);
const cutoff = time;

function input(source: any, requestKey: string, value: string, body: string, expectedRevisionId?: string) {
  return {
    requestKey, cutoff, eventId: 'artemis-i-flight',
    ...(expectedRevisionId ? { expectedRevisionId } : { event: {
      eventType: 'mission', subjectKey: 'nasa:artemis-i', occurrenceKey: 'flight:artemis-i', title: 'Artemis I 任务进展',
    } }),
    source: { url: source.url, publisherKey: 'nasa', documentType: 'mission_blog', language: 'en',
      sourceFact: source.fact, publishedAt: source.publishedAt, publishedPrecision: source.precision,
      independenceKey: requestKey },
    fact: { factKey: 'mission_milestone', value, unit: null, scope: 'artemis-i-flight' },
    analysis: { body },
  };
}

test('D07 legacy migration to reviewed evidence, immutable progress and exact local previews', async () => {
  await activity.initActivityDb();
  assert.equal(activity.getLatestDailyReportCandidate(userId, '2022-11-16', 'cloud')?.markdown, 'old body');
  const firstInput = input(launch, 'P01-A', 'liftoff', 'NASA <b>首次</b>确认发射，下一步应关注任务结果。');
  const first = recordReviewedV3Source(store, userId, firstInput, clock);
  assert.equal(first.status, 'created');
  const before = renderLocalDigestV3Preview(store, userId, { ...first, cutoff });
  assert.match(before, /liftoff/);
  assert.match(before, /Artemis I 任务进展/);
  assert.match(before, /本地隔离/);
  assert.match(before, /nasa\.gov/);
  assert.match(before, /&lt;b&gt;首次&lt;\/b&gt;/);
  assert.doesNotMatch(before, /<b>首次<\/b>/);
  assert.equal(recordReviewedV3Source(store, userId, firstInput, clock).status, 'existing');
  assert.equal(activity.exportUserActivity(userId).digestV3Evidence.length, 1);

  const secondInput = input(splashdown, 'P01-B', 'splashdown', 'Orion 已溅落，同一任务出现新进展，日报应交代相对发射时新增的事实。', first.revisionId);
  const second = recordReviewedV3Source(store, userId, secondInput, clock);
  const after = renderLocalDigestV3Preview(store, userId, { ...second, cutoff });
  assert.match(after, /上次记录/);
  assert.match(after, /liftoff/);
  assert.match(after, /splashdown/);
  assert.match(after, /Orion 已溅落/);
  assert.equal((after.match(/查看来源/g) ?? []).length, 2);
  assert.equal(renderLocalDigestV3Preview(store, userId, { ...first, cutoff }), before);
  assert.equal(store.getEvent(userId, first.eventId)?.currentRevisionId, second.revisionId);
  assert.deepEqual(store.getAnalysis(userId, second.analysisId)?.comparedRevisionIds, [first.revisionId]);
  assert.equal(recordReviewedV3Source(store, userId, secondInput, clock).status, 'existing');

  const backup = activity.exportUserActivity(userId);
  assert.equal(backup.digestV3Events.length, 1);
  assert.equal(backup.digestV3Revisions.length, 2);
  assert.equal(backup.digestV3Evidence.length, 2);
  assert.equal(backup.digestV3Analyses.length, 2);
  assert.equal(backup.dailyReports.length, 1, 'the legacy report remains unchanged');
  assert.equal(backup.digestV2Artifacts.length, 0, 'no Shadow or formal digest was created');
  assert.equal(backup.notifications.length, 0, 'no mail or reminder was queued');
  activity.restoreUserActivity(userId, backup, 'replace');
  assert.equal(renderLocalDigestV3Preview(store, userId, { ...second, cutoff }), after);
  assert.equal(activity.getLatestDailyReportCandidate(userId, '2022-11-16', 'cloud')?.markdown, 'old body');
});

test('D07 rejects unsafe source, cutoff, stale revision, cross-account and changed retry', () => {
  const valid = input(launch, 'P01-A', 'liftoff', 'NASA <b>首次</b>确认发射，下一步应关注任务结果。');
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, source: { ...valid.source, url: 'http://127.0.0.1/private' } }, clock), /URL/);
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, source: { ...valid.source, publishedAt: '2026-09-28T00:00:00Z', publishedPrecision: 'second' } }, clock), /晚于截点/);
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, source: { ...valid.source, publishedAt: '2026-09-27', publishedPrecision: 'date' } }, clock), /不能证明早于截点/);
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, source: { ...valid.source, publishedAt: '2026-02-30', publishedPrecision: 'date' } }, clock), /不能证明早于截点/);
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, analysis: { body: 'password=abcdefghijk' } }, clock), /文本无效/);
  assert.throws(() => recordReviewedV3Source(store, userId, { ...valid, analysis: { body: '改变既有解释' } }, clock), /幂等键/);
  const stale = input(splashdown, 'P01-stale', 'splashdown', '错误的前版', 'missing-revision');
  assert.throws(() => recordReviewedV3Source(store, userId, stale, clock), /版本冲突/);
  const stored = activity.exportUserActivity(userId);
  assert.equal(stored.digestV3Evidence.length, 2);
  const refs = { eventId: 'artemis-i-flight', revisionId: (stored.digestV3Revisions[0] as { id: string }).id,
    analysisId: (stored.digestV3Analyses[0] as { id: string }).id, cutoff };
  assert.throws(() => renderLocalDigestV3Preview(store, 'other-user', refs), /引用无效/);
  assert.throws(() => renderLocalDigestV3Preview(store, userId, { ...refs, cutoff: '2022-11-16T00:00:00Z' }), /晚于截点/);
});

test('D07 whole reviewed chain rolls back when activity.db cannot persist', t => {
  const before = activity.exportActivityDb();
  const disk = fs.readFileSync(path.join(root, 'activity.db'));
  const original = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === path.join(root, 'activity.db')) throw new Error('D07_FAULT');
    return original(from, to);
  });
  try {
    assert.throws(() => recordReviewedV3Source(store, userId, input(
      { ...launch, url: 'https://www.nasa.gov/news-release/nasa-shares-orion-heat-shield-findings-updates-artemis-moon-missions/' },
      'fault-chain', 'new source', '仅测试持久化回滚。', store.getEvent(userId, 'artemis-i-flight')!.currentRevisionId,
    ), clock), /D07_FAULT/);
  } finally { mock.mock.restore(); }
  assert.deepEqual(activity.exportActivityDb(), before);
  assert.deepEqual(fs.readFileSync(path.join(root, 'activity.db')), disk);
  assert.equal(activity.exportUserActivity(userId).digestV3Evidence.length, 2);
});
