import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCodeBuddyEnv, normaliseCodeBuddyBaseUrl } from './codebuddy-env.js';

test('每位用户的 CodeBuddy 环境相互隔离且不会写入进程环境', () => {
  const before = process.env.CODEBUDDY_API_KEY;
  const first = buildCodeBuddyEnv({ api_key: 'user-a-key', base_url: 'https://a.example' });
  const second = buildCodeBuddyEnv({ api_key: 'user-b-key' });

  assert.equal(first.CODEBUDDY_API_KEY, 'user-a-key');
  assert.equal(first.CODEBUDDY_BASE_URL, 'https://a.example');
  assert.equal(second.CODEBUDDY_API_KEY, 'user-b-key');
  assert.equal(second.CODEBUDDY_BASE_URL, undefined);
  assert.equal(process.env.CODEBUDDY_API_KEY, before);
});

test('CodeBuddy 自定义地址只接受公网 HTTPS 域名', () => {
  assert.equal(normaliseCodeBuddyBaseUrl('https://api.codebuddy.cn/v1/'), 'https://api.codebuddy.cn/v1');
  assert.throws(() => normaliseCodeBuddyBaseUrl('http://api.codebuddy.cn'), /HTTPS URL/);
  assert.throws(() => normaliseCodeBuddyBaseUrl('https://127.0.0.1:8443'), /公网域名/);
  assert.throws(() => normaliseCodeBuddyBaseUrl('https://metadata.internal'), /公网域名/);
});

test('SDK 子进程不继承 Node 原生代理模式，父进程代理环境保持不变', async () => {
  const original = process.env.NODE_USE_ENV_PROXY;
  const server = http.createServer((_req, res) => res.end('direct-sdk-transport'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const target = `http://127.0.0.1:${address.port}`;
    const args = ['--input-type=module', '-e',
      'const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(3000)});console.log(await r.text());', target];
    const inherited = { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '', http_proxy: 'http://127.0.0.1:1',
      https_proxy: 'http://127.0.0.1:1', no_proxy: '' };
    // Prove the fixture fails when the parent's native proxy mode is inherited.
    await assert.rejects(promisify(execFile)(process.execPath, args, { env: inherited, timeout: 5000 }), /fetch failed/);
    const { stdout } = await promisify(execFile)(process.execPath, args, {
      timeout: 5000,
      // Match SDK ProcessTransport's parent-then-request environment merge.
      env: { ...inherited, ...buildCodeBuddyEnv({ api_key: 'synthetic-key' }) },
    });
    assert.equal(stdout.trim(), 'direct-sdk-transport');
    assert.equal(process.env.NODE_USE_ENV_PROXY, original);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
