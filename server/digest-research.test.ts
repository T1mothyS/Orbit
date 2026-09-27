import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-research-'));
process.env.DATA_DIR = root;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.JWT_SECRET = 'digest-research-synthetic-test-secret';

const api = await import('./index.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
const backups = await import('./backup-service.js');
await api.initializeServer();
const now = '2026-09-27T01:00:00.000Z';
const alice = db.createUser({ id: 'research-alice', email: 'research-alice@example.test', password_hash: 'synthetic',
  role: 'user', disabled: 0, created_at: now, updated_at: now });
const bob = db.createUser({ id: 'research-bob', email: 'research-bob@example.test', password_hash: 'synthetic',
  role: 'user', disabled: 0, created_at: now, updated_at: now });
const aliceToken = api.signUserToken(alice);
const bobToken = api.signUserToken(bob);
const store = activity.digestResearchStore;

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

test('D13 keeps research history, draft proposals and user-confirmed thesis versions isolated', () => {
  const aliceId = alice.id;
  const bobId = bob.id;
  activity.digestV3Store.addEvidence({ id: 'research-evidence', userId: aliceId,
    url: 'https://example.org/research', publisherKey: 'official', documentType: 'release',
    language: 'en', sourceFact: 'Synthetic source fact', publishedAt: '2026-09-26',
    publishedPrecision: 'date', retrievedAt: now, independenceKey: 'synthetic', reviewState: 'verified' });
  activity.digestV3Store.createEvent({ id: 'research-event', userId: aliceId, eventType: 'release',
    subjectKey: 'synthetic-company', occurrenceKey: 'synthetic-release', title: 'Synthetic event',
    lifecycle: 'active', currentRevisionId: 'research-revision', createdAt: now },
  { id: 'research-revision', userId: aliceId, eventId: 'research-event', revisionNo: 1,
    previousRevisionId: null, changeKind: 'initial',
    facts: [{ factKey: 'status', value: 'announced', unit: null, scope: 'synthetic', evidenceIds: ['research-evidence'] }],
    evidenceIds: ['research-evidence'], recordedAt: now });

  const input = { candidateKey: 'synthetic-1', subjectKey: 'synthetic-company',
    subjectTitle: 'Synthetic Company', question: 'What changed?', eventRevisionId: 'research-revision' };
  const run = store.createRun(aliceId, input, new Date(now));
  assert.equal(store.createRun(aliceId, input, new Date(now)).id, run.id);
  assert.throws(() => store.createRun(aliceId, { ...input, question: 'Changed question' }), /候选键/);
  assert.throws(() => store.createRun(bobId, { ...input, candidateKey: 'bob-1' }), /事件修订不存在/);
  assert.equal(store.getRun(bobId, run.id), null);
  assert.equal(store.listRuns(aliceId)[0]?.eventRevisionId, 'research-revision');

  const firstClaim = store.claimRun(aliceId, run.id, new Date(now));
  assert.throws(() => store.claimRun(aliceId, run.id, new Date(now)), /领取/);
  const secondClaim = store.claimRun(aliceId, run.id, new Date('2026-09-27T01:11:00.000Z'));
  assert.equal(secondClaim.run.attempts, 2);
  assert.throws(() => store.completeRun(aliceId, run.id, firstClaim.leaseToken, 'Stale result', null,
    new Date('2026-09-27T01:12:00.000Z')), /领取/);
  const completed = store.completeRun(aliceId, run.id, secondClaim.leaseToken, 'Synthetic analysis',
    'Keep observing the synthetic company.', new Date('2026-09-27T01:12:00.000Z'));
  assert.equal(completed.run.status, 'completed');
  assert.equal(completed.proposal?.status, 'draft');
  assert.equal(store.getCurrentVersion(aliceId, 'synthetic-company'), null);
  assert.equal(store.getProposal(bobId, completed.proposal!.id), null);
  assert.throws(() => store.completeRun(aliceId, run.id, secondClaim.leaseToken, 'Replay'), /领取/);

  const decision = store.decideProposal(aliceId, completed.proposal!.id, 'confirm', null,
    new Date('2026-09-27T01:13:00.000Z'));
  assert.equal(decision.version?.body, 'Keep observing the synthetic company.');
  assert.equal(store.getCurrentVersion(aliceId, 'synthetic-company')?.proposalId, completed.proposal?.id);
  assert.throws(() => store.decideProposal(aliceId, completed.proposal!.id, 'confirm', null), /已处理/);

  const later = store.createRun(aliceId, { ...input, candidateKey: 'synthetic-2' });
  const laterClaim = store.claimRun(aliceId, later.id);
  const laterResult = store.completeRun(aliceId, later.id, laterClaim.leaseToken, 'Later result', 'Revise thesis');
  assert.equal(laterResult.proposal?.baseVersionId, decision.version?.id);
  assert.throws(() => store.decideProposal(aliceId, laterResult.proposal!.id, 'confirm', null), /基线/);
  const rejected = store.decideProposal(aliceId, laterResult.proposal!.id, 'reject', decision.version!.id);
  assert.equal(rejected.proposal.status, 'rejected');
  assert.equal(rejected.version, null);
  assert.equal(store.listVersions(aliceId, 'synthetic-company').length, 1);
  assert.equal(store.listVersions(bobId, 'synthetic-company').length, 0);

  const failed = store.createRun(aliceId, { ...input, candidateKey: 'synthetic-failure' });
  const failedClaim = store.claimRun(aliceId, failed.id);
  assert.equal(store.failRun(aliceId, failed.id, failedClaim.leaseToken).status, 'failed');
  assert.throws(() => store.claimRun(aliceId, failed.id), /领取/);
});

test('D13 encrypted backups restore history and remap references across accounts', () => {
  const password = 'synthetic-backup-password';
  const backup = backups.createUserBackup(alice.id, password);
  const inspected = backups.inspectUserBackup(backup, password) as any;
  assert.equal(inspected.counts.researchRuns, 3);
  assert.equal(inspected.counts.thesisProposals, 2);
  assert.equal(inspected.counts.thesisVersions, 1);
  const restored = backups.restoreUserBackup(bob.id, backup, password, 'merge') as any;
  assert.equal(restored.idsRemapped, true);
  const targetRuns = store.listRuns(bob.id);
  assert.equal(targetRuns.length, 3);
  assert.notEqual(targetRuns[0].id, store.listRuns(alice.id)[0].id);
  assert.ok(targetRuns.find(run => run.eventRevisionId));
  assert.equal(store.listVersions(bob.id, 'synthetic-company').length, 1);
  assert.equal(store.listProposals(bob.id).length, 2);
  assert.throws(() => backups.restoreUserBackup(bob.id, backup, password, 'merge'), /已有独立确认/);
  assert.equal(store.listVersions(bob.id, 'synthetic-company').length, 1);
  backups.restoreUserBackup(bob.id, backup, password, 'replace');
  assert.equal(store.listRuns(bob.id).length, 3);
  assert.equal(store.listVersions(bob.id, 'synthetic-company').length, 1);

  const old = backups.decryptBackup<any>(backup, password);
  delete old.activity.researchRuns;
  delete old.activity.thesisProposals;
  delete old.activity.thesisVersions;
  assert.throws(() => backups.restoreUserBackup(alice.id, backups.encryptBackup(old, password), password, 'replace'), /旧备份不含研究记录/);
  assert.equal(store.listRuns(alice.id).length, 3);

  const broken = backups.decryptBackup<any>(backup, password);
  broken.activity.thesisProposals[0].run_id = 'missing-run';
  const before = activity.exportActivityDb();
  assert.throws(() => backups.restoreUserBackup(bob.id, backups.encryptBackup(broken, password), password, 'replace'), /提案引用断裂/);
  assert.deepEqual(activity.exportActivityDb(), before);
});

test('D13 additive migration preserves research data across reopening', async () => {
  const runId = store.listRuns(alice.id).find(run => run.status === 'completed')!.id;
  await activity.initActivityDb();
  assert.equal(store.getRun(alice.id, runId)?.status, 'completed');
  assert.equal(store.listVersions(alice.id, 'synthetic-company').length, 1);
});

test('D13 failed persistence rolls back research creation', t => {
  const beforeMemory = activity.exportActivityDb();
  const diskFile = path.join(root, 'activity.db');
  const beforeDisk = fs.readFileSync(diskFile);
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === diskFile) throw new Error('synthetic research write failure');
    return rename(from, to);
  });
  assert.throws(() => store.createRun(alice.id, { candidateKey: 'failed-write', subjectKey: 'synthetic-company',
    subjectTitle: 'Synthetic Company', question: 'Will this persist?' }), /synthetic research write failure/);
  mock.mock.restore();
  assert.deepEqual(activity.exportActivityDb(), beforeMemory);
  assert.deepEqual(fs.readFileSync(diskFile), beforeDisk);
  assert.equal(store.listRuns(alice.id).length, 3);
});

test('D13 login API rejects outsiders and requires explicit thesis confirmation', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const request = (url: string, token: string, method = 'GET', body?: unknown) => fetch(base + url, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(base + '/api/research/runs')).status, 401);
    const runs = await (await request('/api/research/runs', aliceToken)).json() as any;
    assert.equal(runs.runs.length, 3);
    assert.equal((await request(`/api/research/runs/${runs.runs[0].id}`, bobToken)).status, 404);
    const proposal = store.listProposals(alice.id)[0];
    assert.equal((await request(`/api/research/proposals/${proposal.id}/decision`, bobToken, 'POST',
      { decision: 'confirm', expectedBaseVersionId: proposal.baseVersionId, confirm: true })).status, 404);
    assert.equal((await request(`/api/research/proposals/${proposal.id}/decision`, aliceToken, 'POST',
      { decision: 'confirm', expectedBaseVersionId: proposal.baseVersionId })).status, 400);
    assert.equal((await request('/api/research/runs', aliceToken, 'POST', {
      candidateKey: 'api-candidate', subjectKey: 'synthetic-company', subjectTitle: 'Synthetic Company',
      question: 'API question?', eventRevisionId: 'research-revision', extra: true,
    })).status, 400);
    assert.equal(store.listRuns(alice.id).length, 3);

    const createdResponse = await request('/api/research/runs', aliceToken, 'POST', {
      candidateKey: 'api-candidate', subjectKey: 'synthetic-company', subjectTitle: 'Synthetic Company',
      question: 'API question?', eventRevisionId: 'research-revision',
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json() as any).run;
    assert.equal((await request(`/api/research/runs/${created.id}`, bobToken)).status, 404);
    const detail = await (await request(`/api/research/runs/${created.id}`, aliceToken)).json() as any;
    assert.equal(detail.context.eventTitle, 'Synthetic event');
    assert.equal(detail.context.evidence[0].url, 'https://example.org/research');
    const claimResponse = await request(`/api/research/runs/${created.id}/claim`, aliceToken, 'POST', {});
    assert.equal(claimResponse.status, 200);
    const claim = await claimResponse.json() as any;
    assert.equal((await request(`/api/research/runs/${created.id}/complete`, aliceToken, 'POST', {
      leaseToken: 'wrong', resultBody: 'Synthetic research', proposalBody: 'Synthetic proposal',
    })).status, 409);
    const completionResponse = await request(`/api/research/runs/${created.id}/complete`, aliceToken, 'POST', {
      leaseToken: claim.leaseToken, resultBody: 'Synthetic research', proposalBody: 'Synthetic proposal',
    });
    assert.equal(completionResponse.status, 200);
    const completion = await completionResponse.json() as any;
    assert.equal(completion.proposal.status, 'draft');
    assert.equal((await request(`/api/research/proposals/${completion.proposal.id}/decision`, aliceToken, 'POST', {
      decision: 'confirm', expectedBaseVersionId: completion.proposal.baseVersionId, confirm: true,
    })).status, 200);
    assert.equal(store.listVersions(alice.id, 'synthetic-company').length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test.after(() => {
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolved, { recursive: true, force: true });
});
