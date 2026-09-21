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
const bytes = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#557799' } }).png().toBuffer();
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const filename = `${hash}.png`;
const key = `tmp/${filename}`;
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
await restoreDigestObjects([{ id: 'smoke', evidenceId: 'synthetic', category: 'Market', sourceUrl: '', licenseRef: 'owned synthetic', policy: 'OWNED_OPEN', publicUrl: storage.origin + '/' + key, key, filename, sha256: hash, width: 320, height: 180, bytes: bytes.length, mime: 'image/png', fallback: true, failure: null }], storage, dailyReportMediaRoot());
const receipt = { status: 'PASS', testedAt: new Date().toISOString(), tests: ['upload', 'duplicate-put', 'S3-read-hash', 'public-read-hash', 'origin-delete', 'restore-from-independent-local-copy'], bytes: bytes.length, sha256: hash, limitation: 'Test r2.dev endpoint; production custom domain, CDN purge and Work not tested', mediaUrl: storage.origin + '/' + key };
fs.writeFileSync(path.join(process.env.DATA_DIR!, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ...receipt, evidenceDirectory: process.env.DATA_DIR }, null, 2));
