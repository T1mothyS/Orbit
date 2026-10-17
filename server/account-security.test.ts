import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-password-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false', JWT_SECRET: 'synthetic-account-security' });
const db = await import('./db.js');
const { getUserCredentials } = await import('./database/queries/accounts.js');
const { changeAccountPassword } = await import('./account-security.js');
const { createAccountsRouter } = await import('./routes/accounts.js');
const { createAuth, PAGE_SESSION_COOKIE } = await import('./auth.js');
const { createApiRateLimiter } = await import('./http-security.js');
const vault = await import('./orbit-credential-vault.js');
await db.initDb();
const auth = createAuth({ secret: 'synthetic-account-security', getUserById: db.getUserById });
const stamp = new Date().toISOString(), oldPassword = 'Original password 123!';
async function user(id: string, password = oldPassword) {
  return db.createUser({ id, email: `${id}@example.invalid`, password_hash: await bcrypt.hash(password, 4), role: 'user', disabled: 0, auth_version: 0, created_at: stamp, updated_at: stamp });
}
const app = express();
app.use(express.json(), createAccountsRouter(auth));
app.get('/tools/probe', auth.authenticatePage, (_req, res) => res.json({ protected: true }));
const listener = app.listen(0, '127.0.0.1');
await once(listener, 'listening');
const base = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
test.after(() => new Promise<void>(resolve => { listener.closeAllConnections(); listener.close(() => resolve()); }));
const post = (route: string, body: unknown, token?: string, cookie?: string) => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual',
});
const me = (token: string) => fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });

test('change password needs Bearer, never accepts the Tools cookie or another account target', async () => {
  const owner = await user('bearer-owner'), foreign = await user('bearer-foreign');
  const token = auth.signUserToken(owner);
  assert.equal((await post('/api/auth/change-password', {}, undefined, `${PAGE_SESSION_COOKIE}=${token}`)).status, 401);
  const response = await post('/api/auth/change-password', { currentPassword: oldPassword, newPassword: 'Replacement password 123!', userId: foreign.id }, token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, reauthRequired: true });
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal(db.getUserById(owner.id)!.auth_version, 1);
  assert.equal(db.getUserById(foreign.id)!.auth_version, 0);
  assert.equal((await me(auth.signUserToken(foreign))).status, 200);
});

test('all old Orbit JWTs and Tools cookies fail after reload; independent grants remain active', async () => {
  const owner = await user('revoke-owner'), token = auth.signUserToken(owner);
  const token2 = jwt.sign({ userId: owner.id, email: owner.email, role: owner.role, authVersion: 0, iat: Math.floor(Date.now() / 1000) - 10 }, 'synthetic-account-security', { expiresIn: '7d' });
  assert.notEqual(token, token2);
  assert.equal((await me(token2)).status, 200);
  db.replaceDailyReportToken({ id: 'report-grant', user_id: owner.id, token_hash: 'report-hash', token_prefix: 'fixture', created_at: stamp, last_used_at: null, revoked_at: null });
  db.replaceLibraryPublishToken({ id: 'library-grant', user_id: owner.id, token_hash: 'library-hash', token_prefix: 'fixture', created_at: stamp, last_used_at: null, revoked_at: null });
  db.createOAuthClient({ client_id: 'cloud-client', client_name: 'Synthetic Cloud', redirect_uris_json: '[]', grant_types_json: '[]', response_types_json: '[]', token_endpoint_auth_method: 'none', created_at: stamp, updated_at: stamp });
  const grant = { token_hash: 'access-hash', client_id: 'cloud-client', user_id: owner.id, scope: 'daily_report:read', resource: 'https://fixture.invalid/mcp', expires_at: '2099-01-01T00:00:00.000Z', created_at: stamp, last_used_at: null, revoked_at: null };
  db.createOAuthAccessToken(grant);
  db.createOAuthRefreshToken({ ...grant, token_hash: 'refresh-hash', family_id: 'cloud-family', rotated_at: null });
  const credential = { access_token: 'synthetic-provider-access', refresh_token: 'synthetic-provider-refresh' };
  vault.saveSecret('chatgpt', owner.id, credential);
  assert.equal((await post('/api/auth/change-password', { currentPassword: oldPassword, newPassword: 'Persisted password 123!' }, token)).status, 200);
  await db.initDb();
  for (const oldToken of [token, token2]) {
    assert.equal((await me(oldToken)).status, 401);
    assert.equal((await fetch(base + '/tools/probe', { headers: { Cookie: `${PAGE_SESSION_COOKIE}=${oldToken}` }, redirect: 'manual' })).status, 302);
  }
  assert.equal((await post('/api/auth/login', { email: owner.email, password: oldPassword })).status, 401);
  const login = await post('/api/auth/login', { email: owner.email, password: 'Persisted password 123!' });
  assert.equal(login.status, 200);
  assert.equal((await me((await login.json()).token)).status, 200);
  assert.ok(db.findActiveDailyReportTokenByHash('report-hash'));
  assert.ok(db.findActiveLibraryPublishTokenByHash('library-hash'));
  assert.deepEqual(db.getActiveOAuthAccessToken('access-hash'), grant);
  assert.ok(db.getActiveOAuthRefreshToken('refresh-hash'));
  assert.deepEqual(vault.loadSecret('chatgpt', owner.id), credential);
});

test('invalid or unchanged passwords do not mutate credentials; UTF-8 limit never truncates', async () => {
  const owner = await user('validation-owner'), before = getUserCredentials(owner.id)!;
  for (const [current, next, code] of [[undefined, 'valid next 123', 'CURRENT_PASSWORD_REQUIRED'], [oldPassword, 123, 'NEW_PASSWORD_INVALID'], [oldPassword, 'short', 'NEW_PASSWORD_INVALID'], [oldPassword, '字'.repeat(25), 'NEW_PASSWORD_INVALID'], ['wrong password', 'valid next 123', 'CURRENT_PASSWORD_INVALID'], [oldPassword, oldPassword, 'PASSWORD_UNCHANGED']] as const) {
    await assert.rejects(changeAccountPassword(owner.id, 0, current, next), (error: any) => error.code === code);
    assert.deepEqual(getUserCredentials(owner.id), before);
  }
  await changeAccountPassword(owner.id, 0, oldPassword, '字'.repeat(24));
  assert.equal(await bcrypt.compare('字'.repeat(24), getUserCredentials(owner.id)!.password_hash), true);
});

test('historical current passwords longer than 72 bytes can still be replaced', async () => {
  const historical = 'x'.repeat(1500), owner = await user('legacy-long', historical);
  await changeAccountPassword(owner.id, 0, historical, 'Shorter replacement 123!');
  assert.equal(db.getUserById(owner.id)!.auth_version, 1);
});

test('registration and verification reject long or non-string passwords before any email/credential writes', async () => {
  const bytes = fs.readFileSync(path.join(root, 'chat.db'));
  for (const route of ['/api/auth/register', '/api/auth/send-register-code']) for (const password of ['a'.repeat(73), '字'.repeat(25), { unexpected: 'object' }]) {
    const response = await post(route, { email: 'uncreated@example.invalid', password, code: 'synthetic', invite_code: 'not-used' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /72.*UTF-8/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'chat.db')), bytes);
  }
});

test('concurrent changes have one winner and cannot overwrite a newer hash/version', async () => {
  const owner = await user('concurrent-owner');
  const result = await Promise.allSettled(['First replacement 123!', 'Second replacement 123!'].map(next => changeAccountPassword(owner.id, 0, oldPassword, next)));
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((result.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.code, 'ACCOUNT_CHANGED');
  assert.equal(db.getUserById(owner.id)!.auth_version, 1);
});

test('role/disable changes during async hashing are respected by the final CAS', async t => {
  const owner = await user('disabled-during-hash'), originalHash = bcrypt.hash;
  const mock = t.mock.method(bcrypt, 'hash', async (...args: Parameters<typeof bcrypt.hash>) => {
    db.updateUserDisabled(owner.id, 1); return (originalHash as any)(...args);
  });
  await assert.rejects(changeAccountPassword(owner.id, 0, oldPassword, 'Disabled replacement 123!'), (error: any) => error.code === 'ACCOUNT_CHANGED');
  mock.mock.restore();
  assert.equal(await bcrypt.compare(oldPassword, getUserCredentials(owner.id)!.password_hash), true);
});

test('disk fsync/rename failure never acknowledges success or leaves a later flushable password', async t => {
  for (const method of ['fsyncSync', 'renameSync'] as const) {
    const owner = await user(`disk-${method}`), token = auth.signUserToken(owner);
    const before = getUserCredentials(owner.id), bytes = fs.readFileSync(path.join(root, 'chat.db'));
    const original = fs[method] as (...args: any[]) => any;
    let failed = false;
    const mock = t.mock.method(fs, method, (...args: any[]) => {
      if (!failed && (method === 'fsyncSync' || String(args[1]) === path.join(root, 'chat.db'))) { failed = true; throw new Error('synthetic disk failure'); }
      return original(...args);
    });
    const response = await post('/api/auth/change-password', { currentPassword: oldPassword, newPassword: 'Failed replacement 123!' }, token);
    mock.mock.restore();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(getUserCredentials(owner.id), before);
    assert.deepEqual(fs.readFileSync(path.join(root, 'chat.db')), bytes);
    db.updateUserLastLogin(owner.id); await db.initDb();
    assert.equal(await bcrypt.compare(oldPassword, getUserCredentials(owner.id)!.password_hash), true);
    assert.equal((await me(token)).status, 200);
  }
});

test('login cannot mint an active token from a password comparison overtaken by a change', async t => {
  const owner = await user('login-race'), compare = bcrypt.compare;
  const mock = t.mock.method(bcrypt, 'compare', async (...args: Parameters<typeof bcrypt.compare>) => {
    const result = await (compare as any)(...args);
    db.updateUserDisabled(owner.id, 1); return result;
  });
  const response = await post('/api/auth/login', { email: owner.email, password: oldPassword });
  mock.mock.restore();
  assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null);
});

test('password attempts are limited per account, with an independent IP envelope', async () => {
  const owner = await user('rate-owner'), token = auth.signUserToken(owner);
  for (let index = 0; index < 5; index++) assert.equal((await post('/api/auth/change-password', {}, token)).status, 400);
  const blocked = await post('/api/auth/change-password', {}, token);
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const other = await user('rate-other'); assert.equal((await post('/api/auth/change-password', {}, auth.signUserToken(other))).status, 400);
  const middleware = createApiRateLimiter(); let status = 0;
  const res = { setHeader() {}, status(code: number) { status = code; return this; }, json() {} };
  for (let index = 0; index < 21; index++) middleware({ method: 'POST', path: '/api/auth/change-password', ip: 'synthetic' } as any, res as any, () => {});
  assert.equal(status, 429);
});

for (const point of ['before-database', 'after-database', 'after-commit', 'rollback-failure', 'commit-blocked']) {
  test(`process interruption at ${point} recovers a coherent password and auth version`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `orbit-password-${point}-`));
    const run = (mode: string) => spawnSync(process.execPath, ['--import', 'tsx', 'server/password-crash.fixture.ts', directory, mode], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    const crash = run(point);
    assert.equal(crash.status, 73, crash.stderr);
    const recovered = run('verify'); assert.equal(recovered.status, 0, recovered.stderr);
    const proof = JSON.parse(recovered.stdout.trim().split('\n').at(-1)!);
    assert.deepEqual(proof, ['after-commit', 'commit-blocked'].includes(point) ? { oldWorks: false, newWorks: true, version: 1, oldTokenValid: false } : { oldWorks: true, newWorks: false, version: 0, oldTokenValid: true });
  });
}
