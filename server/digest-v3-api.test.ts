import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v3-api-'));
process.env.DATA_DIR = root;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.JWT_SECRET = 'digest-v3-api-synthetic-test-secret';

const api = await import('./index.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
await api.initializeServer();
const createdAt = new Date().toISOString();
const alice = db.createUser({ id: 'v3-api-alice', email: 'v3-api-alice@example.test', password_hash: 'synthetic',
  role: 'user', disabled: 0, created_at: createdAt, updated_at: createdAt });
const bob = db.createUser({ id: 'v3-api-bob', email: 'v3-api-bob@example.test', password_hash: 'synthetic',
  role: 'user', disabled: 0, created_at: createdAt, updated_at: createdAt });
const aliceToken = api.signUserToken(alice);
const bobToken = api.signUserToken(bob);
const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'daily-digest-v3-s2-01-cases.json'), 'utf8'));
const [launch, splashdown] = cases.pairs.find((item: { id: string }) => item.id === 'P01').sources;

function reviewed(source: any, key: string, value: string, body: string, expectedRevisionId?: string) {
  return {
    requestKey: key, cutoff: new Date().toISOString(), eventId: 'artemis-i-flight',
    ...(expectedRevisionId ? { expectedRevisionId } : { event: {
      eventType: 'mission', subjectKey: 'nasa:artemis-i', occurrenceKey: 'flight:artemis-i', title: 'Artemis I 任务进展',
    } }),
    source: { url: source.url, publisherKey: 'nasa', documentType: 'mission_blog', language: 'en',
      sourceFact: source.fact, publishedAt: source.publishedAt, publishedPrecision: source.precision,
      independenceKey: key },
    fact: { factKey: 'mission_milestone', value, unit: null, scope: 'artemis-i-flight' },
    analysis: { body },
  };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('合成服务器没有端口'));
      resolve(address.port);
    });
  });
}

test('D07 login API keeps reviewed P01 history, exact previews, conflicts and restore isolated', async t => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/api/digest-v3`;
  const request = (pathName: string, token?: string, body?: unknown) => fetch(base + pathName, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const submit = (token: string, submission: unknown, confirmReviewed = true) => request('/reviewed-sources', token,
    { confirmReviewed, submission });
  const historyPath = (cutoff: string, suffix = '') =>
    `/events/artemis-i-flight/history?cutoff=${encodeURIComponent(cutoff)}${suffix}`;
  const eventsPath = (cutoff: string, suffix = '') =>
    `/events?cutoff=${encodeURIComponent(cutoff)}${suffix}`;
  const previewPath = (revisionId: string, analysisId: string, cutoff: string) =>
    `/events/artemis-i-flight/preview?revisionId=${revisionId}&analysisId=${analysisId}&cutoff=${encodeURIComponent(cutoff)}`;
  try {
    const firstInput = reviewed(launch, 'P01-A', 'liftoff', 'NASA 确认 Artemis I 发射。');
    assert.equal((await request('/reviewed-sources', undefined, { confirmReviewed: true, submission: firstInput })).status, 401);
    assert.equal((await submit(aliceToken, firstInput, false)).status, 400);
    assert.equal((await request('/reviewed-sources', aliceToken,
      { confirmReviewed: true, submission: firstInput, userId: bob.id })).status, 400);
    const firstResponse = await submit(aliceToken, firstInput);
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json() as any;
    const firstRecordedAt = activity.digestV3Store.getRevision(alice.id, first.revisionId)!.recordedAt;
    assert.equal((await submit(aliceToken, firstInput)).status, 200);
    assert.equal((await submit(aliceToken, { ...firstInput, analysis: { body: '同键变更分析内容' } })).status, 409);
    assert.equal((await submit(aliceToken, { ...firstInput, fact: { ...firstInput.fact, value: 'changed' } })).status, 409);
    assert.equal((await submit(aliceToken, { ...firstInput, requestKey: 'bad-url',
      source: { ...firstInput.source, url: 'http://127.0.0.1/private' } })).status, 400);

    while (Date.now() <= Date.parse(firstRecordedAt)) await new Promise(resolve => setTimeout(resolve, 2));
    const secondInput = reviewed(splashdown, 'P01-B', 'splashdown', 'Orion 溅落，是同一任务的新进展。', first.revisionId);
    const secondResponse = await submit(aliceToken, secondInput);
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json() as any;
    const laterCutoff = new Date().toISOString();
    const earlierEvents = await (await request(eventsPath(firstRecordedAt), aliceToken)).json() as any;
    assert.equal(earlierEvents.total, 1);
    assert.equal(earlierEvents.events[0].latestRevisionIdAtCutoff, first.revisionId);
    const laterEvents = await (await request(eventsPath(laterCutoff), aliceToken)).json() as any;
    assert.equal(laterEvents.events[0].latestRevisionIdAtCutoff, second.revisionId);
    assert.equal((await (await request(eventsPath(laterCutoff), bobToken)).json() as any).total, 0);
    assert.equal((await (await request(eventsPath(laterCutoff, '&offset=1'), aliceToken)).json() as any).events.length, 0);
    const earlier = await (await request(historyPath(firstRecordedAt), aliceToken)).json() as any;
    assert.equal(earlier.latestRevisionIdAtCutoff, first.revisionId);
    assert.equal(earlier.total, 1);
    assert.equal(earlier.history[0].revision.facts[0].value, 'liftoff');
    assert.equal(earlier.history[0].evidence[0].url, launch.url);
    assert.equal(earlier.history[0].analyses[0].id, first.analysisId);
    assert.equal(earlier.event.currentRevisionId, undefined, 'historical result must not leak the live pointer');
    const latest = await (await request(historyPath(laterCutoff, '&limit=1&offset=0'), aliceToken)).json() as any;
    assert.equal(latest.total, 2);
    assert.equal(latest.history.length, 1);
    assert.equal(latest.latestRevisionIdAtCutoff, second.revisionId);
    assert.equal(latest.history[0].revision.previousRevisionId, first.revisionId);
    assert.equal((await request(historyPath(laterCutoff, '&limit=101'), aliceToken)).status, 400);
    assert.equal((await request(historyPath(laterCutoff, '&extra=1'), aliceToken)).status, 400);
    assert.equal((await request(historyPath(laterCutoff), bobToken)).status, 404);
    assert.equal((await request(historyPath('2020-01-01T00:00:00Z'), aliceToken)).status, 404);

    const firstPreview = await (await request(previewPath(first.revisionId, first.analysisId, laterCutoff), aliceToken)).text();
    const secondPreview = await (await request(previewPath(second.revisionId, second.analysisId, laterCutoff), aliceToken)).text();
    assert.match(firstPreview, /liftoff/);
    assert.doesNotMatch(firstPreview, /splashdown/);
    assert.match(secondPreview, /liftoff/);
    assert.match(secondPreview, /splashdown/);
    assert.equal((await request(previewPath(second.revisionId, first.analysisId, laterCutoff), aliceToken)).status, 404);
    assert.equal((await request(previewPath(first.revisionId, first.analysisId, laterCutoff), bobToken)).status, 404);
    assert.equal((await submit(bobToken, reviewed(splashdown, 'bob-progress', 'splashdown', '跨账号前版', first.revisionId))).status, 409);
    assert.equal((await submit(aliceToken, reviewed(splashdown, 'stale-progress', 'splashdown', '旧版本前版', first.revisionId))).status, 409);
    assert.equal((await submit(aliceToken, secondInput)).status, 200);
    assert.equal(activity.exportUserActivity(alice.id).digestV3Revisions.length, 2);

    const backup = activity.exportUserActivity(alice.id);
    activity.restoreUserActivity(alice.id, backup, 'replace');
    assert.equal((await (await request(previewPath(first.revisionId, first.analysisId, laterCutoff), aliceToken)).text()), firstPreview);
    assert.equal((await (await request(historyPath(new Date().toISOString()), aliceToken)).json() as any).total, 2);
    assert.equal(backup.dailyReports.length, 0);
    assert.equal(backup.notifications.length, 0);

    const faultInput = reviewed(splashdown, 'P01-C', 'post-restore-check', '检查持久化失败重试。', second.revisionId);
    const originalRename = fs.renameSync;
    let failed = false;
    const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      if (!failed && String(to) === path.join(root, 'activity.db')) {
        failed = true;
        throw new Error('SYNTHETIC_V3_DISK_FAILURE');
      }
      return originalRename(from, to);
    });
    try { assert.equal((await submit(aliceToken, faultInput)).status, 500); }
    finally { mock.mock.restore(); }
    assert.ok(failed);
    assert.equal(activity.exportUserActivity(alice.id).digestV3Revisions.length, 2);
    assert.equal((await submit(aliceToken, faultInput)).status, 201);
    assert.equal((await submit(aliceToken, faultInput)).status, 200);
    assert.equal(activity.exportUserActivity(alice.id).digestV3Revisions.length, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test.after(() => {
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, { recursive: true, force: true });
});
