import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Network/media-only smoke. Never imports the application, opens business databases or publishes.
const args = process.argv.slice(2);
const value = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const query = value('--query'), output = value('--out'), date = value('--date');
if (!query || !output || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Use --query <public keywords> --date YYYY-MM-DD --out <new directory> [--noncommercial] [--page <original page>]');
const root = path.resolve(output);
if (fs.existsSync(root)) throw Error('OUTPUT_EXISTS: use a new directory to preserve prior evidence');
fs.mkdirSync(root, { recursive: true });
process.env.DATA_DIR = path.join(root, 'runtime');
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.ORBIT_PROACTIVE_ENABLED = 'false';
process.env.ANDROID_PUSH_ENABLED = 'false';
delete process.env.DIGEST_V2_MEDIA_STORE;
const { findDigestPhotos } = await import('../server/digest-v2-photos.js');
const { prepareDigestMedia } = await import('../server/digest-v2-media.js');
const nonCommercial = args.includes('--noncommercial'), pageUrl = value('--page');
const started = Date.now();
const lookup = await findDigestPhotos([{ storyId: value('--story-id') || 'media-smoke', query, ...(pageUrl ? { pageUrls: [pageUrl] } : {}) }], undefined, { allowNonCommercial: nonCommercial });
fs.writeFileSync(path.join(root, 'discovery.json'), JSON.stringify(lookup, null, 2));
const selected = lookup.results[0].candidates[0];
if (!selected) { console.log(JSON.stringify({ status: 'NO_APPROVED_CANDIDATE', sources: lookup.results[0].sources, output: root })); process.exitCode = 2; }
else {
  const d = { schema_version: 'daily-digest.v2', date, title: '媒体专项验证，不是正式日报', executive_signals: [], calendar: [], mail: [],
    market: [{ id: 'market-ai-credit', title: `${query} 配图验证`, summary: '验证相关资料照的来源许可、下载、转换和本地保存，不重建新闻正文。', evidence_ids: ['photo'], media_ids: ['photo'], verification: 'partial' }],
    macro: [], stories: [], watchlist: [], what_matters_next: [], evidence: [{ id: 'photo', url: selected.pageUrl, source: selected.provider || 'photo source', published_at: '' }],
    media: [{ id: 'photo', evidence_id: 'photo', url: selected.imageUrl, category: 'Company' }] } as import('../server/digest-v2-contract.js').DigestV2;
  const images = await prepareDigestMedia(d, { mode: 'shadow', rules: [], allowCommons: true, allowNonCommercialPhotos: nonCommercial, mediaRoot: path.join(root, 'media'),
    storage: { origin: 'https://example.com', async put(_key, bytes, _mime, sha) { if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha) throw Error('HASH_MISMATCH'); }, async get() { throw Error('LOCAL_PREVIEW_ONLY'); }, async remove() { throw Error('LOCAL_PREVIEW_ONLY'); } } });
  const image = images[0];
  const result = { status: image && !image.fallback && !image.failure ? 'LOCAL_MEDIA_READY' : 'MEDIA_FAILED', observedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    query, date, originalRunId: value('--run-id') || null, selected, sources: lookup.results[0].sources, image: { ...image, publicUrl: null }, localFile: image ? path.join(root, 'media', image.filename) : null,
    boundaries: 'Local media smoke only; storage is a local test double. No server artifact, full digest replay, upload, publication, schedule change, queue or SMTP.' };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  fs.writeFileSync(path.join(root, 'preview.html'), `<!doctype html><meta charset="utf-8"><title>日报取图验证</title><style>body{font:17px/1.7 system-ui;max-width:850px;margin:40px auto;padding:0 20px}img{width:100%;height:auto}small{color:#555}</style><h1>${esc(query)}：资料照候选</h1><p>本地媒体专项验证，未发布日报。此图不代表今日事件现场，仍需人工判断与正文是否贴题。</p>${image ? `<img src="media/${esc(image.filename)}" alt="${esc(selected.title)}">` : ''}<p>${esc(selected.title)}</p><small>${esc(selected.author)} · ${esc(selected.licenseName)} · 拍摄日期${esc(selected.photoDate || '未知')}</small><p><a href="${esc(selected.pageUrl)}">原始照片页面</a> · <a href="${esc(selected.licenseUrl)}">使用许可</a></p>`);
  console.log(JSON.stringify({ status: result.status, sources: result.sources, license: selected.licenseName, localFile: result.localFile, elapsedMs: result.elapsedMs, output: root }));
  if (result.status !== 'LOCAL_MEDIA_READY') process.exitCode = 2;
}
