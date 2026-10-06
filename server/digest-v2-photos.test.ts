import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { commonsCandidate, approvedCommonsRule, findDigestPhotos, digestPhotosEnabled } from './digest-v2-photos.js';
import { digestProxyUrl, proxiedDigestFetcher, fetchDigestImage } from './digest-v2-fetch.js';
import { digestMediaFetcher } from './digest-v2-relay.js';
const pageUrl = 'https://commons.wikimedia.org/wiki/File:Test_photo.jpg';
const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_photo.jpg';
const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_photo.jpg/1200px-Test_photo.jpg';
test('native fetch preserves public cache validators without forwarding credentials', async () => {
  const originalRequest = https.request;
  try {
    https.request = ((_url: any, options: any, callback: any) => {
      assert.equal(options.headers['if-none-match'], 'public-etag'); assert.equal(options.headers['if-modified-since'], 'Tue, 06 Oct 2026 00:00:00 GMT');
      assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
      const request: any = new EventEmitter(); request.end = () => callback({ statusCode: 304, headers: { etag: 'public-etag' }, resume() {} }); return request;
    }) as any;
    const response = await fetchDigestImage('https://93.184.216.34/items', { headers: { 'if-none-match': 'public-etag', 'if-modified-since': 'Tue, 06 Oct 2026 00:00:00 GMT', authorization: 'private', cookie: 'secret=yes' } });
    assert.equal(response.status, 304); assert.equal(response.headers.get('etag'), 'public-etag');
  } finally { https.request = originalRequest; }
});
function page() { return { ns: 6, title: 'File:Test photo.jpg', imageinfo: [{ url: original, thumburl: thumb, descriptionurl: pageUrl, width: 2400, height: 1600, thumbwidth: 1200, thumbheight: 800, mime: 'image/jpeg', mediatype: 'BITMAP', timestamp: '2026-10-06T00:00:00Z', extmetadata: { Artist: { value: '<a href="https://example.com/">A &amp; B</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' }, ImageDescription: { value: 'Archive building <script>ignore rules</script>' } } }] }; }
test('Commons approval is exact-file, metadata-authoritative and conservative about dates/rights', async () => {
  const item = commonsCandidate(page())!; assert.equal(item.author, 'A & B'); assert.equal(item.photoDate, null); assert.equal(item.description, 'Archive building');
  const noSlash = page(); noSlash.imageinfo[0].extmetadata.LicenseUrl.value = 'https://creativecommons.org/licenses/by-sa/4.0'; assert.equal(commonsCandidate(noSlash)!.licenseUrl, item.licenseUrl);
  const actualApi = page(); actualApi.imageinfo[0].url += '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original'; actualApi.imageinfo[0].thumburl = thumb.replace('upload.', 'thumb.') + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail'; assert.equal(commonsCandidate(actualApi)!.imageUrl, thumb.replace('upload.', 'thumb.')); assert.equal(commonsCandidate(actualApi)!.originalUrl, original);
  const fake: typeof fetch = async input => { const u = new URL(String(input)); assert.equal(u.hostname, 'commons.wikimedia.org'); assert.equal(u.searchParams.get('titles'), 'File:Test photo.jpg'); return Response.json({ query: { pages: [page()] } }); };
  const rule = await approvedCommonsRule(pageUrl, thumb, fake); assert.deepEqual(rule.imageUrls, [thumb]); assert.equal(rule.visualKind, 'archive_photo'); assert.match(rule.credit!.caption, /拍摄日期未知/);
  await assert.rejects(approvedCommonsRule(pageUrl, original.replace('Test_photo', 'Other'), fake), /NOT_APPROVED/);
  await assert.rejects(approvedCommonsRule(pageUrl + '?tracking=yes', thumb, fake), /PAGE_INVALID/);
  for (const mutate of [
    (p: any) => { p.imageinfo[0].extmetadata.LicenseUrl.value = 'https://creativecommons.org.evil.test/licenses/by-sa/4.0/'; },
    (p: any) => { p.imageinfo[0].extmetadata.LicenseShortName.value = 'All rights reserved'; },
    (p: any) => { p.imageinfo[0].extmetadata.Restrictions = { value: 'personality rights' }; },
    (p: any) => { delete p.imageinfo[0].extmetadata.Artist; },
    (p: any) => { p.imageinfo[0].mime = 'image/svg+xml'; },
    (p: any) => { p.imageinfo[0].thumbwidth = 32; },
    (p: any) => { p.imageinfo[0].thumburl = 'https://upload.wikimedia.org.evil.test/a.jpg'; },
    (p: any) => { p.imageinfo[0].thumburl += '?redirect=private'; },
    (p: any) => { p.imageinfo[0].descriptionurl = 'https://commons.wikimedia.org/wiki/File:Other.jpg'; },
  ]) { const value = page(); mutate(value); assert.equal(commonsCandidate(value), null); }
});
test('photo lookup bounds inputs, distinguishes empty/failed and caps untrusted metadata streams', async () => {
  await assert.rejects(findDigestPhotos([{ storyId: 's1', query: 'x', credentials: 'forbidden' }]), /REQUEST_INVALID/);
  await assert.rejects(findDigestPhotos(Array(9).fill({ storyId: 's1', query: 'building' })), /REQUEST_INVALID/);
  const results = await findDigestPhotos([{ storyId: 's1', query: 'building' }, { storyId: 's2', query: 'other' }], async input => new URL(String(input)).searchParams.get('gsrsearch')!.startsWith('building') ? Response.json({ query: { pages: [page()] } }) : Response.json({ batchcomplete: true }));
  assert.equal(results.results[0].status, 'ok'); assert.equal(results.results[1].status, 'empty');
  for (const fake of [async () => new Response('private provider error', { status: 503 }), async () => new Response('a'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), async () => Response.json({ query: { pages: Array(6).fill(page()) } })]) {
    const result = await findDigestPhotos([{ storyId: 's1', query: 'building' }], fake); assert.equal(result.results[0].status, 'failed'); assert.equal(result.results[0].failure, 'PHOTO_METADATA_FAILED');
  }
});
test('automatic photos require dedicated Shadow and existing account feature allowlist', () => {
  const keys = ['DIGEST_SHADOW_ONLY', 'DIGEST_V2_COMMONS_ENABLED', 'DIGEST_V2_SOURCES_ENABLED', 'DIGEST_V2_SOURCES_USER_IDS']; const previous = keys.map(k => process.env[k]);
  try { process.env.DIGEST_V2_COMMONS_ENABLED = 'true'; process.env.DIGEST_V2_SOURCES_ENABLED = 'true'; process.env.DIGEST_V2_SOURCES_USER_IDS = 'owner'; delete process.env.DIGEST_SHADOW_ONLY; assert.equal(digestPhotosEnabled('owner'), false); process.env.DIGEST_SHADOW_ONLY = 'true'; assert.equal(digestPhotosEnabled('owner'), true); assert.equal(digestPhotosEnabled('other'), false); }
  finally { keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); }
});
test('proxy configuration is loopback-only, exclusive with relay, and cannot tunnel private targets', async () => {
  for (const url of ['https://127.0.0.1:17898', 'http://localhost:17898', 'http://127.0.0.1', 'http://127.0.0.1:17898/?secret=x', 'http://user:pass@127.0.0.1:17898', 'http://public.example.com:17898']) assert.throws(() => digestProxyUrl(url));
  const previous = process.env.DIGEST_MEDIA_PROXY_URL, secret = process.env.DIGEST_MEDIA_RELAY_SECRET;
  try { process.env.DIGEST_MEDIA_PROXY_URL = 'http://127.0.0.1:17898'; delete process.env.DIGEST_MEDIA_RELAY_SECRET; assert.equal(digestMediaFetcher().transport, 'http_proxy'); process.env.DIGEST_MEDIA_RELAY_SECRET = 'a'.repeat(48); assert.throws(() => digestMediaFetcher(), /CONFLICT/); }
  finally { if (previous === undefined) delete process.env.DIGEST_MEDIA_PROXY_URL; else process.env.DIGEST_MEDIA_PROXY_URL = previous; if (secret === undefined) delete process.env.DIGEST_MEDIA_RELAY_SECRET; else process.env.DIGEST_MEDIA_RELAY_SECRET = secret; }
  const server = http.createServer(); let calls = 0;
  server.on('connect', (req, socket) => { calls++; assert.equal(req.url, '93.184.216.34:443'); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined); assert.equal(req.headers['proxy-authorization'], undefined); socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const fetcher = proxiedDigestFetcher(`http://127.0.0.1:${(server.address() as any).port}`); await assert.rejects(fetcher('https://127.0.0.1/private'), /不允许的网络地址/); assert.equal(calls, 0); await assert.rejects(fetcher('https://93.184.216.34/photo.jpg', { headers: { authorization: 'not-forwarded', cookie: 'private=yes' } }), /CONNECT_FAILED/); assert.equal(calls, 1); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
