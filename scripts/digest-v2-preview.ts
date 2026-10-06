/** Local UI fixture: fresh temporary data, synthetic content, no SMTP or background jobs. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { DigestV2 } from '../server/digest-v2-contract.js';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v2-preview-'));
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.DIGEST_V2_ENABLED = 'true';
if (process.env.DIGEST_PREVIEW_SOURCES === 'true') {
  process.env.DIGEST_V2_SOURCES_ENABLED = 'true'; process.env.DIGEST_V2_SOURCES_USER_IDS = 'digest-preview';
}
delete process.env.DIGEST_PRODUCTION_CONTRACT;
const api = await import('../server/index.js');
const db = await import('../server/db.js');
const { createDigestSnapshotRun, publishDigestV2, prepareDigestSources } = await import('../server/digest-v2-service.js');
await api.initializeServer();
const now = new Date().toISOString();
const user = db.createUser({ id: 'digest-preview', email: 'digest-preview@example.com', password_hash: bcrypt.hashSync('Preview-only-2026', 4), role: 'user', disabled: 0, created_at: now, updated_at: now });
const origin = process.env.DIGEST_R2_PUBLIC_ORIGIN || 'https://example.com';
const imageUrl = origin + '/tmp/1a48faf2858fa989a3f106cd34fe1f17ddbc6e58f3b7b389ec0e94d9c4530575.png';
const run = createDigestSnapshotRun(user.id, { date: '2026-09-21', timezone: 'Asia/Shanghai', cutoff: now, contextVersion: 1, calendar: { status: 'complete', items: [{ id: 'appointment', title: '整理本周研究资料', detail: '' }] }, mail: { status: 'complete', items: [{ id: 'mail-1', title: '合成服务账单', detail: '本地布局测试，非真实邮件' }, { id: 'mail-2', title: '合成预约通知', detail: '本地布局测试，非真实邮件' }] }, watchlist: { status: 'complete', items: [{ id: 'watch-1', title: '示例关注公司', detail: '' }] } });
const digest = { schema_version: 'daily-digest.v2', date: '2026-09-21', title: '今天值得关注的变化，与仍待确认的信息', executive_signals: ['本页为**合成验收内容**，不代表真实新闻。'], calendar: [{ input_id: 'appointment', text: '整理**本周研究资料** · 19:00，归纳已核实事实及尚待确认的问题。' }], mail: [{ input_id: 'mail-1', summary: '**合成账单服务**已生成 9 月账单，需核对金额与项目；原通知未给出办理期限。', action: '在账单服务内**核对项目**，如有疑问联系服务方。' }, { input_id: 'mail-2', summary: '**合成预约服务**确认 9 月 30 日 10:00 的预约，要求携带登记资料。', action: '按已知时间准备**登记资料**；不另推断截止日期。' }], market: [], macro: [], stories: [{ id: 'story', title: '以完整来源和明确边界组织信息：长标题与手机阅读验收', summary: '这是用于验证**新闻卡片**、证据引用和图片布局的合成内容。'.repeat(12), evidence_ids: ['e1'], media_ids: ['m1'], verification: 'unverified' }, { id: 'story-2', title: '第二条合成新闻：普通侧图与长标题在窄屏中的布局检查', summary: '这条**合成新闻**用于检查普通新闻的侧图和摘要，不代表实际报道。', evidence_ids: ['e2'], media_ids: ['m2'], verification: 'unverified' }], watchlist: [{ input_id: 'watch-1', summary: '示例关注公司：**本期来源检查尚未完成**，不能判断是否出现重大变化。', check: 'incomplete', change: 'unknown', evidence_ids: [] }], what_matters_next: ['**补齐缺失输入**后再核对变化，不以缺失数据推断无变化。'], evidence: [{ id: 'e1', url: imageUrl, source: '自有合成测试图', published_at: now }, { id: 'e2', url: imageUrl, source: '自有合成测试图', published_at: now }], media: [{ id: 'm1', evidence_id: 'e1', url: imageUrl, category: 'AI' }, { id: 'm2', evidence_id: 'e2', url: imageUrl, category: 'AI' }] };
const fallbackVisual = process.env.DIGEST_PREVIEW_FALLBACK === 'true';
if (process.env.DIGEST_PREVIEW_SOURCES === 'true') {
  const previewDigest = digest as DigestV2;
  previewDigest.stories = []; previewDigest.media = []; // This fixture tests the link-only reading section.
  previewDigest.further_reading = [1, 2, 3].map(index => ({ id: `reading-${index}`, title: `${index} · 合成拓展阅读：这是用于检查窄屏长标题和公开链接换行的参考内容`, reason: '**合成参考文章**用于检验推荐理由、中文换行与来源引用，不代表真实新闻或市场概率。', evidence_ids: [`reading-evidence-${index}`] }));
  previewDigest.evidence.push(...[1, 2, 3].map(index => ({ id: `reading-evidence-${index}`, url: `https://example.com/synthetic-reading-${index}`, source: '合成公开来源', published_at: '' })));
  await prepareDigestSources(user.id, run.runId, { bloomberg: { status: 'partial', reason: 'truncated', lastMessageAt: now, items: [] }, polymarket: { status: 'complete', reason: 'stale', lastMessageAt: '2026-08-13T16:27:49Z', items: [] } }, async () => ({ candidates: [], status: { source: 'aihot', status: 'complete', freshness: 'current', candidateCount: 0, lastMessageAt: '', reasonCodes: [], provenance: 'server_rest' } }));
}
if (fallbackVisual) { digest.media = []; digest.stories.forEach(story => { story.media_ids = []; }); }
const result = await publishDigestV2(user.id, run.runId, digest, 'shadow', { rules: fallbackVisual ? [] : [{ pageHost: new URL(origin).hostname, imageHosts: [new URL(origin).hostname], policy: 'OWNED_OPEN', licenseRef: 'owned synthetic preview fixture' }] });
const { renderDigestV2 } = await import('../server/digest-v2-render.js');
const { getDigestArtifact } = await import('../server/activity-store.js');
const publication = JSON.parse(getDigestArtifact(user.id, String(result.artifactId))!.payload_json).publication;
fs.writeFileSync(path.join(process.env.DATA_DIR, 'email-preview.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + renderDigestV2(publication, true));
api.app.get('/fixture-email', (_req, res) => res.type('html').send(fs.readFileSync(path.join(process.env.DATA_DIR!, 'email-preview.html'), 'utf8')));
api.app.listen(3187, '127.0.0.1', () => console.log(JSON.stringify({ previewUrl: 'http://127.0.0.1:5187' + result.previewUrl, email: user.email, password: 'Preview-only-2026', evidenceDirectory: process.env.DATA_DIR, media: result.media })));
