/** Loopback-only renderer fixture. Synthetic content/images, no database, .env, AI or mail. */
import fs from 'node:fs';
import http from 'node:http';
import sharp from 'sharp';
import { renderDigestV2, type DigestPublication } from '../server/digest-v2-render.js';
import { DIGEST_V2_GENERATION, validateDigestV2, type DigestV2 } from '../server/digest-v2-contract.js';

const date = '2026-10-07';
const paragraphs = [
  '这是用于检查手机排版的**合成深读**，没有使用任何真实邮件或生产数据。正文需要在缩略图下方**铺满宽度**，读者才能连续阅读完整的背景与分析。',
  '第二段讨论**背景信息**：同一篇文章包含多个自然段时，图片不应持续占据右侧空列。**横向空间恢复**以后，即使字号增加，也能减少不必要的碎行。',
  '第三段说明**具体机制**：标题和缩略图构成独立的开头，正文另起一行。每一段都应与**文章边缘**对齐，段落之间留出明确间距，而不是用空白列分隔。',
  '第四段列出**观察边界**：测试素材只能证明字号、行距、图片与来源链接的显示。**浏览器邮件预览**不能代替手机邮箱客户端的实际表现，合成内容也不代表新闻核验通过。',
  '第五段保留**后续观察**：长英文名称 ExampleInfrastructurePlatform、数字 3.59 GW 和中文应正常换行。**来源角标**放在最后一段末尾，图片的署名和许可仍然完整可读。',
];
const evidence = (id: string) => ({ id, url: `https://example.com/synthetic/${id}`, source: '合成公开来源', published_at: '' });
const digest: DigestV2 = {
  schema_version: 'daily-digest.v2', date, title: '手机日报合成排版预览',
  executive_signals: ['本页为**合成排版预览**，用于检查阅读宽度和样式。'],
  calendar: [{ input_id: 'calendar-1', text: '19:00 · **合成日程**，检查图文阅读。' }],
  mail: [{ input_id: 'mail-1', summary: '**合成服务**通知待办资料已准备完成，已知期限为10月10日。', action: '在期限前**核对资料**。' }],
  market: [], macro: [],
  stories: [
    { id: 'lead', title: '合成头条：保留大图与标题在图下的阅读顺序', summary: '这是用于检查**头条布局**的合成正文，图片与标题顺序应保持清楚。', evidence_ids: ['lead-source'], media_ids: ['lead-image'], verification: 'unverified' },
    { id: 'deep', title: '合成深读：长标题、横向照片与五个自然段在手机上的全宽阅读', summary: paragraphs.join('\n\n'), evidence_ids: ['deep-source'], media_ids: ['deep-image'], verification: 'unverified' },
    { id: 'short', title: '合成短新闻：竖向照片与一段摘要', summary: '这条**短新闻**用于检查竖向素材裁切后的缩略图，以及正文是否在图片下方完整展开。', evidence_ids: ['short-source'], media_ids: ['short-image'], verification: 'unverified' },
    { id: 'empty', title: '合成无图新闻：长标题与文本空态仍须可读', summary: '这条**无图新闻**保留明确的图片空态，正文不应出现空白图片列。', evidence_ids: ['empty-source'], media_ids: [], verification: 'unverified' },
  ],
  watchlist: [{ input_id: 'watch-1', summary: '**合成关注对象**\n窗口时间：10月6日至10月7日\n• 已完成**第一项检查**。\n• 第二项记录**合成观察**。\n参考内容：\n合成来源标题', check: 'incomplete', change: 'unknown', evidence_ids: ['watch-source'] }],
  what_matters_next: ['检查**来源角标**是否跳到正确的文末条目。'],
  evidence: ['lead-source', 'deep-source', 'short-source', 'empty-source', 'watch-source', 'reading-1', 'reading-2', 'reading-3'].map(evidence),
  media: ['lead', 'deep', 'short'].map(id => ({ id: `${id}-image`, evidence_id: `${id}-source`, url: `https://example.com/${id}.jpg`, category: 'AI' })),
  further_reading: [1, 2, 3].map(i => ({ id: `further-${i}`, title: `合成拓展阅读${i}：长标题及参考链接的自然换行`, reason: '这篇**合成参考内容**用于验证拓展阅读的间距和来源，不是实际报道。', evidence_ids: [`reading-${i}`] })),
};
const validation = validateDigestV2(digest);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
const publication: DigestPublication = { digest, warnings: ['SOURCE_POLYMARKET_NO_NEW_MAIL'], renderer: DIGEST_V2_GENERATION,
  media: ['lead', 'deep', 'short'].map(id => ({ id: `${id}-image`, publicUrl: `https://example.com/${id}.jpg`, fallback: false, visualKind: 'archive_photo', credit: { caption: '自有合成测试图片，非真实新闻照片；用于检查长图注和自然换行', author: 'Orbit 合成验收素材', sourcePage: 'https://example.com/synthetic/image', licenseName: 'CC0 合成测试标注', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' } })) as DigestPublication['media'],
};
const images = new Map<string, Buffer>();
for (const id of ['lead', 'deep', 'short']) {
  const width = id === 'short' ? 600 : 1200, height = id === 'short' ? 900 : 734;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c8dceb"/><circle cx="75%" cy="25%" r="100" fill="#f1db9c"/><path d="M0 ${height} L${width / 3} ${height / 3} L${width} ${height}Z" fill="#718f9e"/><text x="8%" y="90%" font-size="40" fill="#213b50">SYNTHETIC IMAGE</text></svg>`;
  images.set(`/${id}.jpg`, await sharp(Buffer.from(svg)).jpeg().toBuffer());
}
const localImages = (html: string) => html.replace(/https:\/\/example\.com\/(lead|deep|short)\.jpg/g, '/$1.jpg');
const css = fs.readFileSync(new URL('../src/styles/reports.css', import.meta.url), 'utf8');
const themeCss = `:root{--td-text-color-primary:#253247;--td-text-color-secondary:#59677b;--td-text-color-placeholder:#6b7585;--td-component-stroke:#c9d0d8;--td-bg-color-page:#fff;--td-bg-color-container:#fff;--td-brand-color:#285eaa;--color-background:255 255 255}html.dark{--td-text-color-primary:#e4eaf3;--td-text-color-secondary:#a8b7cc;--td-text-color-placeholder:#9caac0;--td-component-stroke:#445268;--td-bg-color-page:#17202c;--td-bg-color-container:#17202c;--td-brand-color:#86b7fc;--color-background:23 32 44}*{box-sizing:border-box}body{margin:0;font-family:Arial,'Microsoft YaHei',sans-serif;background:rgb(var(--color-background));color:var(--td-text-color-primary)}button{min-height:44px;padding:8px;font:inherit}main{height:100vh!important}.fixture-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.digest-v2-story{scroll-margin-top:70px}`;
const page = (email: boolean) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>手机日报合成排版预览</title><style>${email ? 'body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}' : themeCss + css}</style>${email ? localImages(renderDigestV2(publication, true)) : `<main class="daily-report-reader-page"><div class="daily-report-reader-toolbar fixture-toolbar"><span>合成预览 · 未发布/发信</span><button onclick="document.documentElement.classList.toggle('dark')">切换主题</button></div><div class="daily-report-reader-content is-legacy"><div class="daily-report-markdown daily-report-reader-markdown">${localImages(renderDigestV2(publication))}</div></div></main>`}</html>`;
const port = Number(process.argv[2] || 4187);
const server = http.createServer((req, res) => {
  if (images.has(req.url || '')) { res.setHeader('Content-Type', 'image/jpeg'); res.end(images.get(req.url!)); return; }
  if (req.url === '/' || req.url === '/email') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(req.url === '/email')); return; }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => console.log(`Synthetic digest preview: http://127.0.0.1:${port}/ ; HTML email: /email`));
process.on('SIGINT', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
