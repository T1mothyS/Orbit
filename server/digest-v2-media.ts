import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { digestMediaFetcher } from './digest-v2-relay.js';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { controlledMediaFetch, dailyReportMediaRoot, storeProvidedDailyReportMedia, type ControlledDailyReportMediaOptions } from './daily-report-media-service.js';
import { publicDigestUrl, type DigestV2 } from './digest-v2-contract.js';

export interface MediaCredit { caption: string; author: string; sourcePage: string; licenseName: string; licenseUrl: string }
export interface MediaRule { pageHost: string; imageHosts: string[]; policy: 'OWNED_OPEN' | 'LICENSED' | 'EXTERNAL_ALLOWED'; licenseRef: string; pageUrl?: string; imageUrls?: string[]; credit?: MediaCredit; sourceFile?: string; sourceSha256?: string; kind?: 'source_icon' }
export interface PreparedImage {
  id: string; evidenceId: string; category: string; sourceUrl: string; licenseRef: string;
  policy: string; publicUrl: string; key: string; filename: string; sha256: string;
  width: number; height: number; bytes: number; mime: string; fallback: boolean; failure: string | null;
  credit?: MediaCredit;
  sourceTransport?: 'network' | 'audited_copy' | 'cloudflare_worker';
  kind?: 'source_icon';
  sourceHost?: string;
  sourceSha256?: string;
}
export interface ObjectStorage {
  origin: string;
  put(key: string, bytes: Buffer, mime: string, sha256: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function configuredR2(): ObjectStorage | null {
  const bucket = process.env.DIGEST_R2_BUCKET;
  if (!bucket) return null;
  const account = process.env.DIGEST_R2_ACCOUNT_ID || '';
  const origin = process.env.DIGEST_R2_PUBLIC_ORIGIN || '';
  if (!/^[a-f0-9]{32}$/.test(account) || !publicDigestUrl(origin)) throw new Error('R2_CONFIGURATION_INVALID');
  const url = new URL(origin);
  if (url.pathname !== '/' || url.search || url.hash || (process.env.DIGEST_R2_ENV !== 'test' && url.hostname.endsWith('.r2.dev'))) throw new Error('R2_PUBLIC_ORIGIN_INVALID');
  const accessKeyId = process.env.DIGEST_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.DIGEST_R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('R2_CREDENTIALS_MISSING');
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 });
  const send = (command: any) => client.send(command, { abortSignal: AbortSignal.timeout(20_000) });
  return {
    origin: url.origin,
    async put(key, bytes, mime, sha256) {
      try {
        const existing: any = await send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (existing.Metadata?.sha256 !== sha256 || existing.ContentLength !== bytes.length) throw new Error('R2_HASH_CONFLICT');
        return;
      } catch (e: any) { if (e?.$metadata?.httpStatusCode !== 404) throw e; }
      await send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime, Metadata: { sha256 }, CacheControl: 'public, max-age=31536000, immutable' }));
    },
    async get(key) {
      const result: any = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body || result.ContentLength > 5 * 1024 * 1024) throw new Error('R2_OBJECT_INVALID');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of result.Body) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) { result.Body.destroy(); throw new Error('R2_OBJECT_INVALID'); }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
    async remove(key) { await send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}
export function configuredMediaRules(): MediaRule[] {
  const file = process.env.DIGEST_V2_MEDIA_RULES_FILE;
  if (!file) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value) || value.length > 100) throw new Error('MEDIA_RULES_INVALID');
  for (const r of value) {
    if (!publicDigestUrl(`https://${r.pageHost}`) || !Array.isArray(r.imageHosts) || !r.imageHosts.length
      || r.imageHosts.some((h: string) => !publicDigestUrl(`https://${h}`)) || !['OWNED_OPEN', 'LICENSED', 'EXTERNAL_ALLOWED'].includes(r.policy)
      || typeof r.licenseRef !== 'string' || !r.licenseRef.trim()) throw new Error('MEDIA_RULES_INVALID');
    if (r.kind !== undefined && (r.kind !== 'source_icon' || r.imageUrls?.length !== 1 || r.sourceFile)) throw new Error('MEDIA_RULES_INVALID');
    if (r.pageUrl !== undefined && (!publicDigestUrl(r.pageUrl) || new URL(r.pageUrl).hostname !== r.pageHost)) throw new Error('MEDIA_RULES_INVALID');
    if (r.imageUrls !== undefined && (!Array.isArray(r.imageUrls) || !r.imageUrls.length || r.imageUrls.some((u: string) => !publicDigestUrl(u) || !r.imageHosts.includes(new URL(u).hostname)))) throw new Error('MEDIA_RULES_INVALID');
    if (r.credit !== undefined && (!r.pageUrl || !r.imageUrls || !r.credit || !['caption', 'author', 'licenseName'].every(k => typeof r.credit[k] === 'string' && r.credit[k].trim() && r.credit[k].length <= 500) || !publicDigestUrl(r.credit.sourcePage) || !publicDigestUrl(r.credit.licenseUrl))) throw new Error('MEDIA_RULES_INVALID');
    if ((r.sourceFile !== undefined || r.sourceSha256 !== undefined) && (typeof r.sourceFile !== 'string' || !path.isAbsolute(r.sourceFile) || !/^[a-f0-9]{64}$/.test(r.sourceSha256 || '') || !r.pageUrl || r.imageUrls?.length !== 1 || !r.credit)) throw new Error('MEDIA_RULES_INVALID');
  }
  return value;
}
export async function transformDigestImage(bytes: Buffer) {
  const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning', animated: false });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || !meta.width || !meta.height || meta.width < 80 || meta.height < 80) throw new Error('IMAGE_DIMENSIONS_OR_FORMAT');
  const result = await image.rotate().resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
  if (result.data.length > 5 * 1024 * 1024) throw new Error('IMAGE_SIZE_LIMIT');
  return result;
}
export async function transformDigestIcon(bytes: Buffer) {
  // Safe SVG validation happens in controlledMediaFetch before rasterization.
  if (bytes.length >= 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
    const count = bytes.readUInt16LE(4);
    let embedded: Buffer | undefined;
    let bitmap: { data: Buffer; width: number; height: number } | undefined;
    if (count > 256 || bytes.length < 6 + count * 16) throw new Error('ICON_INVALID');
    for (let i = 0; i < count; i++) {
      const n = 6 + i * 16, length = bytes.readUInt32LE(n + 8), offset = bytes.readUInt32LE(n + 12);
      if (offset < 6 + count * 16 || offset + length > bytes.length) throw new Error('ICON_INVALID');
      const image = bytes.subarray(offset, offset + length);
      if (image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) embedded = image;
      else if (image.length >= 40 && image.readUInt32LE(0) === 40 && image.readUInt16LE(12) === 1 && image.readUInt16LE(14) === 32 && image.readUInt32LE(16) === 0) {
        const width = image.readInt32LE(4), doubledHeight = image.readInt32LE(8), height = doubledHeight / 2;
        if (width < 8 || width > 256 || height < 8 || height > 256 || !Number.isInteger(height)) throw new Error('ICON_DIMENSIONS_OR_FORMAT');
        const maskStride = Math.ceil(width / 32) * 4, pixelBytes = width * height * 4;
        if (image.length < 40 + pixelBytes + maskStride * height) throw new Error('ICON_INVALID');
        const data = Buffer.alloc(pixelBytes); let anyAlpha = false;
        for (let n = 43; n < 40 + pixelBytes; n += 4) if (image[n]) anyAlpha = true;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const sourceY = height - 1 - y, src = 40 + (sourceY * width + x) * 4, dst = (y * width + x) * 4;
          data[dst] = image[src + 2]; data[dst + 1] = image[src + 1]; data[dst + 2] = image[src];
          const masked = image[40 + pixelBytes + sourceY * maskStride + Math.floor(x / 8)] & (128 >> (x % 8));
          data[dst + 3] = masked ? 0 : anyAlpha ? image[src + 3] : 255;
        }
        if (!bitmap || width * height > bitmap.width * bitmap.height) bitmap = { data, width, height };
      }
    }
    if (!embedded && bitmap) return sharp(bitmap.data, { raw: { width: bitmap.width, height: bitmap.height, channels: 4 } }).resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    if (!embedded) throw new Error('ICON_ENCODING_UNSUPPORTED');
    bytes = embedded;
  }
  const image = sharp(bytes, { limitInputPixels: 1_000_000, failOn: 'warning', animated: false });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp', 'svg'].includes(meta.format || '') || !meta.width || !meta.height || meta.width < 8 || meta.height < 8) throw new Error('ICON_DIMENSIONS_OR_FORMAT');
  return image.resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
}
const categories = ['AI', 'Semiconductor', 'Banking', 'Macro', 'Gaming', 'China', 'International', 'Company', 'Market'];
async function fallbackImage(category: string) {
  const index = Math.max(0, categories.indexOf(category));
  // Code-owned neutral category artwork; no external image or claims about a news scene.
  const svg = `<svg width="960" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="320" fill="#e9edf2"/><path d="M0 270 L${160 + index * 25} 150 L470 225 L720 70 L960 160" fill="none" stroke="#617c96" stroke-width="18"/><text x="48" y="80" font-size="36" fill="#34475b" font-family="sans-serif">${categories[index]}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
}
export async function prepareDigestMedia(d: DigestV2, options: { storage?: ObjectStorage | null; rules?: MediaRule[]; fetchOptions?: ControlledDailyReportMediaOptions; mode: 'shadow' | 'production'; mediaRoot?: string }) {
  let storage: ObjectStorage | null = null;
  let configurationFailure: string | null = null;
  let rules: MediaRule[] = [];
  try { storage = options.storage === undefined ? configuredR2() : options.storage; }
  catch { configurationFailure = 'R2_CONFIGURATION_INVALID'; }
  try { rules = options.rules || configuredMediaRules(); }
  catch { configurationFailure = 'MEDIA_RULES_INVALID'; }
  const root = options.mediaRoot || dailyReportMediaRoot();
  const images: PreparedImage[] = [];
  const iconHosts = new Set<string>();
  const icons = d.evidence.flatMap(e => {
    const host = new URL(e.url).hostname;
    const rule = rules.find(r => r.kind === 'source_icon' && r.pageHost === host && (!r.pageUrl || r.pageUrl === e.url));
    if (!rule?.imageUrls?.[0] || iconHosts.has(host) || iconHosts.size >= 20) return [];
    iconHosts.add(host);
    return [{ id: `source-icon:${host}`, evidence_id: e.id, url: rule.imageUrls[0], category: 'Company', kind: 'source_icon' as const }];
  });
  for (const m of [...d.media.map(m => ({ ...m, kind: undefined as 'source_icon' | undefined })), ...icons]) {
    const evidence = d.evidence.find(e => e.id === m.evidence_id)!;
    const rule = rules.find(r => r.kind === m.kind && r.pageHost === new URL(evidence.url).hostname && (!r.pageUrl || r.pageUrl === evidence.url) && r.imageHosts.includes(new URL(m.url).hostname) && (!r.imageUrls || r.imageUrls.includes(m.url)));
    let fallback = false; let failure: string | null = null;
    let sourceSha256: string | undefined;
    let transport: PreparedImage['sourceTransport'];
    let result: Awaited<ReturnType<typeof transformDigestImage>>;
    try {
      if (!rule) throw new Error('LICENSE_NOT_APPROVED');
      let bytes: Buffer | undefined;
      if (rule.sourceFile) {
        // An operator-reviewed copy is bound to exactly one URL and hash; Work cannot supply paths.
        if (!rule.pageUrl || rule.imageUrls?.length !== 1 || !rule.sourceSha256 || !rule.credit) throw new Error('SOURCE_COPY_INVALID');
        const stat = fs.lstatSync(rule.sourceFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error('SOURCE_COPY_INVALID');
        bytes = fs.readFileSync(rule.sourceFile);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== rule.sourceSha256) throw new Error('SOURCE_COPY_HASH');
      } else {
        const relay = digestMediaFetcher(); transport = relay.transport;
        await controlledMediaFetch(m.url, { fetcher: relay.fetcher, ...options.fetchOptions, authorizeUrl: u => { if (u.protocol !== 'https:' || !rule.imageHosts.includes(u.hostname) || (rule.imageUrls && !rule.imageUrls.includes(u.href))) throw new Error('LICENSE_REDIRECT_BLOCKED'); }, persistMedia: (body, validated) => { bytes = body; return validated; } });
      }
      sourceSha256 = crypto.createHash('sha256').update(bytes!).digest('hex');
      result = m.kind === 'source_icon' ? await transformDigestIcon(bytes!) : await transformDigestImage(bytes!);
    } catch (e) {
      fallback = true;
      failure = rule ? 'SOURCE_OR_IMAGE_FAILED' : 'LICENSE_NOT_APPROVED';
      result = await fallbackImage(m.category);
    }
    const mime = fallback || m.kind === 'source_icon' ? 'image/png' : 'image/jpeg';
    const sha256 = crypto.createHash('sha256').update(result.data).digest('hex');
    const filename = `${sha256}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    // Durable local mirror participates in existing system backup, independently of R2.
    storeProvidedDailyReportMedia(filename, result.data, mime, root);
    const key = `${fallback ? 'fallback' : options.mode === 'production' ? 'published' : 'tmp'}/${filename}`;
    let publicUrl = '';
    try {
      if (!storage) throw new Error('R2_NOT_CONFIGURED');
      if (!(m.kind === 'source_icon' && fallback)) {
        await storage.put(key, result.data, mime, sha256);
        publicUrl = storage.origin + '/' + key;
      }
    } catch { failure = storage ? 'R2_UPLOAD_FAILED' : 'R2_NOT_CONFIGURED'; }
    failure = configurationFailure || failure;
    images.push({ ...(m.kind ? { kind: m.kind, sourceHost: new URL(evidence.url).hostname } : {}), id: m.id, evidenceId: m.evidence_id, sourceUrl: m.url, category: m.category, licenseRef: fallback ? 'code-owned-category-art' : rule!.licenseRef, policy: fallback ? 'OWNED_OPEN' : rule!.policy, publicUrl, key, filename, sha256, width: result.info.width, height: result.info.height, bytes: result.data.length, mime, fallback, failure, ...(!fallback ? { sourceTransport: rule?.sourceFile ? 'audited_copy' as const : transport || 'network' as const, sourceSha256, ...(rule?.credit ? { credit: { ...rule.credit } } : {}) } : {}) });
  }
  return images;
}
export async function restoreDigestObjects(images: PreparedImage[], storage: ObjectStorage, root = dailyReportMediaRoot()) {
  for (const item of images) {
    if (!/^[a-f0-9]{64}\.(jpg|png)$/.test(item.filename) || !/^(published|fallback|tmp)\/[a-f0-9]{64}\.(jpg|png)$/.test(item.key)) throw new Error('MEDIA_BACKUP_PATH');
    const bytes = fs.readFileSync(path.join(root, item.filename));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('MEDIA_BACKUP_HASH');
    await storage.put(item.key, bytes, item.mime, item.sha256);
    if (crypto.createHash('sha256').update(await storage.get(item.key)).digest('hex') !== item.sha256) throw new Error('MEDIA_RESTORE_HASH');
  }
}
