import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-clear-test-'));
Object.assign(process.env, { NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false' });
const api = await import('./index.js'); await api.initializeServer();
const db = await import('./db.js'), orbit = await import('./orbit-store.js'), attachments = await import('./orbit-attachments.js');
const activity = await import('./activity-store.js'), state = await import('./ai-chat-state.js');
const { run, queryAll } = await import('./database/connection.js');
const stamp = new Date().toISOString();
for (const id of ['clear-owner', 'clear-other']) db.createUser({ id, email: `${id}@example.invalid`, password_hash: 'synthetic', role: 'user', disabled: 0, created_at: stamp, updated_at: stamp });
const fileInput = { name: 'history.txt', mime: 'text/plain', base64: Buffer.from('synthetic history attachment').toString('base64') };
function requestRow(cid: string, status: string) {
  const id = randomUUID();
  run('INSERT INTO orbit_requests(id,user_id,conversation_id,state,body,created_at) VALUES (?,?,?,?,?,?)', [id, 'clear-owner', cid, status, JSON.stringify({ text: 'synthetic request' }), stamp]); return id;
}

test('history clear rolls back attachment records and preserves bytes when the operation fails', async () => {
  const cid = orbit.createConversation('clear-owner').id;
  const file = await attachments.uploadChatAttachment('clear-owner', cid, fileInput);
  const record = activity.getAttachment(file.id, 'clear-owner')!;
  assert.throws(() => attachments.clearConversationAttachments('clear-owner', cid, () => { throw new Error('synthetic write failure'); }), /synthetic write failure/);
  assert.equal(attachments.attachment('clear-owner', file.id).conversation_id, cid);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, record.storagePath)));
});

test('HTTP clear enforces ownership, removes all terminal requests and plans, and retains the main conversation and notes', async () => {
  const cid = orbit.ensureDefaultConversation('clear-owner'), sibling = orbit.createConversation('clear-owner', '保留会话').id;
  const id = requestRow(cid, 'failed'); for (const status of ['cancelled', 'interrupted', 'completed']) requestRow(cid, status);
  const siblingRequest = requestRow(sibling, 'failed');
  for (const requestId of [id, siblingRequest]) run('INSERT INTO orbit_request_steps(user_id,request_id,id,label,state,at) VALUES (?,?,?,?,?,?)', ['clear-owner', requestId, 'synthetic-step', '合成处理步骤', 'completed', stamp]);
  state.aiChatRequestRecords.set(`clear-owner:${id}`, { userId: 'clear-owner', state: 'completed', expiresAt: Date.now() + 900000, response: { synthetic: true } });
  state.aiChatRequestRecords.set(`clear-owner:${siblingRequest}`, { userId: 'clear-owner', state: 'completed', expiresAt: Date.now() + 900000 });
  const file = await attachments.uploadChatAttachment('clear-owner', cid, fileInput);
  const record = activity.getAttachment(file.id, 'clear-owner')!;
  const plan: import('./ai-chat-state.js').PendingAiSchedulePlan = { id: randomUUID(), userId: 'clear-owner', conversationId: cid, targetCalendarId: 'personal', today: '2026-10-06', intent: 'create', reply: 'synthetic draft', warnings: [], revision: 1, state: 'pending', expiresAt: Date.now() + 900000, historyMessageId: randomUUID(), operations: [{ key: '0', type: 'create', data: { title: 'synthetic', start_time: '2026-10-07T09:00:00' } }] };
  const { buildAiPlanSnapshot } = await import('./ai-plan.js');
  db.createAiScheduleMessage({ id: plan.historyMessageId!, user_id: 'clear-owner', conversation_id: cid, role: 'assistant', type: 'plan', content: plan.reply, intent: 'create', plan: JSON.stringify(buildAiPlanSnapshot(plan)), schedule_items: null, created_at: stamp }); state.activateAiPlan(plan);
  attachments.linkMessageAttachments('clear-owner', plan.historyMessageId!, [file.id]);
  db.createNoteItem({ id: 'clear-retained-note', user_id: 'clear-owner', content: '保留记事', is_optimized: 0, optimization_count: 0, optimization_previous_content: null, content_revision: 0, completed: 0, completed_at: null, color: 'neutral', linked_schedule_ids: '[]', created_at: stamp, updated_at: stamp });
  const schedules = await import('./schedule-store.js');
  schedules.createSchedule({ id: 'clear-retained-schedule', user_id: 'clear-owner', calendar_id: 'personal', title: '保留已创建事项', type: 'event', start_time: '2026-10-07T09:00:00', end_time: '2026-10-07T10:00:00', all_day: false, category: 'work', priority: 'medium', is_completed: false, is_repeated: false, reminders: [], is_high_risk: false });
  const server = api.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (url: string, uid = 'clear-owner', method = 'DELETE', body?: unknown) => fetch(base + url, { method, headers: { Authorization: 'Bearer ' + api.signUserToken(db.getUserById(uid)!), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const endpoint = '/api/ai-schedule/history?conversationId=' + cid;
  try {
    assert.equal((await fetch(base + endpoint, { method: 'DELETE' })).status, 401);
    assert.equal((await request(endpoint, 'clear-other')).status, 400);
    for (const status of ['queued', 'running']) {
      const active = requestRow(cid, status);
      assert.equal((await request(endpoint)).status, 400);
      assert.ok(activity.getAttachment(file.id, 'clear-owner'));
      assert.ok(orbit.getRequest('clear-owner', id));
      assert.ok(state.aiChatRequestRecords.has(`clear-owner:${id}`));
      run('DELETE FROM orbit_requests WHERE id=?', [active]);
    }
    assert.equal((await request('/api/orbit/conversations/' + cid)).status, 400);
    assert.equal((await request(endpoint)).status, 200);
    assert.equal(orbit.conversation('clear-owner', cid).title, 'Orbit');
    assert.equal(orbit.conversation('clear-owner', cid).active_plan_message_id, null);
    assert.equal(orbit.getRequest('clear-owner', id), undefined);
    assert.ok(orbit.getRequest('clear-owner', siblingRequest));
    assert.equal(state.aiChatRequestRecords.has(`clear-owner:${id}`), false);
    assert.equal(state.aiChatRequestRecords.has(`clear-owner:${siblingRequest}`), true);
    assert.equal(queryAll('SELECT id FROM orbit_request_steps WHERE user_id=? AND request_id=?', ['clear-owner', id]).length, 0);
    assert.equal(queryAll('SELECT id FROM orbit_request_steps WHERE user_id=? AND request_id=?', ['clear-owner', siblingRequest]).length, 1);
    assert.equal(state.aiSchedulePlans.has(plan.id), false);
    assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=?', ['clear-owner', cid]).length, 0);
    assert.equal(queryAll('SELECT id FROM note_items WHERE user_id=? AND id=?', ['clear-owner', 'clear-retained-note']).length, 1);
    assert.equal(schedules.getSchedule('clear-retained-schedule')?.title, '保留已创建事项');
    assert.equal(activity.getAttachment(file.id, 'clear-owner'), null);
    assert.equal(fs.existsSync(path.join(process.env.DATA_DIR!, record.storagePath)), false);
    assert.equal(state.resolveAiPlan('clear-owner', plan.id), undefined);
    assert.equal((await request('/api/ai-chat/confirm', 'clear-owner', 'POST', { planId: plan.id, revision: 1 })).status, 404);
    assert.equal((await request(endpoint)).status, 200);
    assert.deepEqual((await (await request('/api/orbit/requests?conversationId=' + cid, 'clear-owner', 'GET')).json()).requests, []);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('file cleanup failure after commit reports pending cleanup without undoing the accepted clear', async t => {
  const cid = orbit.createConversation('clear-owner').id;
  const file = await attachments.uploadChatAttachment('clear-owner', cid, { ...fileInput, base64: Buffer.from('unique cleanup failure fixture').toString('base64') });
  const record = activity.getAttachment(file.id, 'clear-owner')!, filename = path.join(process.env.DATA_DIR!, record.storagePath);
  const unlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', (target: fs.PathLike) => { if (String(target) === filename) throw new Error('synthetic file permission failure'); return unlink(target); });
  assert.equal(attachments.clearConversationAttachments('clear-owner', cid, () => orbit.clearConversationHistory('clear-owner', cid)), 1);
  assert.equal(activity.getAttachment(file.id, 'clear-owner'), null);
  assert.equal(attachments.listChatAttachments('clear-owner', cid).length, 0);
  assert.ok(fs.existsSync(filename));
});
