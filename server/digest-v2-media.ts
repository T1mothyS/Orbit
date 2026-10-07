import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { digestMediaFetcher } from './digest-v2-relay.js';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { controlledMediaFetch, dailyReportMediaRoot, getDailyReportMediaPublicOrigin, storeProvidedDailyReportMedia, DailyReportMediaFetchError, type ControlledDailyReportMediaOptions } from './daily-report-media-service.js';
import { publicDigestUrl, type DigestV2 } from './digest-v2-contract.js';
import { isValidDateKey } from './date-key.js';
import { approvedCommonsRule } from './digest-v2-photos.js';

export interface MediaCredit { caption: string; author: string; sourcePage: string; licenseName: string; licenseUrl: string }
export interface MediaRule { pageHost: string; imageHosts: string[]; policy: 'OWNED_OPEN' | 'LICENSED' | 'EXTERNAL_ALLOWED'; licenseRef: string; pageUrl?: string; imageUrls?: string[]; credit?: MediaCredit; sourceFile?: string; sourceSha256?: string; kind?: 'source_icon'; visualKind?: 'photo' | 'archive_photo' | 'illustration' }
export interface PreparedImage {
  id: string; evidenceId: string; category: string; sourceUrl: string; licenseRef: string;
  policy: string; publicUrl: string; key: string; filename: string; sha256: string;
  width: number; height: number; bytes: number; mime: string; fallback: boolean; failure: string | null;
  credit?: MediaCredit;
  sourceTransport?: 'network' | 'audited_copy' | 'cloudflare_worker' | 'http_proxy';
  kind?: 'source_icon';
  sourceHost?: string;
  sourceSha256?: string;
  sourceAttempts?: number;
  failureStage?: 'license' | 'download' | 'transform' | 'storage';
  failureReason?: string;
  storyId?: string;
  visualKind?: 'photo' | 'archive_photo' | 'illustration' | 'placeholder';
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
      await send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime, Metadata: { sha256 }, CacheControl: key.startsWith('tmp/') ? 'no-store' : 'public, max-age=31536000, immutable' }));
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
    if (r.visualKind !== undefined && !['photo', 'archive_photo', 'illustration'].includes(r.visualKind)) throw new Error('MEDIA_RULES_INVALID');
    if (r.visualKind === 'illustration' && (r.kind || r.policy !== 'OWNED_OPEN' || !r.sourceFile || !r.credit || r.credit.licenseUrl !== '')) throw new Error('MEDIA_RULES_INVALID');
    if (r.pageUrl !== undefined && (!publicDigestUrl(r.pageUrl) || new URL(r.pageUrl).hostname !== r.pageHost)) throw new Error('MEDIA_RULES_INVALID');
    if (r.imageUrls !== undefined && (!Array.isArray(r.imageUrls) || !r.imageUrls.length || r.imageUrls.some((u: string) => !publicDigestUrl(u) || !r.imageHosts.includes(new URL(u).hostname)))) throw new Error('MEDIA_RULES_INVALID');
    if (r.credit !== undefined && (!r.pageUrl || !r.imageUrls || !r.credit || !['caption', 'author', 'licenseName'].every(k => typeof r.credit[k] === 'string' && r.credit[k].trim() && r.credit[k].length <= 500) || !publicDigestUrl(r.credit.sourcePage) || (r.visualKind !== 'illustration' && !publicDigestUrl(r.credit.licenseUrl)))) throw new Error('MEDIA_RULES_INVALID');
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
async function fallbackImage(category: string, seed = '') {
  const index = Math.max(0, categories.indexOf(category));
  // Category placeholder. Shapes are decorative, never a chart of observed values.
  const digest = crypto.createHash('sha256').update(`${category}:${seed}`).digest();
  const palettes = [
    ['#e5edf5', '#1b4d6b', '#5a96b5'], ['#e9edf5', '#284b7c', '#8faed2'],
    ['#edf1e8', '#365c43', '#8aa779'], ['#f4ece6', '#805444', '#c49a7f'],
    ['#f0eaf3', '#614c78', '#a889b8'], ['#f4eee3', '#725529', '#c19d5b'],
    ['#e5f1f0', '#245f60', '#80aead'], ['#edf0f3', '#425669', '#91a5b5'],
    ['#edf1e8', '#52673b', '#a1b47b'],
  ];
  const [background, foreground, accent] = palettes[index];
  const blocks = Array.from({ length: 5 }, (_, i) => {
    const x = 500 + i * 78;
    const y = 54 + digest[i] % 140;
    const height = 230 - y + digest[i + 5] % 50;
    return `<rect x="${x}" y="${y}" width="42" height="${height}" rx="21" fill="${i % 2 ? foreground : accent}" opacity="${(0.35 + digest[i + 10] / 510).toFixed(2)}"/>`;
  }).join('');
  const svg = `<svg width="960" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="320" fill="${background}"/><circle cx="775" cy="155" r="138" fill="${accent}" opacity=".13"/>${blocks}<path d="M0 270 C210 ${205 + digest[15] % 55}, 300 ${205 + digest[16] % 55}, 520 290 L0 320Z" fill="${accent}" opacity=".22"/><text x="48" y="72" font-size="18" letter-spacing="3" fill="${foreground}" font-family="sans-serif">EDITORIAL ILLUSTRATION</text><text x="48" y="180" font-size="60" font-weight="700" fill="${foreground}" font-family="sans-serif">${categories[index]}</text><path d="M48 207 H330" stroke="${accent}" stroke-width="8" stroke-linecap="round"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
}
export async function prepareDigestMedia(d: DigestV2, options: { storage?: ObjectStorage | null; rules?: MediaRule[]; fetchOptions?: ControlledDailyReportMediaOptions; mode: 'shadow' | 'production'; mediaRoot?: string; storyIllustrations?: boolean; allowCommons?: boolean }) {
  if (!isValidDateKey(d.date)) throw new Error('INVALID_DATE');
  const localOrigin = process.env.DIGEST_V2_MEDIA_STORE === 'local' ? getDailyReportMediaPublicOrigin() : null;
  if (localOrigin && (!publicDigestUrl(localOrigin) || new URL(localOrigin).origin !== localOrigin)) throw new Error('LOCAL_MEDIA_ORIGIN_INVALID');
  let storage: ObjectStorage | null = null;
  let configurationFailure: string | null = null;
  let rules: MediaRule[] = [];
  try { storage = localOrigin ? null : options.storage === undefined ? configuredR2() : options.storage; }
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
    let rule = rules.find(r => r.kind === m.kind && r.pageHost === new URL(evidence.url).hostname && (!r.pageUrl || r.pageUrl === evidence.url) && r.imageHosts.includes(new URL(m.url).hostname) && (!r.imageUrls || r.imageUrls.includes(m.url)));
    let fallback = false; let failure: string | null = null;
    let stage: PreparedImage['failureStage'] = 'license';
    let failureStage: PreparedImage['failureStage']; let failureReason: string | undefined;
    let sourceAttempts = 0;
    let sourceSha256: string | undefined;
    let transport: PreparedImage['sourceTransport'];
    let result: Awaited<ReturnType<typeof transformDigestImage>>;
    try {
      if (!rule && !m.kind && options.allowCommons) rule = await approvedCommonsRule(evidence.url, m.url);
      if (!rule) throw new Error('LICENSE_NOT_APPROVED');
      stage = 'download';
      let bytes: Buffer | undefined;
      if (rule.sourceFile) {
        sourceAttempts = 1;
        // An operator-reviewed copy is bound to exactly one URL and hash; Work cannot supply paths.
        if (!rule.pageUrl || rule.imageUrls?.length !== 1 || !rule.sourceSha256 || !rule.credit) throw new Error('SOURCE_COPY_INVALID');
        const stat = fs.lstatSync(rule.sourceFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error('SOURCE_COPY_INVALID');
        bytes = fs.readFileSync(rule.sourceFile);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== rule.sourceSha256) throw new Error('SOURCE_COPY_HASH');
      } else {
        const approvedRule = rule;
        const relay = digestMediaFetcher(); transport = relay.transport;
        const fetchOptions = { fetcher: relay.fetcher, ...options.fetchOptions, authorizeUrl: (u: URL) => { if (u.protocol !== 'https:' || !approvedRule.imageHosts.includes(u.hostname) || (approvedRule.imageUrls && !approvedRule.imageUrls.includes(u.href))) throw new Error('LICENSE_REDIRECT_BLOCKED'); }, persistMedia: (body: Buffer, validated: Parameters<NonNullable<ControlledDailyReportMediaOptions['persistMedia']>>[1]) => { bytes = body; return validated; } };
        for (;;) {
          sourceAttempts++;
          try { await controlledMediaFetch(m.url, fetchOptions); break; }
          catch (error) {
            // Only account-enabled automatic photos get one fresh, fully checked network attempt.
            const transient = error instanceof DailyReportMediaFetchError && (['TIMEOUT', 'FETCH_ERROR'].includes(error.code) || (error.code === 'HTTP_ERROR' && (error.httpStatus || 0) >= 500));
            if (!options.allowCommons || m.kind || sourceAttempts >= 2 || !transient) throw error;
          }
        }
      }
      stage = 'transform';
      sourceSha256 = crypto.createHash('sha256').update(bytes!).digest('hex');
      result = m.kind === 'source_icon' ? await transformDigestIcon(bytes!) : await transformDigestImage(bytes!);
    } catch (e) {
      fallback = true;
      failure = rule ? 'SOURCE_OR_IMAGE_FAILED' : 'LICENSE_NOT_APPROVED';
      failureStage = stage;
      failureReason = e instanceof DailyReportMediaFetchError ? e.code : stage === 'license' ? 'PHOTO_NOT_APPROVED' : stage === 'transform' ? 'IMAGE_INVALID' : 'SOURCE_READ_FAILED';
      const story = [...d.market, ...d.macro, ...d.stories].find(s => s.media_ids.includes(m.id));
      result = await fallbackImage(m.category, story ? `${story.id}:${story.title}` : '');
    }
    const mime = fallback || m.kind === 'source_icon' ? 'image/png' : 'image/jpeg';
    const sha256 = crypto.createHash('sha256').update(result.data).digest('hex');
    const filename = `${sha256}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    // Durable local mirror participates in existing system backup, independently of R2.
    storeProvidedDailyReportMedia(filename, result.data, mime, root);
    // A later Shadow date must not inherit an earlier date's tmp/ expiration.
    const key = localOrigin ? `local/${filename}` : fallback ? `fallback/${filename}` : options.mode === 'production' ? `published/${filename}` : `tmp/${d.date}/${filename}`;
    let publicUrl = '';
    try {
      if (!(m.kind === 'source_icon' && fallback)) {
        if (localOrigin) publicUrl = `${localOrigin}/daily-report-media/${filename}`;
        else {
          if (!storage) throw new Error('R2_NOT_CONFIGURED');
          await storage.put(key, result.data, mime, sha256);
          publicUrl = storage.origin + '/' + key;
        }
      }
    } catch { failure = storage ? 'R2_UPLOAD_FAILED' : 'R2_NOT_CONFIGURED'; failureStage = 'storage'; failureReason = failure; }
    failure = configurationFailure || failure;
    images.push({ ...(m.kind ? { kind: m.kind, sourceHost: new URL(evidence.url).hostname } : {}), id: m.id, evidenceId: m.evidence_id, sourceUrl: m.url, category: m.category, licenseRef: fallback ? 'code-owned-category-art' : rule!.licenseRef, policy: fallback ? 'OWNED_OPEN' : rule!.policy, publicUrl, key, filename, sha256, width: result.info.width, height: result.info.height, bytes: result.data.length, mime, fallback, failure, sourceAttempts, ...(failureStage ? { failureStage, failureReason } : {}), ...(fallback ? { visualKind: 'placeholder' as const } : { visualKind: rule!.visualKind || 'archive_photo' as const, sourceTransport: rule?.sourceFile ? 'audited_copy' as const : transport || 'network' as const, sourceSha256, ...(rule?.credit ? { credit: { ...rule.credit } } : {}) }) });
  }
  if (options.storyIllustrations) {
    const stories = [...d.market, ...d.macro, ...d.stories];
    for (const story of stories) {
      if (images.length >= 40) break;
      if (story.media_ids.some(id => images.some(m => m.id === id && m.publicUrl))) continue;
      const category = d.market.includes(story) ? 'Market' : d.macro.includes(story) ? 'Macro' : 'International';
      const result = await fallbackImage(category, `${story.id}:${story.title}`);
      const mime = 'image/png';
      const sha256 = crypto.createHash('sha256').update(result.data).digest('hex');
      const filename = `${sha256}.png`;
      const key = localOrigin ? `local/${filename}` : `fallback/${filename}`;
      storeProvidedDailyReportMedia(filename, result.data, mime, root);
      let publicUrl = '';
      let failure: string | null = null;
      try {
        if (localOrigin) publicUrl = `${localOrigin}/daily-report-media/${filename}`;
        else {
          if (!storage) throw new Error('R2_NOT_CONFIGURED');
          await storage.put(key, result.data, mime, sha256);
          publicUrl = storage.origin + '/' + key;
        }
      } catch { failure = storage ? 'R2_UPLOAD_FAILED' : 'R2_NOT_CONFIGURED'; }
      images.push({ id: `story-placeholder:${sha256}`, storyId: story.id, evidenceId: story.evidence_ids[0] || '', sourceUrl: '', category, licenseRef: 'code-owned-category-placeholder', policy: 'OWNED_OPEN', publicUrl, key, filename, sha256, width: result.info.width, height: result.info.height, bytes: result.data.length, mime, fallback: true, failure, visualKind: 'placeholder' });
    }
  }
  return images;
}
export async function restoreDigestObjects(images: PreparedImage[], storage: ObjectStorage, root = dailyReportMediaRoot()) {
  const unique = new Map<string, { item: PreparedImage; bytes: Buffer }>();
  for (const item of images) {
    const expected = item.key.match(/^(?:published|fallback|tmp(?:\/\d{4}-\d{2}-\d{2})?)\/([a-f0-9]{64}\.(?:jpg|png))$/)?.[1];
    if (!expected || expected !== item.filename || !item.filename.startsWith(`${item.sha256}.`)
      || (item.filename.endsWith('.png') ? item.mime !== 'image/png' : item.mime !== 'image/jpeg')) throw new Error('MEDIA_BACKUP_PATH');
    const bytes = fs.readFileSync(path.join(root, item.filename));
    if (bytes.length !== item.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('MEDIA_BACKUP_HASH');
    unique.set(item.key, { item, bytes });
  }
  for (const { item, bytes } of unique.values()) {
    await storage.put(item.key, bytes, item.mime, item.sha256);
    if (crypto.createHash('sha256').update(await storage.get(item.key)).digest('hex') !== item.sha256) throw new Error('MEDIA_RESTORE_HASH');
  }
}
