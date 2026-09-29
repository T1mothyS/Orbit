import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';

test('isolated entrypoint starts with jobs disabled and blocks non-Shadow writes', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-shadow-http-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/digest-shadow-server.ts'], {
    env: { ...process.env, DATA_DIR: path.join(root, 'digest-v2-shadow-data'), PORT: String(port),
      JWT_SECRET: 'synthetic-shadow-integration-secret-123456', APP_URL: 'https://shadow.example.test',
      DIGEST_SHADOW_LOGIN_EMAIL: 'shadow@example.test', DIGEST_SHADOW_PASSWORD_HASH: bcrypt.hashSync('synthetic-test-password', 4),
      BACKGROUND_JOBS_ENABLED: 'true', SMTP_PASS: 'must-not-enable-delivery', MAIL_CREDENTIALS_ENCRYPTION_KEY: 'synthetic-shadow-mail-key' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let logs = ''; child.stdout.on('data', data => { logs += String(data); });
  child.stderr.on('data', data => { logs += String(data); });
  try {
    const deadline = Date.now() + 20000;
    while (!logs.includes('digest_shadow_listening') && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(logs.includes('digest_shadow_listening'), logs);
    assert.ok(logs.includes('"backgroundJobs":false'));
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/daily-reports')).status, 401);
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shadow@example.test', password: 'synthetic-test-password' }) });
    assert.equal(login.status, 200);
    const { token } = await login.json() as { token: string };
    assert.ok(token);
    const migrationUrl = base + '/api/daily-report/cloud-context/shadow-watchlist';
    const stock = (symbol: string) => ({ name: `Synthetic ${symbol}`, symbol, priority: 'high', sectors: ['Synthetic'], thesis: { status: 'tracking', priority: 'high', thesis: { one_liner: 'synthetic only' }, monitor: { earnings: ['synthetic only'] } } });
    const migration = { expectedVersion: 0, stocks: [stock('AAA'), stock('BBB')] };
    assert.equal((await fetch(migrationUrl, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(migration) })).status, 401);
    assert.equal((await fetch(base + '/api/daily-report/cloud-context', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ context: {} }) })).status, 403);
    const invalid = await fetch(migrationUrl, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...migration, stocks: [{ ...stock('AAA'), extra: true }, stock('BBB')] }) });
    assert.equal(invalid.status, 400);
    const saved = await fetch(migrationUrl, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(migration) });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { version: 1, watchlistStockCount: 2 });
    const context = await fetch(base + '/api/daily-report/cloud-context', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(context.status, 200);
    assert.equal(((await context.json()) as any).context.context.watchlist.stocks.length, 2);
    assert.equal((await fetch(migrationUrl, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(migration) })).status, 409);
    assert.equal((await fetch(migrationUrl, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0 }) })).status, 409);
    const undone = await fetch(migrationUrl, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }) });
    assert.equal(undone.status, 200);
    assert.deepEqual(await undone.json(), { version: 2, watchlistStockCount: 0 });
    const restored = await fetch(base + '/api/daily-report/cloud-context', { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual(((await restored.json()) as any).context.context, {});
    assert.equal((await fetch(base + '/api/user-mail-account', { method: 'PUT' })).status, 401);
    const mailTest = await fetch(base + '/api/user-mail-account/test', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    assert.equal(mailTest.status, 200);
    assert.equal((await mailTest.json() as { result: { configured: boolean } }).result.configured, false);
    const saveMail = await fetch(base + '/api/user-mail-account', {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'shadow@qq.com', authCode: 'synthetic-only', enabled: true }),
    });
    assert.equal(saveMail.status, 200);
    assert.equal((await saveMail.json() as { account: { configured: boolean } }).account.configured, true);
    const deleteMail = await fetch(base + '/api/user-mail-account', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    assert.equal(deleteMail.status, 200);
    assert.equal((await deleteMail.json() as { account: { configured: boolean } }).account.configured, false);
    for (const route of ['/api/schedules', '/api/daily-reports/publish', '/api/auth/register', '/api/notifications']) {
      const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 403, route);
      assert.equal((await response.json() as { error: string }).error, 'SHADOW_ONLY');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  }
});
