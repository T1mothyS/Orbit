import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-cloud-refresh-'));
process.env.APP_URL = 'https://refresh.example.com';
const db = await import('./db.js');
const auth = await import('./daily-report-cloud-auth.js');
await db.initDb();

function grant(options: { expired?: boolean; revoked?: boolean; disabled?: boolean } = {}) {
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const email = `${userId}@example.com`;
  const password = 'refresh-test-only';
  db.createUser({ id: userId, email, password_hash: bcrypt.hashSync(password, 4), role: 'user', disabled: options.disabled ? 1 : 0, created_at: now, updated_at: now });
  const client = auth.registerDailyReportCloudClient({ client_name: 'Refresh regression', redirect_uris: ['https://chatgpt.example/callback'] });
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  // A grant can be older than 30 days while its last successful use is still recent.
  const createdAt = new Date(Date.now() - 40 * 86400000).toISOString();
  const expiresAt = new Date(Date.now() + (options.expired ? -1000 : 600000)).toISOString();
  db.createOAuthRefreshToken({ token_hash: hash, family_id: crypto.randomUUID(), client_id: String(client.client_id), user_id: userId,
    scope: 'daily_report:read_history offline_access', resource: auth.dailyReportCloudResource(), created_at: createdAt,
    expires_at: expiresAt, last_used_at: null, revoked_at: options.revoked ? now : null, rotated_at: null });
  return { hash, raw, expiresAt, createdAt, clientId: String(client.client_id), email, password, body: { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: raw, resource: auth.dailyReportCloudResource() } };
}

function reconnectRequest(clientId: string) {
  const verifier = 'r'.repeat(43);
  const request = auth.createDailyReportCloudAuthorizationRequest({ response_type: 'code', client_id: clientId,
    redirect_uri: 'https://chatgpt.example/callback', scope: 'daily_report:read_history', state: 'test-reconnect',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: auth.dailyReportCloudResource() });
  return { ...request, verifier };
}

test('active Cloud grants renew their idle window beyond the original authorization date without rotating the token', () => {
  const g = grant();
  const started = Date.now();
  const result = auth.refreshDailyReportCloudAccessToken(g.body);
  const saved = db.getOAuthRefreshToken(g.hash)!;
  assert.equal(result.refresh_token, g.raw);
  assert.equal(result.expires_in, 900);
  assert.equal(result.scope, 'daily_report:read_history offline_access');
  assert.equal(saved.created_at, g.createdAt);
  assert.ok(Date.parse(saved.expires_at) >= started + 30 * 86400000 - 1000);
  assert.ok(Date.parse(saved.expires_at) <= Date.now() + 30 * 86400000);
  assert.ok(saved.last_used_at);
  const second = auth.refreshDailyReportCloudAccessToken(g.body);
  assert.equal(second.refresh_token, g.raw);
  assert.notEqual(second.access_token, result.access_token);
  assert.ok(Date.parse(db.getOAuthRefreshToken(g.hash)!.expires_at) >= Date.parse(saved.expires_at));
});

test('invalid resource, expanded scopes and another client cannot extend a Cloud grant', () => {
  const g = grant();
  const another = auth.registerDailyReportCloudClient({ client_name: 'Other client', redirect_uris: ['https://other.example/callback'] });
  for (const patch of [{ resource: 'https://other.example/mcp' }, { scope: 'daily_report:publish offline_access' }, { client_id: another.client_id }]) {
    assert.throws(() => auth.refreshDailyReportCloudAccessToken({ ...g.body, ...patch }), auth.DailyReportCloudOAuthError);
    const saved = db.getOAuthRefreshToken(g.hash)!;
    assert.equal(saved.expires_at, g.expiresAt);
    assert.equal(saved.last_used_at, null);
  }
});

for (const state of ['expired', 'revoked', 'disabled'] as const) {
  test(`${state} Cloud grants remain rejected and cannot be renewed`, () => {
    const g = grant({ [state]: true });
    assert.throws(() => auth.refreshDailyReportCloudAccessToken(g.body), (error: unknown) => error instanceof auth.DailyReportCloudOAuthError && error.code === 'invalid_grant');
    const saved = db.getOAuthRefreshToken(g.hash)!;
    assert.equal(saved.expires_at, g.expiresAt);
    assert.equal(saved.last_used_at, null);
    assert.ok(saved.revoked_at);
  });
}

test('the persistence guard cannot renew a grant that expires or is revoked after validation', () => {
  for (const options of [{ expired: true }, { revoked: true }]) {
    const g = grant(options);
    assert.equal(db.markOAuthRefreshTokenUsed(g.hash, new Date().toISOString(), new Date(Date.now() + 30 * 86400000).toISOString()), false);
    assert.equal(db.getOAuthRefreshToken(g.hash)!.expires_at, g.expiresAt);
  }
});

for (const state of ['expired', 'revoked'] as const) {
  test(`reconnecting an ${state} grant offers prior offline access for fresh consent without reviving the old token`, () => {
    const g = grant({ [state]: true });
    const r = reconnectRequest(g.clientId);
    assert.equal(auth.completeDailyReportCloudLogin(r.requestId, r.csrfToken, g.email, 'wrong-password'), false);
    assert.equal(db.getOAuthAuthorizationRequest(r.requestId)!.scope, 'daily_report:read_history');
    assert.equal(auth.completeDailyReportCloudLogin(r.requestId, r.csrfToken, g.email, g.password), true);
    assert.equal(db.getOAuthAuthorizationRequest(r.requestId)!.scope, 'daily_report:read_history offline_access');
    assert.throws(() => auth.refreshDailyReportCloudAccessToken(g.body), auth.DailyReportCloudOAuthError);
    assert.equal(db.getOAuthRefreshToken(g.hash)!.expires_at, g.expiresAt);
    const callback = new URL(auth.approveDailyReportCloudAuthorization(r.requestId, r.csrfToken, true));
    const result = auth.exchangeDailyReportCloudAuthorizationCode({ grant_type: 'authorization_code', client_id: g.clientId,
      code: callback.searchParams.get('code'), redirect_uri: 'https://chatgpt.example/callback', code_verifier: r.verifier, resource: auth.dailyReportCloudResource() });
    assert.ok(result.refresh_token);
    assert.notEqual(result.refresh_token, g.raw);
    assert.equal(result.scope, 'daily_report:read_history offline_access');
  });
}

test('offline re-consent stays within the same account/client and can be refused', () => {
  const owner = grant({ expired: true });
  const other = grant();
  for (const [clientId, account] of [[owner.clientId, other], [other.clientId, owner]] as const) {
    const r = reconnectRequest(clientId);
    assert.equal(auth.completeDailyReportCloudLogin(r.requestId, r.csrfToken, account.email, account.password), true);
    assert.equal(db.getOAuthAuthorizationRequest(r.requestId)!.scope, 'daily_report:read_history');
  }
  const r = reconnectRequest(owner.clientId);
  auth.completeDailyReportCloudLogin(r.requestId, r.csrfToken, owner.email, owner.password);
  const callback = new URL(auth.approveDailyReportCloudAuthorization(r.requestId, r.csrfToken, false));
  assert.equal(callback.searchParams.get('error'), 'access_denied');
  assert.equal(callback.searchParams.get('code'), null);
  assert.equal(db.getOAuthAuthorizationRequest(r.requestId), undefined);
  assert.throws(() => auth.refreshDailyReportCloudAccessToken(owner.body), auth.DailyReportCloudOAuthError);
});
