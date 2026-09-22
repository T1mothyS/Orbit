import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { fetchDigestImage } from './digest-v2-fetch.js';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { controlledMediaFetch, dailyReportMediaRoot, storeProvidedDailyReportMedia, type ControlledDailyReportMediaOptions } from './daily-report-media-service.js';
import { publicDigestUrl, type DigestV2 } from './digest-v2-contract.js';

export interface MediaCredit { caption: string; author: string; sourcePage: string; licenseName: string; licenseUrl: string }
export interface MediaRule { pageHost: string; imageHosts: string[]; policy: 'OWNED_OPEN' | 'LICENSED' | 'EXTERNAL_ALLOWED'; licenseRef: string; pageUrl?: string; imageUrls?: string[]; credit?: MediaCredit; sourceFile?: string; sourceSha256?: string }
export interface PreparedImage {
  id: string; evidenceId: string; category: string; sourceUrl: string; licenseRef: string;
  policy: string; publicUrl: string; key: string; filename: string; sha256: string;
  width: number; height: number; bytes: number; mime: string; fallback: boolean; failure: string | null;
  credit?: MediaCredit;
  sourceTransport?: 'network' | 'audited_copy';
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
  for (const m of d.media) {
    const evidence = d.evidence.find(e => e.id === m.evidence_id)!;
    const rule = rules.find(r => r.pageHost === new URL(evidence.url).hostname && (!r.pageUrl || r.pageUrl === evidence.url) && r.imageHosts.includes(new URL(m.url).hostname) && (!r.imageUrls || r.imageUrls.includes(m.url)));
    let fallback = false; let failure: string | null = null;
    let sourceSha256: string | undefined;
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
        await controlledMediaFetch(m.url, { fetcher: fetchDigestImage, ...options.fetchOptions, authorizeUrl: u => { if (u.protocol !== 'https:' || !rule.imageHosts.includes(u.hostname) || (rule.imageUrls && !rule.imageUrls.includes(u.href))) throw new Error('LICENSE_REDIRECT_BLOCKED'); }, persistMedia: (body, validated) => { bytes = body; return validated; } });
      }
      sourceSha256 = crypto.createHash('sha256').update(bytes!).digest('hex');
      result = await transformDigestImage(bytes!);
    } catch (e) {
      fallback = true;
      failure = rule ? 'SOURCE_OR_IMAGE_FAILED' : 'LICENSE_NOT_APPROVED';
      result = await fallbackImage(m.category);
    }
    const mime = fallback ? 'image/png' : 'image/jpeg';
    const sha256 = crypto.createHash('sha256').update(result.data).digest('hex');
    const filename = `${sha256}.${fallback ? 'png' : 'jpg'}`;
    // Durable local mirror participates in existing system backup, independently of R2.
    storeProvidedDailyReportMedia(filename, result.data, mime, root);
    const key = `${fallback ? 'fallback' : options.mode === 'production' ? 'published' : 'tmp'}/${filename}`;
    let publicUrl = '';
    try {
      if (!storage) throw new Error('R2_NOT_CONFIGURED');
      await storage.put(key, result.data, mime, sha256);
      publicUrl = storage.origin + '/' + key;
    } catch { failure = storage ? 'R2_UPLOAD_FAILED' : 'R2_NOT_CONFIGURED'; }
    failure = configurationFailure || failure;
    images.push({ id: m.id, evidenceId: m.evidence_id, sourceUrl: m.url, category: m.category, licenseRef: fallback ? 'code-owned-category-art' : rule!.licenseRef, policy: fallback ? 'OWNED_OPEN' : rule!.policy, publicUrl, key, filename, sha256, width: result.info.width, height: result.info.height, bytes: result.data.length, mime, fallback, failure, ...(!fallback ? { sourceTransport: rule?.sourceFile ? 'audited_copy' as const : 'network' as const, sourceSha256, ...(rule?.credit ? { credit: { ...rule.credit } } : {}) } : {}) });
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
