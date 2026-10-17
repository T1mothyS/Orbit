import { digestMediaFetcher } from './digest-v2-relay.js';
import { publicDigestUrl, canonicalSourceUrl } from './digest-v2-contract.js';
import type { MediaRule } from './digest-v2-media.js';
import type { PhotoCandidate } from './digest-v2-photos.js';

export const PHOTO_PROVIDERS = ['commons', 'openverse', 'bing', 'baidu'] as const;
export type PhotoProvider = typeof PHOTO_PROVIDERS[number];
export type PhotoOptions = { allowNonCommercial?: boolean };
export interface PhotoDiscovery { title: string; pageUrl: string; imageUrl: string; provider: string }
export interface PhotoSourceResult { provider: string; status: 'ok' | 'empty' | 'failed' | 'review_required'; count: number; code?: string; searchUrl?: string }

export function nonCommercialPhotosEnabled(userId: string): boolean {
  return (process.env.DIGEST_V2_NONCOMMERCIAL_PHOTO_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean).includes(userId);
}
function clean(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function decode(value: string): string {
  return value.replace(/&(?:quot|amp|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, value => {
    const named: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[value]) return named[value];
    const cp = value.startsWith('&#x') ? parseInt(value.slice(3), 16) : parseInt(value.slice(2), 10);
    return cp > 31 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
  });
}
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3])]));
}
export function photoPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || !publicDigestUrl(value) || !canonicalSourceUrl(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
      || [...url.searchParams.keys()].some(k => /token|signature|auth|credential|key|expires/i.test(k))) return null;
  return url.href;
}
async function metadata(url: string, accept: string, fetcher: typeof fetch): Promise<string> {
  if (!photoPublicUrl(url)) throw Error('PHOTO_URL_INVALID');
  // The shared fetcher pins public DNS and never forwards cookies or credentials.
  let response: Response;
  for (let attempt = 0;; attempt++) {
    try { response = await fetcher(url, { signal: AbortSignal.timeout(12_000), redirect: 'error', headers: { accept, 'user-agent': 'OrbitDigest/1.0 (bounded photo discovery)' } }); break; }
    catch (error: any) { if (attempt || !(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code) || error?.name === 'TimeoutError')) throw error; }
  }
  if (!response.ok) { await response.body?.cancel(); throw Error(`PHOTO_HTTP_${response.status}`); }
  if (!response.headers.get('content-type')?.includes(accept === 'application/json' ? 'application/json' : 'text/html')) { await response.body?.cancel(); throw Error('PHOTO_METADATA_TYPE'); }
  if (Number(response.headers.get('content-length') || 0) > 1024 * 1024 || !response.body) { await response.body?.cancel(); throw Error('PHOTO_METADATA_SIZE'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw Error('PHOTO_METADATA_SIZE'); chunks.push(part.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
function license(value: unknown, options: PhotoOptions): { name: string; url: string; nonCommercial: boolean } | null {
  if (typeof value !== 'string') return null;
  let url: URL; try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'creativecommons.org' || url.port || url.username || url.password || url.search || url.hash) return null;
  if (/^\/publicdomain\/zero\/1\.0\/?$/.test(url.pathname)) return { name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', nonCommercial: false };
  const m = url.pathname.match(/^\/licenses\/(by|by-sa|by-nc|by-nc-sa)\/(2\.0|2\.5|3\.0|4\.0)\/?$/);
  if (!m || (m[1].includes('nc') && !options.allowNonCommercial)) return null;
  return { name: `CC ${m[1].toUpperCase()} ${m[2]}`, url: `https://creativecommons.org/licenses/${m[1]}/${m[2]}/`, nonCommercial: m[1].includes('nc') };
}
function sourceOwnsImage(page: URL, image: URL): boolean {
  if (page.hostname === 'www.flickr.com' && /^\/photos\/[^/]+\/\d+\/?$/.test(page.pathname)) {
    const id = page.pathname.split('/')[3];
    return image.hostname === 'live.staticflickr.com' && new RegExp(`^/\\d+/${id}_[a-f0-9]+(?:_[a-z0-9]+)?\\.(?:jpg|png|webp)$`, 'i').test(image.pathname);
  }
  return image.hostname === page.hostname || image.hostname.endsWith(`.${page.hostname}`);
}

/** Only image-specific JSON-LD grants approval; a footer/site license does not license a news photo. */
export function pagePhotoCandidates(pageUrl: string, html: string, options: PhotoOptions = {}): { candidates: PhotoCandidate[]; discoveries: PhotoDiscovery[] } {
  if (!photoPublicUrl(pageUrl) || html.length > 1024 * 1024) throw Error('PHOTO_PAGE_INVALID');
  const page = new URL(pageUrl), metas = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]{0,8000}>/gi)) { const a = attrs(match[0]); if (a.content) metas.set(a.property || a.name, a.content); }
  const candidates: PhotoCandidate[] = [], discoveries: PhotoDiscovery[] = [];
  const title = clean(metas.get('og:title')), description = clean(metas.get('og:description'));
  const og = photoPublicUrl(metas.get('og:image'));
  if (og) discoveries.push({ title, pageUrl, imageUrl: og, provider: 'article' });
  let visited = 0;
  const visit = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8 || ++visited > 200) return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach(v => visit(v, depth + 1)); return; }
    if ([value['@type']].flat().includes('ImageObject')) {
      const imageUrl = photoPublicUrl(value.contentUrl), approved = license(value.license, options);
      const author = clean(typeof value.author === 'string' ? value.author : value.author?.name || value.creator?.name);
      if (imageUrl) {
        discoveries.push({ title: clean(value.name) || title, pageUrl, imageUrl, provider: 'article' });
        if (approved && author && sourceOwnsImage(page, new URL(imageUrl))) candidates.push({ title: clean(value.name) || title, pageUrl, imageUrl, originalUrl: imageUrl,
          width: Number.isInteger(value.width) ? value.width : 0, height: Number.isInteger(value.height) ? value.height : 0,
          author, licenseName: approved.name, licenseUrl: approved.url, description: clean(value.description) || description,
          photoDate: typeof value.dateCreated === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.dateCreated) && Number.isFinite(Date.parse(value.dateCreated)) ? value.dateCreated.slice(0, 10) : null,
          provider: page.hostname === 'www.flickr.com' ? 'flickr' : 'article', usageRestriction: approved.nonCommercial ? 'noncommercial' : 'standard' });
      }
    }
    for (const key of ['@graph', 'image', 'primaryImageOfPage']) visit(value[key], depth + 1);
  };
  for (const match of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].slice(0, 100)) {
    if (attrs(match[1]).type !== 'application/ld+json' || match[2].length > 100_000) continue;
    try { visit(JSON.parse(match[2])); } catch { /* Untrusted malformed metadata is not approval. */ }
  }
  return { candidates: [...new Map(candidates.map(c => [c.imageUrl, c])).values()].slice(0, 5), discoveries: [...new Map(discoveries.map(c => [c.imageUrl, c])).values()].slice(0, 5) };
}
export async function inspectPhotoPage(pageUrl: string, fetcher = digestMediaFetcher().fetcher, options: PhotoOptions = {}) {
  return pagePhotoCandidates(pageUrl, await metadata(pageUrl, 'text/html', fetcher), options);
}
export async function approvedWebPhotoRule(pageUrl: string, imageUrl: string, options: PhotoOptions = {}, fetcher = digestMediaFetcher().fetcher): Promise<MediaRule> {
  if (!photoPublicUrl(imageUrl)) throw Error('PHOTO_URL_INVALID');
  const found = (await inspectPhotoPage(pageUrl, fetcher, options)).candidates.find(c => c.imageUrl === imageUrl);
  if (!found) throw Error('PHOTO_NOT_APPROVED');
  return { pageHost: new URL(pageUrl).hostname, pageUrl, imageHosts: [new URL(imageUrl).hostname], imageUrls: [imageUrl], policy: 'LICENSED', visualKind: 'archive_photo',
    licenseRef: `${found.licenseName}:${pageUrl}`, credit: { caption: `资料照${found.photoDate ? `（${found.photoDate}）` : '（拍摄日期未知）'}：${found.title}`.slice(0, 300), author: found.author, sourcePage: pageUrl, licenseName: found.licenseName, licenseUrl: found.licenseUrl } };
}
export function photoSearchLinks(query: string) {
  return [
    { provider: 'google', url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}` },
    { provider: 'bing', url: `https://www.bing.com/images/search?q=${encodeURIComponent(query)}` },
    { provider: 'baidu', url: `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(query)}` },
    { provider: 'pexels', url: `https://www.pexels.com/search/${encodeURIComponent(query)}/` },
    { provider: 'pixabay', url: `https://pixabay.com/images/search/${encodeURIComponent(query)}/` },
    { provider: 'unsplash', url: `https://unsplash.com/s/photos/${encodeURIComponent(query)}` },
  ];
}
export function searchPageDiscoveries(provider: 'bing' | 'baidu', html: string, query: string): PhotoDiscovery[] {
  // Public rendered result metadata only. Never execute page scripts or decode private/internal endpoints.
  const values: any[] = [];
  if (provider === 'bing') for (const m of html.matchAll(/\bm="([^"]{1,16000})"/g)) { try { values.push(JSON.parse(decode(m[1]))); } catch { /* Skip. */ } if (values.length >= 30) break; }
  else for (const m of html.matchAll(/<a\b[^>]{0,16000}>/gi)) { const a = attrs(m[0]); if (a['data-imgurl'] && a['data-fromurl']) values.push({ purl: a['data-fromurl'], murl: a['data-imgurl'], t: a.title || '' }); if (values.length >= 30) break; }
  const firstEntity = query.match(/[a-z][a-z0-9-]{3,}/i)?.[0]?.toLowerCase();
  return values.flatMap(v => {
    const pageUrl = photoPublicUrl(v.purl), imageUrl = photoPublicUrl(v.murl), title = clean(v.t);
    if (!pageUrl || !imageUrl || (firstEntity && !`${title} ${clean(v.desc)} ${pageUrl}`.toLowerCase().includes(firstEntity))) return [];
    return [{ title, pageUrl, imageUrl, provider }];
  }).slice(0, 5);
}
export async function discoverPhotoSource(provider: Exclude<PhotoProvider, 'commons'>, query: string, fetcher = digestMediaFetcher().fetcher, options: PhotoOptions = {}) {
  const searchUrl = provider === 'openverse'
    ? `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=5&license=${options.allowNonCommercial ? 'by,by-sa,cc0,by-nc,by-nc-sa' : 'by,by-sa,cc0'}`
    : photoSearchLinks(query).find(p => p.provider === provider)!.url;
  const discoveries: PhotoDiscovery[] = [], candidates: PhotoCandidate[] = [];
  try {
    const body = await metadata(searchUrl, provider === 'openverse' ? 'application/json' : 'text/html', fetcher);
    if (provider === 'openverse') {
      const data = JSON.parse(body);
      if (!Array.isArray(data.results) || data.results.length > 5) throw Error('PHOTO_METADATA_INVALID');
      for (const row of data.results) {
        const pageUrl = photoPublicUrl(row.foreign_landing_url), imageUrl = photoPublicUrl(row.url);
        if (pageUrl && imageUrl && license(row.license_url, options)) discoveries.push({ title: clean(row.title), pageUrl, imageUrl, provider });
      }
      // Openverse is discovery, not the rights holder. Verify the top two at the source.
      for (const item of discoveries.slice(0, 2)) {
        try { const result = await inspectPhotoPage(item.pageUrl, fetcher, options); candidates.push(...result.candidates.filter(c => c.imageUrl === item.imageUrl).map(c => ({ ...c, provider: 'openverse' }))); } catch { /* Retain unapproved discovery for review. */ }
      }
    } else discoveries.push(...searchPageDiscoveries(provider, body, query));
    const status = candidates.length ? 'ok' : discoveries.length ? 'review_required' : provider === 'baidu' ? 'review_required' : 'empty';
    return { candidates, discoveries, source: { provider, status, count: discoveries.length, searchUrl, ...(provider === 'baidu' && !discoveries.length ? { code: 'BROWSER_DISCOVERY_REQUIRED' } : {}) } as PhotoSourceResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { candidates, discoveries, source: { provider, status: 'failed', count: 0, code: /^PHOTO_(?:HTTP_\d{3}|METADATA_\w+|URL_INVALID)$/.test(message) ? message : 'PHOTO_METADATA_FAILED', searchUrl } as PhotoSourceResult };
  }
}
