import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedWebPhotoRule, pagePhotoCandidates, discoverPhotoSource, photoPublicUrl, searchPageDiscoveries, nonCommercialPhotosEnabled } from './digest-v2-photo-sources.js';
import { findDigestPhotos } from './digest-v2-photos.js';

const page = 'https://www.flickr.com/photos/fixture/12345678901';
const image = 'https://live.staticflickr.com/65535/12345678901_abcdef1234_b.jpg';
const cc = 'https://creativecommons.org/licenses/by-nc/2.0/';
function html(license = cc, imageUrl = image) {
  return `<meta property="og:title" content="CoreWeave facility"><meta property="og:image" content="${imageUrl}"><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'ImageObject', contentUrl: imageUrl, license, author: { name: 'Fixture author' }, dateCreated: '2025-03-27' }] })}</script>`;
}
test('source-specific license verification binds exact image and requires explicit NC opt-in', async () => {
  assert.equal(pagePhotoCandidates(page, html()).candidates.length, 0);
  const candidates = pagePhotoCandidates(page, html(), { allowNonCommercial: true }).candidates;
  assert.equal(candidates.length, 1); assert.equal(candidates[0].usageRestriction, 'noncommercial'); assert.equal(candidates[0].photoDate, '2025-03-27');
  const fake: typeof fetch = async (url, init) => { assert.equal(url, page); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('authorization'), null); return new Response(html(), { headers: { 'content-type': 'text/html' } }); };
  const rule = await approvedWebPhotoRule(page, image, { allowNonCommercial: true }, fake);
  assert.deepEqual(rule.imageUrls, [image]); assert.equal(rule.credit?.licenseName, 'CC BY-NC 2.0');
  await assert.rejects(approvedWebPhotoRule(page, image.replace('_b.jpg', '_c.jpg'), { allowNonCommercial: true }, fake), /NOT_APPROVED/);
  await assert.rejects(approvedWebPhotoRule(page, image, {}, fake), /NOT_APPROVED/);
  assert.equal(pagePhotoCandidates(page, html('https://creativecommons.org/licenses/by/4.0/')).candidates.length, 1);
  assert.equal(pagePhotoCandidates(page, html('https://creativecommons.org/licenses/by-nd/4.0/')).candidates.length, 0);
  assert.equal(pagePhotoCandidates(page, html('https://creativecommons.org.evil.com/licenses/by/4.0/')).candidates.length, 0);
  assert.equal(pagePhotoCandidates(page, html('https://creativecommons.org/licenses/by/4.0/', image.replace('12345678901_', '99999999999_'))).candidates.length, 0);
  const footer = `<meta property="og:image" content="${image}"><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">Site text license</a>`;
  assert.equal(pagePhotoCandidates(page, footer).candidates.length, 0);
  assert.equal(pagePhotoCandidates('https://news.example.com/article', html('https://creativecommons.org/licenses/by/4.0/')).candidates.length, 0);
});
test('NC configuration is account scoped and cannot be enabled by untrusted tool arguments', async () => {
  const previous = process.env.DIGEST_V2_NONCOMMERCIAL_PHOTO_USER_IDS;
  try { process.env.DIGEST_V2_NONCOMMERCIAL_PHOTO_USER_IDS = ' owner, second '; assert.equal(nonCommercialPhotosEnabled('owner'), true); assert.equal(nonCommercialPhotosEnabled('other'), false); assert.equal(nonCommercialPhotosEnabled(''), false); }
  finally { if (previous === undefined) delete process.env.DIGEST_V2_NONCOMMERCIAL_PHOTO_USER_IDS; else process.env.DIGEST_V2_NONCOMMERCIAL_PHOTO_USER_IDS = previous; }
  await assert.rejects(findDigestPhotos([{ storyId: 's1', query: 'CoreWeave', allowNonCommercial: true }]), /REQUEST_INVALID/);
});
test('search aggregation never promotes Openverse metadata to rights-holder approval', async () => {
  const makeFetcher = (sourceHtml: string): typeof fetch => async url => new URL(String(url)).hostname === 'api.openverse.org'
    ? Response.json({ results: [{ title: 'CoreWeave', foreign_landing_url: page, url: image, license_url: cc }] })
    : new Response(sourceHtml, { headers: { 'content-type': 'text/html' } });
  const found = await discoverPhotoSource('openverse', 'CoreWeave', makeFetcher(html()), { allowNonCommercial: true });
  assert.equal(found.source.status, 'ok'); assert.equal(found.candidates[0].licenseName, 'CC BY-NC 2.0');
  const denied = await discoverPhotoSource('openverse', 'CoreWeave', makeFetcher('<meta property="og:image" content="' + image + '">'), { allowNonCommercial: true });
  assert.equal(denied.source.status, 'review_required'); assert.equal(denied.candidates.length, 0); assert.equal(denied.discoveries.length, 1);
  const rateLimited = await discoverPhotoSource('openverse', 'CoreWeave', async () => new Response('', { status: 429 }));
  assert.equal(rateLimited.source.code, 'PHOTO_HTTP_429');
});
test('public search discoveries are bounded, relevant, unapproved and survive provider failures', async () => {
  const m = (title: string) => JSON.stringify({ purl: page, murl: image, t: title }).replace(/"/g, '&quot;');
  assert.equal(searchPageDiscoveries('bing', `<a m="${m('CoreWeave facility')}">`, 'CoreWeave').length, 1);
  assert.equal(searchPageDiscoveries('bing', `<a m="${m('Unrelated actor')}">`, 'CoreWeave').length, 0);
  const result = await findDigestPhotos([{ storyId: 'market-ai-credit', query: 'CoreWeave', providers: ['openverse', 'bing', 'baidu'] }], async url => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.openverse.org') return new Response('', { status: 503 });
    return new Response(host === 'www.bing.com' ? `<a m="${m('CoreWeave facility')}">` : '<html>Client rendered results</html>', { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.results[0].status, 'review_required'); assert.equal(result.results[0].candidates.length, 0);
  assert.equal(result.results[0].discoveries.length, 1);
  assert.equal(result.results[0].sources.find(s => s.provider === 'baidu')?.code, 'BROWSER_DISCOVERY_REQUIRED');
  assert.ok(result.results[0].searchLinks.some(s => s.provider === 'pexels'));
});
test('public image/page boundaries reject private, credential-bearing and newsletter tracking URLs', async () => {
  for (const url of ['http://example.com/p.jpg', 'https://127.0.0.1/p', 'https://user:pass@example.com/p', 'https://example.com/p?token=private', 'https://example.com/p?email=private', 'https://mail.google.com/p', 'https://example.com/p#private']) assert.equal(photoPublicUrl(url), null);
  for (const request of [{ providers: ['unknown'] }, { providers: ['commons', 'commons'] }, { pageUrls: ['https://127.0.0.1/p'] }, { pageUrls: Array(4).fill(page) }]) await assert.rejects(findDigestPhotos([{ storyId: 's1', query: 'CoreWeave', ...request }]), /REQUEST_INVALID/);
  const large = await discoverPhotoSource('bing', 'CoreWeave', async () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }));
  assert.equal(large.source.code, 'PHOTO_METADATA_SIZE');
});
