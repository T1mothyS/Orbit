import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { openAIFetch } from './openai-fetch.js';

test('未配置或目标不是精确 OpenAI HTTPS origin 时保持原 fetch 和全局代理环境', async () => {
  const originalFetch = globalThis.fetch, originalProxy = process.env.ORBIT_OPENAI_PROXY_URL;
  const keys = ['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
  const before = keys.map(key => process.env[key]);
  const calls: Array<{ input: unknown; init: unknown }> = [];
  globalThis.fetch = (async (input, init) => { calls.push({ input, init }); return new Response('direct'); }) as typeof fetch;
  const init = { signal: new AbortController().signal, headers: { 'x-test': 'passthrough' } };
  try {
    delete process.env.ORBIT_OPENAI_PROXY_URL;
    await openAIFetch('https://api.openai.com/v1/models', init);
    process.env.ORBIT_OPENAI_PROXY_URL = 'invalid-config-must-not-affect-other-clients';
    for (const url of ['https://api.codebuddy.cn/v1', 'https://open.bigmodel.cn/', 'http://127.0.0.1:3000/',
      'http://api.openai.com/', 'https://api.openai.com.attacker.invalid/', 'https://auth.openai.com:8443/',
      'https://openai.com/', 'https://sub.api.openai.com/']) await openAIFetch(url, init);
    assert.equal(calls.length, 9);
    assert.ok(calls.every(call => call.init === init));
    assert.ok(keys.every((key, i) => process.env[key] === before[i]), 'global proxy environment unchanged');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProxy === undefined) delete process.env.ORBIT_OPENAI_PROXY_URL; else process.env.ORBIT_OPENAI_PROXY_URL = originalProxy;
  }
});

test('API 和 OAuth 通过真实 CONNECT 使用代理认证，业务 Authorization 不进入 CONNECT', async () => {
  const original = process.env.ORBIT_OPENAI_PROXY_URL;
  const requests: Array<{ target: string; proxyAuth?: string; authorization?: string }> = [];
  const server = http.createServer();
  server.on('connect', (req, socket) => {
    requests.push({ target: req.url!, proxyAuth: req.headers['proxy-authorization'], authorization: req.headers.authorization });
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    process.env.ORBIT_OPENAI_PROXY_URL = `http://test-user:synthetic%3Apassword@127.0.0.1:${port}`;
    for (const url of ['https://api.openai.com/v1/models', 'https://auth.openai.com/.well-known/jwks.json']) {
      await assert.rejects(openAIFetch(url, { headers: { Authorization: 'Bearer synthetic-target-only' }, signal: AbortSignal.timeout(3000) }));
    }
    assert.deepEqual(requests.map(item => item.target), ['api.openai.com:443', 'auth.openai.com:443']);
    assert.ok(requests.every(item => item.proxyAuth === 'Basic ' + Buffer.from('test-user:synthetic:password').toString('base64')));
    assert.ok(requests.every(item => item.authorization === undefined));
  } finally {
    if (original === undefined) delete process.env.ORBIT_OPENAI_PROXY_URL; else process.env.ORBIT_OPENAI_PROXY_URL = original;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('代理失败可取消，保留调用方 signal，不为等待 CONNECT 无限挂起', { timeout: 5000 }, async () => {
  const original = process.env.ORBIT_OPENAI_PROXY_URL;
  const sockets = new Set<Duplex>();
  let connected!: () => void;
  const connection = new Promise<void>(resolve => { connected = resolve; });
  const server = http.createServer();
  server.on('connect', (_req, socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); connected(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    process.env.ORBIT_OPENAI_PROXY_URL = `http://127.0.0.1:${port}`;
    const controller = new AbortController();
    const request = openAIFetch('https://api.openai.com/v1/models', { signal: controller.signal });
    await connection;
    controller.abort(new Error('synthetic cancel'));
    await assert.rejects(request, /synthetic cancel/);
  } finally {
    if (original === undefined) delete process.env.ORBIT_OPENAI_PROXY_URL; else process.env.ORBIT_OPENAI_PROXY_URL = original;
    sockets.forEach(socket => socket.destroy());
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('代理配置错误不泄露凭据，且不静默回退为 OpenAI 直连', async () => {
  const original = process.env.ORBIT_OPENAI_PROXY_URL;
  try {
    for (const value of ['socks5://secret-user:secret-value@127.0.0.1:1',
      'http://secret-user:secret-value@127.0.0.1:1/path', 'http://127.0.0.1:1/?secret-value',
      'http://127.0.0.1:1/#secret-value', 'http://secret-user:secret-value\n@127.0.0.1:1']) {
      process.env.ORBIT_OPENAI_PROXY_URL = value;
      await assert.rejects(openAIFetch('https://api.openai.com/v1/models'), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ORBIT_OPENAI_PROXY_URL/);
        assert.ok(!error.message.includes('secret-user') && !error.message.includes('secret-value'));
        return true;
      });
    }
  } finally {
    if (original === undefined) delete process.env.ORBIT_OPENAI_PROXY_URL; else process.env.ORBIT_OPENAI_PROXY_URL = original;
  }
});

test('带代理的固定 OpenAI 端点拒绝重定向，原 init 和认证头保持不变', async () => {
  const originalFetch = globalThis.fetch, originalProxy = process.env.ORBIT_OPENAI_PROXY_URL;
  const controller = new AbortController(), headers = new Headers({ Authorization: 'Bearer synthetic' });
  const init: RequestInit = { redirect: 'follow', signal: controller.signal, headers };
  let seen: RequestInit & { dispatcher?: unknown } = {};
  globalThis.fetch = (async (_input, options) => { seen = options!; return new Response('synthetic'); }) as typeof fetch;
  try {
    process.env.ORBIT_OPENAI_PROXY_URL = 'http://127.0.0.1:1';
    await openAIFetch(new Request('https://auth.openai.com/.well-known/openid-configuration'), init);
    assert.equal(seen.redirect, 'error');
    assert.equal(seen.signal, controller.signal);
    assert.equal(seen.headers, headers);
    assert.ok(seen.dispatcher);
    assert.equal(init.redirect, 'follow');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProxy === undefined) delete process.env.ORBIT_OPENAI_PROXY_URL; else process.env.ORBIT_OPENAI_PROXY_URL = originalProxy;
  }
});
