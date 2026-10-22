import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { createProjectEvolutionRouter, validateEvolution } from './project-evolution.js';
import { architectureChanges, type EvolutionData } from '../src/types/project-evolution.js';
import { architectureFocus, architectureGroups, compactArchitecture, compactNode, storySnapshots, evolutionSequence, relationChange } from '../src/utils/evolution-presentation.js';
import { collectFact, isSource, nonemptyLines } from '../scripts/project-evolution-lib.js';

const readData = () => JSON.parse(fs.readFileSync('project-evolution/generated.json', 'utf8')) as EvolutionData;
test('compact display preserves every historical node, relation and original coordinate without overlaps', () => {
  const data = readData(), original = JSON.stringify(data);
  for (const snapshot of data.snapshots) for (const width of [360, 1000, 1440, 2200]) {
    const layout = compactArchitecture(snapshot.nodes, width);
    assert.deepEqual(new Set(layout.nodes.map(n => n.id)), new Set(snapshot.nodes.map(n => n.id)));
    for (const node of layout.nodes) {
      assert.ok(node.x >= 0 && node.y >= 0 && node.x + compactNode.width <= layout.width && node.y + compactNode.height <= layout.height);
      assert.ok(snapshot.nodes.some(old => old.id === node.id && old.label === node.label && old.group === node.group && old.description === node.description));
      for (const other of layout.nodes.filter(n => n.id !== node.id)) assert.ok(node.x + compactNode.width <= other.x || other.x + compactNode.width <= node.x || node.y + compactNode.height <= other.y || other.y + compactNode.height <= node.y);
    }
    assert.ok(snapshot.edges.every(edge => layout.nodes.some(n => n.id === edge.source) && layout.nodes.some(n => n.id === edge.target)));
  }
  assert.equal(JSON.stringify(data), original);
  assert.ok(compactArchitecture(data.snapshots.at(-1)!.nodes, 1000).height < 800);
});
test('evolution curated record validates and metrics retain unknown tests', () => {
  const data = readData(); validateEvolution(data);
  assert.ok(data.milestones.length >= 15, 'The original growth history must remain available');
  assert.equal(data.milestones[0].tests, null);
  assert.equal(data.facts[0].version, '1.0.0');
});
test('evolution rejects duplicate IDs, dangling edges, bad references and metrics', () => {
  const mutations = [
    (d: EvolutionData) => { d.milestones[1].id = d.milestones[0].id; },
    (d: EvolutionData) => { d.snapshots[0].edges[0].target = 'missing'; },
    (d: EvolutionData) => { d.milestones[0].snapshot = 'missing'; },
    (d: EvolutionData) => { d.facts[0].version = 'invented'; },
    (d: EvolutionData) => { d.facts[0].sourceLoc = -1; },
    (d: EvolutionData) => { d.facts[0].commit = 'bad'; },
    (d: EvolutionData) => { d.milestones[0].tests = { count: 25, evidence: '' }; },
    (d: EvolutionData) => { d.milestones[0].evidencePaths = ['../../.env']; },
    (d: EvolutionData) => { d.snapshots[1].nodes[0].x += 10; },
    (d: EvolutionData) => { Object.assign(d, { privateEmail: 'not allowed' }); },
  ];
  for (const mutate of mutations) { const data = readData(); mutate(data); assert.throws(() => validateEvolution(data)); }
});
test('LOC rule excludes generated and non-source files and counts nonempty lines', () => {
  for (const p of ['src/App.tsx', 'server/routes/example.ts', 'scripts/example.ps1']) assert.ok(isSource(p));
  for (const p of ['data/chat.db', 'package-lock.json', 'dist/app.js', 'server/public/assets/index-built.js', 'src/generated/data.ts', 'src/vendor/lib.js', 'src/foo.min.js', 'scripts/project-evolution-lib.ts', 'src/pages/ProjectEvolutionPage.tsx']) assert.ok(!isSource(p));
  assert.equal(nonemptyLines('a\r\n \r\n// comment\n'), 2);
});
test('architecture diff detects additions, removals and content changes with stable positions', () => {
  const before = readData().snapshots[0]; const after = structuredClone(before);
  after.nodes[0].description = 'Updated role'; after.nodes.splice(1, 1); after.edges = [];
  after.nodes.push({ ...before.nodes[1], id: 'new-service' });
  const diff = architectureChanges(before, after);
  assert.equal(diff.nodes.find(n => n.id === before.nodes[0].id)?.change, 'changed');
  assert.equal(diff.nodes.find(n => n.id === before.nodes[1].id)?.change, 'removed');
  assert.equal(diff.nodes.find(n => n.id === 'new-service')?.change, 'added');
  assert.equal(diff.nodes[0].x, before.nodes[0].x);
  assert.ok(diff.edges.every(e => e.change === 'removed'));
});
test('historical collection is deterministic and ignores current working files', t => {
  const data = readData(), milestone = data.milestones[0];
  // Run only when this old object is available (ordinary shallow test checkouts lack it).
  try { execFileSync('git', ['cat-file', '-e', milestone.commit], { stdio: 'ignore' }); } catch { t.skip('Historical object unavailable in shallow checkout'); return; }
  const first = collectFact(milestone.id, milestone.commit);
  assert.deepEqual(first, collectFact(milestone.id, milestone.commit));
  assert.deepEqual(first, data.facts[0]);
});
test('evolution API requires valid active account, shares only project facts and handles corrupt data', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-api-'));
  const file = path.join(temp, 'generated.json'); fs.copyFileSync('project-evolution/generated.json', file);
  const users = ['one', 'two'].map(id => ({ id, email: `${id}@example.invalid`, role: 'user' as const, disabled: 0, auth_version: 0, created_at: '', updated_at: '' }));
  const auth = createAuth({ secret: 'evolution-test-secret', getUserById: id => users.find(u => u.id === id) });
  const app = createApp({ isProduction: false, isReady: () => true });
  app.use(createProjectEvolutionRouter({ authenticate: auth.authenticate, file }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as { port: number }).port}/api/project-evolution`;
  const request = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request('invalid')).status, 401);
    const token = auth.signUserToken(users[0]);
    const response = await request(token); assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const data = await response.json();
    assert.deepEqual(data, await (await request(auth.signUserToken(users[1]))).json());
    users[0].disabled = 1; assert.notEqual((await request(token)).status, 200); users[0].disabled = 0;
    users[0].auth_version++; assert.notEqual((await request(token)).status, 200);
    fs.writeFileSync(file, '{}');
    const failed = await request(auth.signUserToken(users[1])); assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: '项目成长记录暂不可用，请稍后重试' });
  } finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('story projection preserves chronological references and accounts for every historical relation', () => {
  const data = readData(), before = JSON.stringify(data), sequence = storySnapshots(data);
  assert.equal(sequence.length, 5);
  assert.equal(sequence.at(-1)?.id, data.snapshots.at(-1)?.id);
  assert.deepEqual(sequence.map(s => data.snapshots.indexOf(s)), [...sequence.map(s => data.snapshots.indexOf(s))].sort((a, b) => a - b));
  data.snapshots.forEach((snapshot, index) => {
    const diff = architectureChanges(data.snapshots[index - 1], snapshot), projection = architectureGroups(diff);
    assert.equal(projection.groups.reduce((sum, group) => sum + group.nodes.length, 0), diff.nodes.length);
    assert.equal(projection.relations.reduce((sum, edge) => sum + edge.count, 0), diff.edges.length);
    for (const relation of projection.relations) assert.equal(Object.values(relation.changes).reduce((sum, count) => sum + count, 0), relation.count);
    for (const change of ['added', 'changed', 'removed', 'unchanged'] as const) assert.equal(projection.relations.reduce((sum, relation) => sum + relation.changes[change], 0), diff.edges.filter(edge => edge.change === change).length);
    for (const node of diff.nodes) {
      const focus = architectureFocus(diff, node.id), grouped = architectureGroups(diff, node.id);
      assert.ok(focus.nodes.has(node.id));
      assert.ok(focus.edges.every(edge => edge.source === node.id || edge.target === node.id));
      assert.equal(grouped.relations.reduce((sum, edge) => sum + edge.focused, 0), focus.edges.length);
    }
  });
  assert.equal(JSON.stringify(data), before, 'Presentation cannot rewrite historical facts or positions');
});

test('milestone playback preserves every story and reused snapshot; mixed connections retain all statuses', () => {
  const data = readData(), before = JSON.stringify(data), history = evolutionSequence(data, 'history');
  assert.deepEqual(history, data.milestones);
  assert.equal(history.filter(item => !data.snapshots.some(snapshot => snapshot.milestone === item.id)).length, 23);
  assert.deepEqual(evolutionSequence(data, 'story').map(item => item.snapshot), storySnapshots(data).map(item => item.id));
  assert.equal(relationChange({ added: 1, changed: 2, removed: 3, unchanged: 4 }), 'added');
  assert.equal(relationChange({ added: 0, changed: 2, removed: 3, unchanged: 4 }), 'changed');
  assert.equal(relationChange({ added: 0, changed: 0, removed: 3, unchanged: 4 }), 'removed');
  assert.equal(relationChange({ added: 0, changed: 0, removed: 0, unchanged: 4 }), 'unchanged');
  assert.equal(JSON.stringify(data), before);
});
