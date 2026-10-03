import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-completion-api-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false' });
const api = await import('./index.js');
await api.initializeServer();
const db = await import('./db.js');
const store = await import('./activity-store.js');
const now = new Date().toISOString();
const users = ['owner', 'other'].map(id => db.createUser({ id, email: `${id}@example.invalid`, password_hash: 'synthetic', role: 'user', disabled: 0, created_at: now, updated_at: now }));
const tokens = users.map(api.signUserToken);

test('completion edit accepts explicit empty optional fields, preserves omitted fields and account ownership', async () => {
  const completion = store.createCompletion({ userId: 'owner', sourceType: 'schedule', sourceId: 'synthetic-source', completedAt: now, note: 'Original', billDate: '2026-10-04', amountCents: 1234, currency: 'CNY' });
  const server = api.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/completions/${completion.id}`;
  const update = (body: object, owner = 0) => fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${tokens[owner]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
    assert.equal((await update({ note: 'Other account' }, 1)).status, 404);
    const response = await update({ note: null, billDate: null });
    assert.equal(response.status, 200);
    const saved = (await response.json()).completion;
    assert.equal(saved.note, null);
    assert.equal(saved.billDate, null);
    assert.equal(saved.amountCents, 1234);
    assert.equal((await update({ billDate: '2026-02-30', note: 'Must not save' })).status, 400);
    assert.equal(store.getCompletion(completion.id, 'owner')?.note, null);
    assert.equal((await update({ billDate: '', note: '' })).status, 200);
    assert.equal(store.getCompletion(completion.id, 'owner')?.billDate, null);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
