import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
if (process.env.ORBIT_RELEASE_SMOKE !== 'true' || process.env.BACKGROUND_JOBS_ENABLED !== 'false' ||
    process.env.ORBIT_PROACTIVE_ENABLED !== 'false' || process.env.ANDROID_PUSH_ENABLED !== 'false' ||
    process.env.APP_URL !== 'https://release-smoke.invalid' || !process.env.DATA_DIR) {
  throw new Error('Release smoke requires the isolated archive runner and an external temporary DATA_DIR');
}
const dataDir = await realpath(process.env.DATA_DIR);
if (dataDir !== path.join(path.dirname(root), 'data') || (await readdir(dataDir)).length) {
  throw new Error('Release smoke requires a new sibling data directory');
}

const { app, initializeServer } = await import(pathToFileURL(path.join(root, 'server/application.ts')).href);
await initializeServer();
const listener = app.listen(0, '127.0.0.1');
try {
  await new Promise((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  const url = 'http://127.0.0.1:' + listener.address().port;
  const get = resource => fetch(url + resource, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const entry = await readFile('dist/index.html', 'utf8');
  for (const route of ['/', '/today']) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/, route);
    assert.equal(await response.text(), entry, route);
  }
  const assets = [...new Set([...entry.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(match => match[1]))];
  assert(assets.some(asset => asset.endsWith('.js')), 'A release must include its Javascript entry');
  for (const asset of assets) {
    const response = await get(asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), asset.endsWith('.js') ? /javascript/ : /text\/css/, asset);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile('dist' + asset), asset);
  }
  const protectedTool = await get('/tools/');
  assert.ok([302, 401, 403].includes(protectedTool.status), 'Unauthenticated protected Tools must be blocked');
  await protectedTool.body?.cancel();
  console.log('Isolated archive boot and static asset checks passed');
} finally {
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
}
