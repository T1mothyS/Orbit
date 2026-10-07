import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import test from 'node:test';
import { createAuth } from './auth.js';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-context-api-'));
process.env.DATA_DIR = directory;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.DIGEST_V2_ENABLED = 'true';
const db = await import('./db.js');
const schedule = await import('./schedule-store.js');
const reminder = await import('./reminder-store.js');
const activity = await import('./activity-store.js');
const cloud = await import('./daily-report-cloud-store.js');
const digest = await import('./digest-v2-service.js');
const backups = await import('./backup-service.js');
const { createReportsPolicyRouter } = await import('./routes/reports-policy.js');
await db.initDb(); await schedule.initScheduleDb(); await reminder.initReminderDb(); await activity.initActivityDb();
const auth = createAuth({ secret: 'synthetic-context-api-secret', getUserById: db.getUserById });
const now = '2026-10-07T00:00:00.000Z';
const users = ['owner', 'other'].map(id => db.createUser({ id, email: `${id}@example.invalid`, password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now }));
function fixture() { return { profile: { identity: { language: 'zh-CN', timezone: 'Asia/Shanghai' }, background: { career_context: '合成背景' } },
  preferences: { prefer: ['保留证据'], avoid: [], target_reading_time_minutes: 10, evidence_policy: ['来源核验'] },
  recent_interests: { topics: [{ topic: '合成主题', priority: 'high', recency: '近期', keywords: ['合成'] }] },
  watchlist: { sectors: [], companies: [], stocks: [{ name: '合成标的', symbol: 'TEST', priority: 'high', sectors: [], thesis_file: 'theses/test.yaml' }] },
  theses: { test: { symbol: 'TEST', status: 'active', priority: 'high', thesis: { one_liner: '合成框架' }, monitor: { earnings: ['指标'] } } },
  extension: { keep: true } }; }

test('authenticated versioned edits are isolated, preserve all groups, enter Cloud input and encrypted backup without delivery or Thesis side effects', async () => {
  const app = express(); app.use(express.json({ limit: '10mb' })); app.use(createReportsPolicyRouter({ authenticate: auth.authenticate }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const request = (id: number, body?: unknown) => fetch(base + '/api/daily-report/cloud-context', { method: body ? 'PUT' : 'GET', headers: { Authorization: `Bearer ${auth.signUserToken(users[id])}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await fetch(base + '/api/daily-report/cloud-context')).status, 401);
    let response = await request(0); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).context.version, 0);
    response = await request(0, { context: fixture(), expectedVersion: 0 }); assert.equal(response.status, 200);
    const first = await response.json(); assert.equal(first.context.version, 1); assert.deepEqual(first.inputWarnings, []);
    assert.equal((await (await request(1)).json()).context.version, 0);
    const updated = fixture(); updated.preferences.prefer = ['新增偏好'];
    response = await request(0, { context: updated, expectedVersion: 1 }); assert.equal(response.status, 200);
    response = await request(0, { context: fixture(), expectedVersion: 1 }); assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CONTEXT_VERSION_CONFLICT');
    const current = cloud.getDailyReportCloudContext('owner'); assert.equal(current.version, 2); assert.deepEqual(current.context.extension, { keep: true });
    const run = await digest.readDigestV2Inputs('owner', '2026-10-07');
    assert.deepEqual(run.context, updated); assert.equal(run.snapshot.contextVersion, 2);
    assert.equal(run.snapshot.watchlist.status, 'complete'); assert.equal(run.snapshot.watchlist.items.length, 1);
    assert.match(run.snapshot.watchlist.items[0].detail, /合成框架/);
    assert.equal(activity.listAllDailyReports('owner').length, 0); assert.equal(activity.listDigestArtifacts('owner').length, 0);
    const backup = backups.createUserBackup('owner', 'synthetic-backup-password');
    const payload = backups.decryptBackup<any>(backup, 'synthetic-backup-password');
    assert.deepEqual(payload.dailyReportCloudContext.context, updated);
    assert.equal(payload.activity.notifications.length, 0);
    assert.deepEqual(payload.activity.thesisVersions, []);
    cloud.replaceDailyReportCloudContext('owner', { preferences: { prefer: ['changed'] } });
    backups.restoreUserBackup('owner', backup, 'synthetic-backup-password', 'replace');
    assert.deepEqual(cloud.getDailyReportCloudContext('owner').context, updated);
    // Existing import calls remain supported without a version.
    assert.equal((await request(1, { context: { preferences: { focus: ['legacy'] } } })).status, 200);
    for (const body of [{ context: {}, expectedVersion: null }, { context: {}, userId: 'other' }, { context: { preferences: { prefer: 'wrong' } }, expectedVersion: cloud.getDailyReportCloudContext('owner').version },
      { context: { api_token: 'synthetic' } }, { context: JSON.parse('{"__proto__": {"flag": true}}') }, { context: { localFile: 'C:\\private\\file' } }, { context: { localFile: 'C:/private/file' } }, { context: { text: 'x'.repeat(20001) } }, { context: { items: Array.from({ length: 11 }, () => 'x'.repeat(20000)) } }]) assert.equal((await request(0, body)).status, 400);
    db.upsertDailyReportCloudContext('other', '{broken');
    response = await request(1, { context: {}, expectedVersion: 2 }); assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CONTEXT_READ_FAILED');
    assert.equal(db.getDailyReportCloudContext('other')?.context_json, '{broken');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('disk failure rolls back both memory and file; retry uses the same saved version', t => {
  const before = cloud.getDailyReportCloudContext('owner');
  const bytes = fs.readFileSync(path.join(directory, 'chat.db'));
  const rename = fs.renameSync;
  let failed = false;
  const mocked = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (!failed && String(to) === path.join(directory, 'chat.db')) { failed = true; throw new Error('synthetic disk failure'); }
    return rename(from, to);
  });
  assert.throws(() => cloud.saveDailyReportCloudContext('owner', fixture(), before.version), /synthetic disk failure/);
  mocked.mock.restore();
  assert.deepEqual(cloud.getDailyReportCloudContext('owner'), before);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'chat.db')), bytes);
  assert.equal(cloud.saveDailyReportCloudContext('owner', fixture(), before.version).version, before.version + 1);
});
