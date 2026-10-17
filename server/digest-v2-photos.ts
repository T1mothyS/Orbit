import { digestMediaFetcher } from './digest-v2-relay.js';
import { digestSourcesEnabled } from './digest-v2-sources.js';
import type { MediaRule } from './digest-v2-media.js';
import { PHOTO_PROVIDERS, discoverPhotoSource, inspectPhotoPage, photoPublicUrl, photoSearchLinks, type PhotoOptions, type PhotoDiscovery, type PhotoSourceResult } from './digest-v2-photo-sources.js';

export const PHOTO_REQUEST_SCHEMA = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['storyId', 'query'], properties: { storyId: { type: 'string', minLength: 1, maxLength: 80 }, query: { type: 'string', minLength: 2, maxLength: 160 }, providers: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: [...PHOTO_PROVIDERS] } }, pageUrls: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string', format: 'uri', maxLength: 2048 } } } } };
export interface PhotoCandidate { title: string; pageUrl: string; imageUrl: string; originalUrl: string; width: number; height: number; author: string; licenseName: string; licenseUrl: string; description: string; photoDate: string | null; provider?: string; usageRestriction?: 'standard' | 'noncommercial' }
export function digestPhotosEnabled(userId: string): boolean {
  return process.env.DIGEST_V2_COMMONS_ENABLED === 'true' && digestSourcesEnabled(userId)
    && (process.env.DIGEST_SHADOW_ONLY === 'true'
      || (process.env.DIGEST_V2_COMMONS_PRODUCTION_ENABLED === 'true' && process.env.DIGEST_PRODUCTION_CONTRACT === 'daily-digest.v2'));
}
function plain(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, m => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }[m]!))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return cp > 31 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ''; })
    .replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try { const u = new URL(value); if (u.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname) || u.port || u.username || u.password || u.hash || !u.pathname.startsWith('/wikipedia/commons/') || [...u.searchParams.keys()].some(k => !['utm_source', 'utm_campaign', 'utm_content'].includes(k))) return null; u.search = ''; return u.href; } catch { return null; }
}
function fileTitle(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.hostname !== 'commons.wikimedia.org' || u.port || u.username || u.password || u.search || u.hash || !u.pathname.startsWith('/wiki/File:')) throw new Error('PHOTO_PAGE_INVALID');
  const title = decodeURIComponent(u.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
  if (title.length > 240 || /[\u0000-\u001f|]/.test(title)) throw new Error('PHOTO_PAGE_INVALID');
  return title;
}
export function commonsCandidate(page: any): PhotoCandidate | null {
  const info = page?.imageinfo?.[0];
  if (page?.ns !== 6 || typeof page.title !== 'string' || page.title.length > 240 || !info || !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime) || info.mediatype !== 'BITMAP') return null;
  const originalUrl = imageUrl(info.url), selectedUrl = imageUrl(info.thumburl || info.url);
  const width = info.thumburl ? info.thumbwidth : info.width, height = info.thumburl ? info.thumbheight : info.height;
  if (!originalUrl || !selectedUrl || !Number.isInteger(width) || !Number.isInteger(height) || width < 480 || height < 320 || width * height > 20_000_000) return null;
  const meta = info.extmetadata || {}, get = (k: string) => plain(meta[k]?.value);
  const author = get('Artist'), name = get('LicenseShortName'), rawLicense = get('LicenseUrl');
  let licenseUrl: URL;
  try { licenseUrl = new URL(rawLicense.startsWith('//') ? `https:${rawLicense}` : rawLicense); } catch { return null; }
  if (!['http:', 'https:'].includes(licenseUrl.protocol) || licenseUrl.hostname !== 'creativecommons.org' || licenseUrl.port || licenseUrl.username || licenseUrl.password || licenseUrl.search || licenseUrl.hash) return null;
  const license = licenseUrl.pathname.match(/^\/licenses\/(by|by-sa)\/(2\.0|2\.5|3\.0|4\.0)\/?$/);
  const cc0 = /^\/publicdomain\/zero\/1\.0\/?$/.test(licenseUrl.pathname);
  const expected = cc0 ? 'CC0' : license ? `CC ${license[1].toUpperCase()} ${license[2]}` : '';
  if (!author || !expected || (cc0 ? !/^CC0(?: 1\.0)?$/i.test(name) : name.toUpperCase() !== expected) || get('Restrictions')) return null;
  licenseUrl.protocol = 'https:';
  if (!licenseUrl.pathname.endsWith('/')) licenseUrl.pathname += '/';
  try { if (fileTitle(info.descriptionurl) !== page.title.replace(/_/g, ' ')) return null; } catch { return null; }
  const date = get('DateTimeOriginal');
  return { title: plain(page.title), pageUrl: info.descriptionurl, imageUrl: selectedUrl, originalUrl, width, height, author, licenseName: expected, licenseUrl: licenseUrl.href, description: get('ImageDescription').slice(0, 240), photoDate: /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(date) ? date.slice(0, 10) : null };
}
async function commonsPages(params: Record<string, string>, fetcher = digestMediaFetcher().fetcher): Promise<any[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const query = { action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|size|mime|mediatype|extmetadata', iiurlwidth: '1200', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|DateTimeOriginal|Restrictions', ...params };
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetcher(url.href, { signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'OrbitDigestShadow/1.0 (bounded Commons photo metadata lookup)' } });
  if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length') || 0) > 1024 * 1024 || !response.body) throw new Error('PHOTO_METADATA_FAILED');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw new Error('PHOTO_METADATA_SIZE'); chunks.push(part.value); } } finally { await reader.cancel(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value.error && value.batchcomplete && !value.query) return [];
  if (value.error || !Array.isArray(value.query?.pages) || value.query.pages.length > 5) throw new Error('PHOTO_METADATA_INVALID');
  return value.query.pages;
}
export async function findDigestPhotos(requests: unknown, fetcher = digestMediaFetcher().fetcher, options: PhotoOptions = {}) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 8) throw new Error('PHOTO_REQUEST_INVALID');
  const ids = new Set<string>();
  for (const r of requests) {
    if (!r || Object.keys(r).some(k => !['storyId', 'query', 'providers', 'pageUrls'].includes(k)) || typeof r.storyId !== 'string' || !r.storyId.trim() || r.storyId.length > 80 || /[\u0000-\u001f]/.test(r.storyId) || typeof r.query !== 'string' || r.query.trim().length < 2 || r.query.length > 160 || /[\u0000-\u001f]/.test(r.query) || ids.has(r.storyId)
        || (r.providers !== undefined && (!Array.isArray(r.providers) || !r.providers.length || r.providers.length > 4 || new Set(r.providers).size !== r.providers.length || r.providers.some((v: any) => !PHOTO_PROVIDERS.includes(v))))
        || (r.pageUrls !== undefined && (!Array.isArray(r.pageUrls) || r.pageUrls.length > 3 || new Set(r.pageUrls).size !== r.pageUrls.length || r.pageUrls.some((v: any) => !photoPublicUrl(v))))) throw new Error('PHOTO_REQUEST_INVALID');
    ids.add(r.storyId);
  }
  const results: Array<{ storyId: string; status: string; candidates: PhotoCandidate[]; discoveries: PhotoDiscovery[]; sources: PhotoSourceResult[]; searchLinks: ReturnType<typeof photoSearchLinks>; failure?: string }> = [];
  const budget = AbortSignal.timeout(45_000), upstream = fetcher;
  fetcher = (input, init) => upstream(input, { ...init, signal: init?.signal ? AbortSignal.any([budget, init.signal]) : budget });
  // Keep external load bounded and report each failure separately; never a whole-host permission.
  const search = async (r: { storyId: string; query: string; providers?: typeof PHOTO_PROVIDERS[number][]; pageUrls?: string[] }) => {
    const candidates: PhotoCandidate[] = [], discoveries: PhotoDiscovery[] = [], sources: PhotoSourceResult[] = [];
    for (const pageUrl of r.pageUrls || []) {
      try { const found = await inspectPhotoPage(pageUrl, fetcher, options); candidates.push(...found.candidates); discoveries.push(...found.discoveries); sources.push({ provider: 'article', status: found.candidates.length ? 'ok' : found.discoveries.length ? 'review_required' : 'empty', count: found.discoveries.length }); }
      catch { sources.push({ provider: 'article', status: 'failed', count: 0, code: 'PHOTO_METADATA_FAILED' }); }
    }
    // Two providers at a time, and two stories at a time; no unbounded fan-out.
    const providers = r.providers || [...PHOTO_PROVIDERS];
    for (let i = 0; i < providers.length; i += 2) await Promise.all(providers.slice(i, i + 2).map(async provider => {
      if (provider !== 'commons') { const found = await discoverPhotoSource(provider, r.query, fetcher, options); candidates.push(...found.candidates); discoveries.push(...found.discoveries); sources.push(found.source); return; }
      try {
        const pages = await commonsPages({ generator: 'search', gsrsearch: `${r.query.trim()} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '5' }, fetcher);
        const raw = pages.map(commonsCandidate).filter((c): c is PhotoCandidate => !!c);
        const entity = r.query.match(/[a-z][a-z0-9-]{3,}/i)?.[0]?.toLowerCase();
        const found = raw.filter(c => !entity || `${c.title} ${c.description} ${c.pageUrl}`.toLowerCase().includes(entity));
        candidates.push(...found.map(c => ({ ...c, provider: 'commons' })));
        sources.push({ provider, status: found.length ? 'ok' : 'empty', count: found.length, ...(raw.length && !found.length ? { code: 'QUERY_MISMATCH' } : {}) });
      }
      catch { sources.push({ provider, status: 'failed', count: 0, code: 'PHOTO_METADATA_FAILED' }); }
    }));
    const rank = (c: PhotoCandidate) => c.provider === 'article' || c.provider === 'flickr' ? 0 : c.provider === 'openverse' ? 1 : 2;
    // Commons search can split an uncommon company name into unrelated words (Core + Weave).
    const entity = r.query.match(/[a-z][a-z0-9-]{3,}/i)?.[0]?.toLowerCase();
    const related = candidates.filter(c => !entity || `${c.title} ${c.description} ${c.pageUrl}`.toLowerCase().includes(entity));
    const ordered = [...new Map(related.sort((a, b) => rank(a) - rank(b) || a.imageUrl.localeCompare(b.imageUrl)).map(c => [c.imageUrl, c])).values()].slice(0, 10);
    const status = ordered.length ? 'ok' : sources.every(s => s.status === 'failed') ? 'failed' : discoveries.length || sources.some(s => s.status === 'review_required') ? 'review_required' : 'empty';
    results.push({ storyId: r.storyId, status, candidates: ordered, discoveries: [...new Map(discoveries.map(c => [c.imageUrl, c])).values()].slice(0, 15), sources,
      searchLinks: photoSearchLinks(r.query), ...(status === 'failed' ? { failure: 'PHOTO_METADATA_FAILED' } : {}) });
  };
  for (let i = 0; i < requests.length; i += 2) await Promise.all(requests.slice(i, i + 2).map(search));
  results.sort((a, b) => requests.findIndex(r => r.storyId === a.storyId) - requests.findIndex(r => r.storyId === b.storyId));
  return { results, usage: options.allowNonCommercial ? 'noncommercial' : 'standard', guidance: '按原新闻/官方页面、开放图库和搜索来源逐步找图。candidates已核对来源许可但仍须判断贴题；discoveries和searchLinks仅供补查，不能视作使用授权。Google/Bing/百度结果须回原站核对；浏览器补查所得原页面可用pageUrls提交。Pexels/Pixabay/Unsplash须遵守原站条款，无法核验不自动通过。NC仅限已明确启用的非商业账号。不把资料照称为今天现场，不把行业背景图称为某公司设施。pageUrl加入evidence、media.url用精确imageUrl；发布再次核对许可并下载托管。所有market/macro/stories都需覆盖，来源图标不算新闻照片。' };
}
export async function approvedCommonsRule(pageUrl: string, url: string, fetcher?: typeof fetch): Promise<MediaRule> {
  const title = fileTitle(pageUrl);
  const pages = await commonsPages({ titles: title }, fetcher);
  const candidate = pages.map(commonsCandidate).find(c => c && c.title.replace(/_/g, ' ') === title && [c.imageUrl, c.originalUrl].includes(url));
  if (!candidate) throw new Error('PHOTO_NOT_APPROVED');
  return { pageHost: 'commons.wikimedia.org', pageUrl, imageHosts: [new URL(url).hostname], imageUrls: [url], policy: 'LICENSED', visualKind: 'archive_photo', licenseRef: `${candidate.licenseName}:${candidate.pageUrl}`, credit: { caption: `资料照${candidate.photoDate ? `（${candidate.photoDate}）` : '（拍摄日期未知）'}：${candidate.title.replace(/^File:/, '').replace(/\.(jpg|jpeg|png|webp)$/i, '')}`.slice(0, 300), author: candidate.author, sourcePage: candidate.pageUrl, licenseName: candidate.licenseName, licenseUrl: candidate.licenseUrl } };
}
