import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRateLimitStore, securityHeaders, isCredentialImportSecure } from './http-security.js';
import express from 'express';
import { once } from 'node:events';
import { request } from 'node:http';

test('凭据导入识别同机 TLS 代理，但拒绝远程伪造和歧义协议头', () => {
  const req = { secure: false, hostname: 'orbit.example', headers: {}, socket: { remoteAddress: '203.0.113.10' } };
  assert.equal(isCredentialImportSecure({ ...req, secure: true }), true);
  for (const remoteAddress of ['203.0.113.10', '::ffff:203.0.113.10', undefined]) {
    assert.equal(isCredentialImportSecure({ ...req, headers: { 'x-forwarded-proto': 'https' }, socket: { remoteAddress } }), false);
  }
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const local = { ...req, socket: { remoteAddress } };
    assert.equal(isCredentialImportSecure({ ...local, headers: { 'x-forwarded-proto': 'https' } }), true);
    assert.equal(isCredentialImportSecure({ ...local, hostname: 'localhost' }), true);
    for (const proto of [undefined, 'http', 'https,http', 'http, https', ['https']]) {
      assert.equal(isCredentialImportSecure({ ...local, headers: { 'x-forwarded-proto': proto } }), false);
      if (proto !== undefined) assert.equal(isCredentialImportSecure({ ...local, hostname: 'localhost', headers: { 'x-forwarded-proto': proto } }), false);
    }
    assert.equal(isCredentialImportSecure({ ...local, hostname: 'localhost', headers: { 'x-forwarded-for': '203.0.113.10' } }), false);
  }
});

test('默认 Express 配置的 HTTPS loopback 代理可导入，公网 Host 的明文请求被拒绝', async () => {
  const app = express();
  app.post('/import-transport', (req, res) => res.sendStatus(isCredentialImportSecure(req) ? 204 : 400));
  const listener = app.listen(0, '127.0.0.1');
  try {
    await once(listener, 'listening');
    const url = `http://127.0.0.1:${(listener.address() as { port: number }).port}/import-transport`;
    const status = (headers: Record<string, string>) => new Promise<number | undefined>((resolve, reject) => {
      const probe = request(url, { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      probe.on('error', reject); probe.end();
    });
    assert.equal(await status({ Host: 'orbit.example', 'X-Forwarded-Proto': 'https' }), 204);
    assert.equal(await status({ Host: 'orbit.example' }), 400);
    assert.equal(await status({ Host: 'localhost', 'X-Forwarded-Proto': 'http' }), 400);
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});

test('限流窗口内拒绝超额请求并在窗口结束后恢复', () => {
  const store = new InMemoryRateLimitStore();
  assert.equal(store.consume('login:one', 2, 1_000, 10_000).allowed, true);
  assert.equal(store.consume('login:one', 2, 1_000, 10_100).allowed, true);
  const rejected = store.consume('login:one', 2, 1_000, 10_200);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(store.consume('login:one', 2, 1_000, 11_001).allowed, true);
});

test('不同限流键互不影响', () => {
  const store = new InMemoryRateLimitStore();
  store.consume('ai:user-a', 1, 1_000, 1);
  assert.equal(store.consume('ai:user-a', 1, 1_000, 2).allowed, false);
  assert.equal(store.consume('ai:user-b', 1, 1_000, 2).allowed, true);
});

test('限流键数量异常增长时会淘汰最早的桶', () => {
  const store = new InMemoryRateLimitStore();
  store.consume('first', 1, 60_000, 1);
  for (let index = 0; index < 10_000; index += 1) {
    store.consume(`key-${index}`, 1, 60_000, 1);
  }
  assert.equal(store.consume('first', 1, 60_000, 2).allowed, true);
});

test('生产日报 CSP 只允许本站和内联图片来源', () => {
  const headers = new Map<string, string>();
  let nextCalled = false;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  } as any;
  securityHeaders(true)({} as any, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  const policy = headers.get('Content-Security-Policy') || '';
  assert.match(policy, /img-src 'self' data: blob:/);
  assert.match(policy, /form-action 'self' https:\/\/chatgpt\.com/);
  assert.doesNotMatch(policy, /img-src[^;]*https:/);
});

test('V2 CSP permits only a validated exact R2 image origin', () => {
  const keys=['DIGEST_V2_ENABLED','DIGEST_R2_PUBLIC_ORIGIN','DIGEST_R2_ENV'] as const;
  const saved=keys.map(k=>process.env[k]);
  const policy=()=>{const h=new Map<string,string>();securityHeaders(true)({} as any,{setHeader:(k:string,v:string)=>h.set(k,v)} as any,()=>{});return h.get('Content-Security-Policy')!;};
  try {
    process.env.DIGEST_V2_ENABLED='true';process.env.DIGEST_R2_ENV='test';
    process.env.DIGEST_R2_PUBLIC_ORIGIN='https://media.example.com';
    assert.match(policy(),/img-src 'self' data: blob: https:\/\/media\.example\.com;/);
    assert.match(policy(),/script-src 'self';/);assert.match(policy(),/connect-src 'self'/);
    for(const invalid of ['https://*.example.com','https://example.com/path','https://user:pass@example.com','http://example.com','https://127.0.0.1','https://example.com; script-src *']) {process.env.DIGEST_R2_PUBLIC_ORIGIN=invalid;assert.doesNotMatch(policy(),/img-src[^;]*https:/);}
    process.env.DIGEST_R2_PUBLIC_ORIGIN='https://pub-example.r2.dev';process.env.DIGEST_R2_ENV='production';assert.doesNotMatch(policy(),/img-src[^;]*r2\.dev/);
    process.env.DIGEST_R2_ENV='test';process.env.DIGEST_V2_ENABLED='false';assert.doesNotMatch(policy(),/img-src[^;]*https:/);
  } finally {keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
