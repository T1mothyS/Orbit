/** Explicit, synthetic, test-only R2 verification. Never sends mail or uses application data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

if (process.env.DIGEST_R2_ENV !== 'test' || !process.env.DIGEST_R2_BUCKET?.endsWith('-test')) throw new Error('Dedicated test bucket required');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-r2-smoke-'));
const { configuredR2, restoreDigestObjects } = await import('../server/digest-v2-media.js');
const { storeProvidedDailyReportMedia, dailyReportMediaRoot } = await import('../server/daily-report-media-service.js');
const storage = configuredR2(); if (!storage) throw new Error('R2 not configured');
const color = '#' + crypto.randomBytes(3).toString('hex');
const bytes = await sharp({ create: { width: 320, height: 180, channels: 3, background: color } }).png().toBuffer();
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const filename = `${hash}.png`;
const key = `tmp/${new Date().toISOString().slice(0, 10)}/${filename}`;
storeProvidedDailyReportMedia(filename, bytes, 'image/png');
await storage.put(key, bytes, 'image/png', hash);
await storage.put(key, bytes, 'image/png', hash);
if (crypto.createHash('sha256').update(await storage.get(key)).digest('hex') !== hash) throw new Error('R2 hash mismatch');
const response = await fetch(storage.origin + '/' + key, { signal: AbortSignal.timeout(20000) });
if (!response.ok || crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== hash) throw new Error('Public read mismatch');
// Only the synthetic test object created by this script is deleted and restored.
await storage.remove(key);
let missing = false;
try { await storage.get(key); } catch (e: any) { missing = e?.$metadata?.httpStatusCode === 404; }
if (!missing) throw new Error('Deletion not verified at origin');
const image = { id: 'smoke', evidenceId: 'synthetic', category: 'Market', sourceUrl: '', licenseRef: 'owned synthetic', policy: 'OWNED_OPEN', publicUrl: storage.origin + '/' + key, key, filename, sha256: hash, width: 320, height: 180, bytes: bytes.length, mime: 'image/png', fallback: true, failure: null };
await restoreDigestObjects([image, { ...image, id: 'shared-reference' }], storage, dailyReportMediaRoot());
if (crypto.createHash('sha256').update(await storage.get(key)).digest('hex') !== hash) throw new Error('Restored shared object mismatch');
const receipt = { status: 'PASS', testedAt: new Date().toISOString(), tests: ['upload', 'duplicate-put', 'S3-read-hash', 'public-read-hash', 'origin-delete', 'restore-two-references-from-one-local-copy'], bytes: bytes.length, sha256: hash, cacheControl: response.headers.get('cache-control'), limitation: 'R2 origin and public URL only; lifecycle configuration, CDN exact purge and Work require separate checks', mediaUrl: storage.origin + '/' + key };
fs.writeFileSync(path.join(process.env.DATA_DIR!, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ...receipt, evidenceDirectory: process.env.DATA_DIR }, null, 2));
