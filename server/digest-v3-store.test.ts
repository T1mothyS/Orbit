import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import type { DigestV3Analysis, DigestV3Event, DigestV3Evidence, DigestV3Revision } from './digest-v3-store.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v3-store-'));
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
    ('legacy-report', 'legacy-user', '2026-09-23', 'cloud', 'candidate',
     'legacy body', 'legacy-hash', '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', NULL);
  CREATE TABLE digest_v2_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, report_date TEXT NOT NULL,
    snapshot_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  INSERT INTO digest_v2_runs VALUES
    ('legacy-run', 'legacy-user', '2026-09-23', NULL, '{}',
     '2026-09-23T00:00:00.000Z', '2026-09-24T00:00:00.000Z');
`);
fs.writeFileSync(path.join(root, 'activity.db'), legacy.export());
legacy.close();
const activity = await import('./activity-store.js');
const store = activity.digestV3Store;
const now = '2026-09-24T02:00:00.000Z';

function sqlValue(sql: string): unknown {
  const db = new SQL.Database(activity.exportActivityDb());
  try {
    const statement = db.prepare(sql);
    try { return statement.step() ? Object.values(statement.getAsObject())[0] : null; }
    finally { statement.free(); }
  } finally { db.close(); }
}

function evidence(userId: string, id: string): DigestV3Evidence {
  return {
    id, userId, url: `https://example.org/${id}`, publisherKey: 'example',
    documentType: 'release', language: 'en', sourceFact: `${userId} source fact`,
    publishedAt: '2026-09-24', publishedPrecision: 'date', retrievedAt: now,
    independenceKey: id, reviewState: 'verified',
  };
}

function event(userId: string, revisionId: string): DigestV3Event {
  return {
    id: 'shared-event', userId, eventType: 'mission', subjectKey: 'mission-1',
    occurrenceKey: 'flight-1', title: `${userId} event`, lifecycle: 'active',
    currentRevisionId: revisionId, createdAt: now,
  };
}

function revision(userId: string, id: string, evidenceId: string): DigestV3Revision {
  return {
    id, userId, eventId: 'shared-event', revisionNo: 1,
    previousRevisionId: null, changeKind: 'initial',
    facts: [{ factKey: 'launch', value: 'complete', unit: null, scope: 'mission-1', evidenceIds: [evidenceId] }],
    evidenceIds: [evidenceId], recordedAt: now,
  };
}

test('S2-03 migrates an old activity.db additively and is repeatable', async () => {
  await activity.initActivityDb();
  assert.equal(sqlValue("SELECT value FROM schema_meta WHERE key = 'version'"), '4');
  assert.equal(sqlValue("SELECT value FROM schema_meta WHERE key = 'digest_v3'"), '1');
  assert.equal(activity.getLatestDailyReportCandidate('legacy-user', '2026-09-23', 'cloud')?.markdown, 'legacy body');
  assert.equal(activity.getDigestRun('legacy-user', 'legacy-run')?.id, 'legacy-run');
  assert.equal(sqlValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'digest_v3_%'"), 7);
  await activity.initActivityDb();
  assert.equal(activity.getLatestDailyReportCandidate('legacy-user', '2026-09-23', 'cloud')?.contentHash, 'legacy-hash');
  assert.equal(sqlValue("SELECT count(*) FROM digest_v3_events"), 0);
});

test('S2-03 persists four entities, immutable versions and same-account references', async () => {
  store.addEvidence(evidence('alice', 'shared-evidence'));
  store.addEvidence(evidence('bob', 'shared-evidence'));
  store.addEvidence(evidence('alice', 'alice-only'));
  assert.equal(store.getEvidence('alice', 'shared-evidence')?.sourceFact, 'alice source fact');
  assert.equal(store.getEvidence('bob', 'shared-evidence')?.sourceFact, 'bob source fact');
  assert.equal(store.getEvidence('bob', 'alice-only'), null);

  const beforeInvalid = activity.exportActivityDb();
  assert.throws(() => store.addEvidence({ ...evidence('bob', 'bad-translation'),
    relatedEvidenceId: 'alice-only', relation: 'translation' }), /FOREIGN KEY/);
  assert.deepEqual(activity.exportActivityDb(), beforeInvalid);

  store.createEvent(event('alice', 'alice-r1'), revision('alice', 'alice-r1', 'shared-evidence'));
  store.createEvent(event('bob', 'bob-r1'), revision('bob', 'bob-r1', 'shared-evidence'));
  store.addEvidence({ ...evidence('alice', 'alice-translation'),
    sourceDocumentKey: 'release-1', relatedEvidenceId: 'shared-evidence',
    relation: 'translation', linkedRevisionId: 'alice-r1',
    independenceKey: 'shared-evidence' });
  assert.equal(store.getEvent('alice', 'shared-event')?.title, 'alice event');
  assert.equal(store.getEvent('bob', 'shared-event')?.title, 'bob event');
  assert.equal(store.getRevision('alice', 'bob-r1'), null);
  assert.equal(store.getRevision('bob', 'alice-r1'), null);

  const invalidRevision = { ...revision('bob', 'bob-r2', 'alice-only'), revisionNo: 2,
    previousRevisionId: 'bob-r1', changeKind: 'progress' as const };
  assert.throws(() => store.appendRevision(invalidRevision), /FOREIGN KEY/);
  assert.equal(store.getEvent('bob', 'shared-event')?.currentRevisionId, 'bob-r1');
  assert.equal(store.getRevision('bob', 'bob-r2'), null);

  store.appendRevision({ ...revision('alice', 'alice-r2', 'alice-only'),
    revisionNo: 2, previousRevisionId: 'alice-r1', changeKind: 'progress' });
  assert.equal(store.getEvent('alice', 'shared-event')?.currentRevisionId, 'alice-r2');
  assert.equal(store.getRevision('alice', 'alice-r1')?.revisionNo, 1);
  assert.equal(store.getRevision('alice', 'alice-r2')?.evidenceIds[0], 'alice-only');
  assert.throws(() => store.appendRevision({ ...revision('alice', 'alice-r3', 'alice-only'),
    revisionNo: 3, previousRevisionId: 'alice-r1', changeKind: 'progress' }), /版本冲突/);

  const analysis: DigestV3Analysis = {
    id: 'alice-analysis', userId: 'alice', eventRevisionId: 'alice-r2',
    evidenceIds: ['alice-only'], comparedRevisionIds: ['alice-r1'],
    analysisKind: 'change_assessment', body: 'The tracked value changed.',
    authorKind: 'ai', recordedAt: now, factKey: 'launch', scope: 'mission-1',
    check: 'complete', assessment: 'material',
  };
  store.addAnalysis(analysis);
  assert.deepEqual(store.getAnalysis('alice', analysis.id)?.comparedRevisionIds, ['alice-r1']);
  assert.equal(store.getAnalysis('bob', analysis.id), null);
  assert.throws(() => store.addAnalysis({ ...analysis, id: 'cross-analysis',
    comparedRevisionIds: ['bob-r1'] }), /FOREIGN KEY/);
  assert.equal(store.getAnalysis('alice', 'cross-analysis'), null);
  assert.throws(() => store.addAnalysis({ ...analysis, id: 'incomplete-no-change',
    check: 'incomplete', assessment: 'no_material_change' }), /CHECK constraint/);

  const exported = new SQL.Database(activity.exportActivityDb());
  try {
    assert.throws(() => exported.run("UPDATE digest_v3_revisions SET facts_json = '[]' WHERE id = 'alice-r1'"), /immutable/);
    assert.throws(() => exported.run("UPDATE digest_v3_evidence SET source_fact = 'changed' WHERE id = 'alice-only'"), /immutable/);
    assert.throws(() => exported.run("UPDATE digest_v3_analyses SET body = 'changed' WHERE id = 'alice-analysis'"), /immutable/);
  } finally { exported.close(); }

  await activity.initActivityDb();
  assert.equal(store.getEvent('alice', 'shared-event')?.currentRevisionId, 'alice-r2');
  assert.equal(store.getAnalysis('alice', analysis.id)?.body, analysis.body);
  assert.equal(activity.getLatestDailyReportCandidate('legacy-user', '2026-09-23', 'cloud')?.markdown, 'legacy body');
});

test('S2-03 restores memory and disk when a V3 write cannot persist', t => {
  const before = activity.exportActivityDb();
  const onDisk = fs.readFileSync(path.join(root, 'activity.db'));
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === path.join(root, 'activity.db')) throw new Error('synthetic V3 write failure');
    return rename(from, to);
  });
  assert.throws(() => store.addEvidence(evidence('alice', 'failed-write')), /synthetic V3 write failure/);
  mock.mock.restore();
  assert.deepEqual(activity.exportActivityDb(), before);
  assert.deepEqual(fs.readFileSync(path.join(root, 'activity.db')), onDisk);
  assert.equal(store.getEvidence('alice', 'failed-write'), null);
});

test('S2-04 exports V3 rows and protects them from old replace backups', () => {
  const exported = activity.exportUserActivity('alice');
  assert.equal(exported.digestV3Events.length, 1);
  assert.equal(exported.digestV3Revisions.length, 2);
  assert.equal(exported.digestV3Evidence.length, 3);
  assert.equal(exported.digestV3Analyses.length, 1);
  assert.throws(() => activity.restoreUserActivity('alice', {}, 'replace'), /旧备份不含 V3/);
  assert.equal(store.getEvent('alice', 'shared-event')?.currentRevisionId, 'alice-r2');
  activity.restoreUserActivity('alice', exported, 'merge');
  assert.equal(activity.exportUserActivity('alice').digestV3Revisions.length, 2);
  activity.deleteUserActivity('alice');
  assert.equal(store.hasUserData('alice'), false);
  assert.equal(store.getEvent('alice', 'shared-event'), null);
  assert.equal(store.getEvent('bob', 'shared-event')?.currentRevisionId, 'bob-r1');
  assert.equal(store.getEvidence('bob', 'shared-evidence')?.sourceFact, 'bob source fact');
  assert.equal(activity.exportUserActivity('alice').dailyReports.length, 0);
});
