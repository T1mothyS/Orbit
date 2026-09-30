import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-test-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.BACKUP_ENCRYPTION_KEY = 'synthetic-orbit-backup';
const api = await import('./index.js');
await api.initializeServer();
const db = await import('./db.js');
const store = await import('./orbit-store.js');
const queue = await import('./orbit-queue.js');
const schedules = await import('./schedule-store.js');
const reminders = await import('./reminder-store.js');
const sync = await import('./reminder-calendar-sync.js');
const { executeAiScheduleOperations } = await import('./ai-chat-state.js');
const { scheduleFingerprint } = await import('./ai-plan.js');
const { getActionCenter } = await import('./action-center.js');
const { selectKnowledgeReferences } = await import('./orbit-knowledge.js');
const { cleanupAiScheduleHistory } = await import('./ai-history.js');
const backup = await import('./backup-service.js');
const stamp = new Date().toISOString();
const users = ['owner', 'other'].map(id => db.createUser({ id, email: `${id}@example.invalid`, password_hash: 'synthetic', role: 'user', disabled: 0, created_at: stamp, updated_at: stamp }));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function settled(id: string) { for (let i = 0; i < 100; i++) {
    const item = store.getRequest('owner', id)!;
    if (!['running', 'queued'].includes(item.state))
        return item;
    await pause(10);
} throw new Error('queue did not settle'); }
test('Orbit migrates old messages, retains history, and scopes conversations and preferences', () => {
    db.createAiScheduleMessage({ id: 'old', user_id: 'owner', role: 'user', type: 'text', content: 'old message', intent: null, schedule_items: null, plan: null, created_at: '2020-01-01T00:00:00Z' });
    const id = store.ensureDefaultConversation('owner');
    assert.equal(db.getAiScheduleMessages('owner', 0)[0].conversation_id, id);
    assert.equal(cleanupAiScheduleHistory('owner'), 0);
    assert.equal(db.getAiScheduleMessages('owner', 0).length, 1);
    assert.throws(() => store.conversation('other', id), /无权/);
    assert.equal(store.getAiPreference('other'), false);
    store.setAiPreference('owner', true);
    assert.equal(store.getAiPreference('owner'), true);
    assert.equal(store.getAiPreference('other'), false);
});
test('queue serializes one account, allows short writes and other accounts, cancellation and idempotent retry', async () => {
    const cid = store.createConversation('owner').id, otherCid = store.createConversation('other').id;
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const previous = queue.setOrbitWorker(async (req, res) => { order.push(req.body.text); if (req.body.text === 'slow')
        await gate; res.json({ success: true, reply: req.body.text }); });
    try {
        const first = randomUUID(), second = randomUUID(), third = randomUUID(), other = randomUUID();
        const body = { requestId: first, conversationId: cid, text: 'slow' };
        queue.submitOrbitRequest('owner', body);
        queue.submitOrbitRequest('owner', body);
        queue.submitOrbitRequest('owner', { requestId: second, conversationId: cid, text: 'cancel me' });
        queue.submitOrbitRequest('owner', { requestId: third, conversationId: cid, text: 'after' });
        assert.deepEqual(order, ['slow']);
        assert.throws(() => queue.submitOrbitRequest('owner', { ...body, text: 'different' }), /其他内容/);
        store.renameConversation('owner', cid, 'can edit while generating');
        assert.equal(store.conversation('owner', cid).title, 'can edit while generating');
        assert.throws(() => store.deleteConversation('owner', cid), /取消/);
        queue.submitOrbitRequest('other', { requestId: other, conversationId: otherCid, text: 'independent' });
        await pause(20);
        assert.ok(order.includes('independent'));
        queue.cancelOrbitRequest('owner', second);
        release();
        await settled(first);
        await settled(third);
        assert.equal(store.getRequest('owner', second)?.state, 'cancelled');
        assert.equal(order.includes('cancel me'), false);
        queue.retryOrbitRequest('owner', second);
        await settled(second);
        assert.equal(order.filter(x => x === 'cancel me').length, 1);
        assert.equal(store.getRequest('owner', first)?.state, 'completed');
        assert.throws(() => queue.cancelOrbitRequest('other', first), /不存在/);
    }
    finally {
        release();
        queue.setOrbitWorker(previous);
    }
});
test('cancelled generation cannot save late history or expose a late result, restart is explicit', async () => {
    const cid = store.createConversation('owner').id;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const previous = queue.setOrbitWorker(async (_req, res) => { await gate; const { saveAiScheduleHistoryMessage } = await import('./ai-chat-state.js'); saveAiScheduleHistoryMessage({ userId: 'owner', role: 'assistant', type: 'text', content: 'late' }); res.json({ success: true }); });
    try {
        const id = randomUUID();
        queue.submitOrbitRequest('owner', { requestId: id, conversationId: cid, text: 'cancel' });
        queue.cancelOrbitRequest('owner', id);
        assert.throws(() => queue.retryOrbitRequest('owner', id), /正在结束/);
        release();
        await pause(30);
        assert.equal(store.getRequest('owner', id)?.result, null);
        assert.ok(!db.getAiScheduleMessages('owner', 0).some(m => m.content === 'late'));
    }
    finally {
        release();
        queue.setOrbitWorker(previous);
    }
    const { run } = await import('./database/connection.js');
    const interrupted = randomUUID();
    run('INSERT INTO orbit_requests (id,user_id,conversation_id,state,body,created_at) VALUES (?,?,?,?,?,?)', [interrupted, 'owner', cid, 'running', JSON.stringify({ text: 'interrupted' }), stamp]);
    queue.recoverOrbitQueue();
    assert.equal(store.getRequest('owner', interrupted)?.state, 'interrupted');
});
test('AI reschedules the real cycle once, preserves deadline, sync and future recurrence, rejects stale writes', () => {
    const today = reminders.todayInTimezone(), tomorrow = reminders.addDays(today, 1);
    const task = reminders.createReminderTask({ userId: 'owner', type: 'generic', name: '人行融资平台', config: { templateKey: 'custom', rule: { frequency: 'monthly', anchorDate: tomorrow, interval: 1, dayOfMonth: Number(tomorrow.slice(8, 10)), advancePolicy: 'calendar' }, reminderOffsets: [1, 0], reminderTime: '12:00', priority: 'medium', actionGuide: 'submit' } });
    const original = sync.syncReminderTaskToCalendar(task)!;
    const plan = { id: 'move-cycle', userId: 'owner', targetCalendarId: 'personal', today, intent: 'update', reply: 'move', warnings: [], expiresAt: Date.now() + 60000, operations: [{ key: '0', type: 'update' as const, scheduleId: original.id, expectedState: scheduleFingerprint(original), data: { start_time: `${today}T00:00:00` } }] };
    const result = executeAiScheduleOperations(plan);
    assert.equal(result.failures.length, 0);
    const live = reminders.getReminderTask(task.id, 'owner')!;
    assert.equal(live.currentCycle?.dueDate, tomorrow);
    assert.equal(live.currentCycle?.plannedDate, today);
    sync.syncReminderTaskToCalendar(live);
    assert.equal(schedules.getSchedule(original.id)?.start_time.slice(0, 10), today);
    assert.ok(getActionCenter('owner', 7).today.some(item => item.instanceId === task.currentCycle?.id && item.dueAt.startsWith(tomorrow) && item.plannedAt?.startsWith(today)));
    assert.equal(executeAiScheduleOperations(plan).failures.length, 1);
    assert.throws(() => reminders.setCyclePlannedDate(task.currentCycle!.id, 'other', today), /无权/);
    const next = reminders.completeReminderCycle(task.id, 'owner', task.currentCycle!.id, today, 'done')!;
    assert.ok(next.currentCycle!.dueDate > tomorrow);
    assert.equal(next.currentCycle?.plannedDate, null);
});
test('citations follow textual first-reference order; unknown and unreferenced IDs are not claimed', () => {
    const result = selectKnowledgeReferences('推荐 [知识:b]，参见 [知识:a]，重复 [知识:b]，未知 [知识:z]', ['a'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.equal(result.reply, '推荐 [1]，参见 [2]，重复 [1]，未知 ');
    assert.deepEqual(result.sources.map(s => [s.id, s.referenced]), [['b', true], ['a', true], ['c', false]]);
});
test('conversations survive encrypted backup and foreign restore clears business references', () => {
    const before = store.exportOrbit('owner');
    const buffer = backup.createUserBackup('owner', 'synthetic-password');
    store.createConversation('owner', 'after snapshot');
    backup.restoreUserBackup('owner', buffer, 'synthetic-password', 'replace');
    assert.equal(store.listConversations('owner').length, before.conversations.length);
    const old = backup.decryptBackup<any>(buffer, 'synthetic-password');
    delete old.orbit;
    const preserved = store.createConversation('owner', 'legacy backup must preserve this').id;
    backup.restoreUserBackup('owner', backup.encryptBackup(old, 'synthetic-password'), 'synthetic-password', 'replace');
    assert.equal(store.conversation('owner', preserved).title, 'legacy backup must preserve this');
    store.restoreOrbit('other', before, 'merge', true);
    const restored = store.exportOrbit('other');
    assert.ok(restored.conversations.some(c => c.title === before.conversations[0].title && c.id !== before.conversations[0].id));
    assert.ok(restored.messages.every(m => m.user_id === 'other' && m.plan === null && m.schedule_items === null));
});
test('HTTP conversation, history, queue and planned-date routes enforce authentication and ownership', async () => {
    const server = api.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as {
        port: number;
    }).port;
    const request = (url: string, user = 0, method = 'GET', body?: unknown) => fetch(base + url, { method, headers: { Authorization: 'Bearer ' + api.signUserToken(users[user]), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
        assert.equal((await fetch(base + '/api/orbit/conversations')).status, 401);
        const cid = (await (await request('/api/orbit/conversations', 0, 'POST', { title: 'HTTP fixture' })).json()).conversation.id;
        assert.equal((await request('/api/orbit/conversations/' + cid, 1, 'PATCH', { title: 'forbidden' })).status, 400);
        assert.equal((await request('/api/ai-schedule/history?conversationId=' + cid, 1)).status, 400);
        assert.equal((await request('/api/orbit/requests', 1, 'POST', { requestId: randomUUID(), conversationId: cid, text: '今天有什么安排？' })).status, 400);
        store.setAiPreference('owner', false);
        const id = randomUUID();
        assert.equal((await request('/api/orbit/requests', 0, 'POST', { requestId: id, conversationId: cid, text: '今天有什么安排？' })).status, 202);
        await settled(id);
        assert.equal(store.getRequest('owner', id)?.state, 'completed');
        const messages = (await (await request('/api/ai-schedule/history?conversationId=' + cid)).json()).messages;
        assert.equal(messages.length, 2);
        assert.equal((await request('/api/orbit/requests/' + id + '/retry', 1, 'POST', {})).status, 400);
        assert.equal((await request('/api/orbit/conversations/' + cid, 0, 'DELETE')).status, 200);
        const today = reminders.todayInTimezone(), tomorrow = reminders.addDays(today, 1);
        const task = reminders.createReminderTask({ userId: 'owner', type: 'generic', name: 'HTTP cycle', config: { templateKey: 'custom', rule: { frequency: 'once', anchorDate: tomorrow, advancePolicy: 'calendar' }, reminderOffsets: [0], reminderTime: '12:00', priority: 'medium', actionGuide: '' } });
        const linked = sync.syncReminderTaskToCalendar(task)!;
        const url = '/api/schedules/' + encodeURIComponent(linked.id);
        const view = await (await request(url)).json();
        assert.equal((await request(url + '/planned-date', 1, 'PATCH', { date: today, expectedState: view.expectedState })).status, 404);
        assert.equal((await request(url + '/planned-date', 0, 'PATCH', { date: today, expectedState: view.expectedState })).status, 200);
        assert.equal((await request(url + '/planned-date', 0, 'PATCH', { date: tomorrow, expectedState: view.expectedState })).status, 409);
        assert.equal(reminders.getReminderTask(task.id, 'owner')?.currentCycle?.plannedDate, today);
    }
    finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
test('Orbit model has no built-in tools, inherited settings, external MCP or SDK history', async () => {
    const { ORBIT_AI_QUERY_POLICY } = await import('./orbit-ai-policy.js');
    assert.deepEqual(ORBIT_AI_QUERY_POLICY.tools, []);
    assert.deepEqual(ORBIT_AI_QUERY_POLICY.settingSources, []);
    assert.deepEqual(ORBIT_AI_QUERY_POLICY.mcpServers, {});
    assert.equal(ORBIT_AI_QUERY_POLICY.persistSession, false);
    assert.equal(store.referencedIndex('把第三个改到今天'), 2);
    assert.equal(store.referencedIndex('第三篇说什么'), 2);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
