import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import { digestHash, type DigestStory, type DigestV2 } from './digest-v2-contract.js';
import { dailyReportMediaRoot, getDailyReportMediaPublicOrigin } from './daily-report-media-service.js';
import type { MediaRule } from './digest-v2-media.js';

const symbols = ['chip', 'code', 'factory', 'bank', 'document', 'globe', 'cloud', 'shield'] as const;
const categories = ['AI', 'Semiconductor', 'Banking', 'Macro', 'Gaming', 'China', 'International', 'Company', 'Market'];
export interface NewsVisualPlan {
  story_id: string; evidence_id: string; category: string;
  layout: 'entities' | 'metric' | 'facts'; labels: string[]; symbols: typeof symbols[number][];
}
export interface PreparedNewsVisual {
  id: string; storyId: string; storyHash: string; evidenceId: string; evidenceHash: string;
  evidenceUrl: string; planHash: string; filename: string; sha256: string; url: string;
}
export const NEWS_VISUAL_PLAN_SCHEMA = {
  type: 'array', minItems: 1, maxItems: 20,
  items: { type: 'object', additionalProperties: false,
    required: ['story_id', 'evidence_id', 'category', 'layout', 'labels', 'symbols'],
    properties: {
      story_id: { type: 'string', minLength: 1, maxLength: 100 },
      evidence_id: { type: 'string', minLength: 1, maxLength: 100 },
      category: { type: 'string', enum: categories },
      layout: { type: 'string', enum: ['entities', 'metric', 'facts'] },
      labels: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', minLength: 2, maxLength: 36 }, description: '每个标签必须是本条标题或摘要已有的连续原文短语（去除 **）。entities 前两个为对象、第三个为已有关系；metric 第一个为已有数字。不能新增预测或数字。' },
      symbols: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: symbols }, description: '与本条事实相关的概念符号，非照片或企业标识。entities 两个、metric 一个、facts 与标签数量一致。' },
    },
  },
};
export function storyVisualHash(story: DigestStory): string {
  const { media_ids: _media, ...content } = story;
  return digestHash(content);
}
const plain = (s: string) => s.replace(/\*\*/g, '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function validateNewsVisualPlans(d: DigestV2, value: unknown): NewsVisualPlan[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('VISUAL_PLAN_LIMIT');
  const seen = new Set<string>();
  const stories = [...d.market, ...d.macro, ...d.stories];
  for (const v of value) {
    if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'category,evidence_id,labels,layout,story_id,symbols'
      || !categories.includes(v.category) || !['entities', 'metric', 'facts'].includes(v.layout)
      || !Array.isArray(v.labels) || v.labels.length < 2 || v.labels.length > 3
      || !Array.isArray(v.symbols) || !v.symbols.length || v.symbols.length > 3 || v.symbols.some((s: any) => !symbols.includes(s))) throw new Error('VISUAL_PLAN_INVALID');
    const story = stories.find(s => s.id === v.story_id);
    const evidence = d.evidence.find(e => e.id === v.evidence_id);
    if (!story || !evidence || !story.evidence_ids.includes(evidence.id) || story.verification === 'unverified') throw new Error('VISUAL_EVIDENCE_REQUIRED');
    if (seen.has(story.id)) throw new Error('VISUAL_DUPLICATE_STORY');
    seen.add(story.id);
    const content = plain(`${story.title} ${story.summary}`);
    const numbers = new Set(content.match(/\d+(?:[.,]\d+)*(?:[%％])?/gu) || []);
    if (v.labels.some((s: unknown) => typeof s !== 'string' || s.length < 2 || s.length > 36 || s !== s.trim() || /[\u0000-\u001f\u007f]/u.test(s) || !content.includes(plain(s)))
      || new Set(v.labels.map(plain)).size !== v.labels.length) throw new Error('VISUAL_UNSUPPORTED_LABEL');
    if (v.labels.some((s: string) => (plain(s).match(/\d+(?:[.,]\d+)*(?:[%％])?/gu) || []).some(n => !numbers.has(n)))) throw new Error('VISUAL_UNSUPPORTED_LABEL');
    if ((v.layout === 'entities' && (v.labels.length !== 3 || v.symbols.length !== 2))
      || (v.layout === 'metric' && (!/^[+\-]?\d[\d,.]*[%％]?$/u.test(v.labels[0]) || v.symbols.length !== 1))
      || (v.layout === 'facts' && v.symbols.length !== v.labels.length)) throw new Error('VISUAL_LAYOUT_INVALID');
  }
  return value as NewsVisualPlan[];
}
function icon(name: NewsVisualPlan['symbols'][number], x: number, y: number, size = 100): string {
  const drawings: Record<NewsVisualPlan['symbols'][number], string> = {
    chip: '<rect x="20" y="20" width="60" height="60" rx="10"/><rect x="34" y="34" width="32" height="32" rx="4"/><path d="M30 8v12m20-12v12m20-12v12M30 80v12m20-12v12m20-12v12M8 30h12M8 50h12M8 70h12m60-40h12M80 50h12M80 70h12"/>',
    code: '<rect x="8" y="16" width="84" height="68" rx="10"/><path d="m35 38-14 12 14 12m30-24 14 12-14 12M56 32 44 68"/>',
    factory: '<path d="M8 84V44l28-16v20l28-16v52Zm62 0V12h14v72M20 62h8m16 0h8m-32 12h8m16 0h8"/>',
    bank: '<path d="m8 30 42-20 42 20ZM16 40v32m22-32v32m24-32v32m22-32v32M8 84h84M8 76h84"/>',
    document: '<path d="M24 8h36l18 18v66H24ZM60 8v22h18M36 44h30M36 58h30M36 72h20"/>',
    globe: '<circle cx="50" cy="50" r="40"/><ellipse cx="50" cy="50" rx="18" ry="40"/><path d="M10 50h80M17 28h66M17 72h66"/>',
    cloud: '<path d="M26 78C0 78 2 42 24 42 20 10 72 4 76 40 106 40 104 78 80 78Z"/><path d="M35 54h30m-30 12h20"/>',
    shield: '<path d="M50 8 84 22v30c0 20-18 32-34 40-16-8-34-20-34-40V22ZM32 48l12 12 24-28"/>',
  };
  return `<g transform="translate(${x} ${y}) scale(${size / 100})" fill="none" stroke="#66d7cd" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${drawings[name]}</g>`;
}
// Fixed geometry and escaped literal text only; no caller SVG, URLs, fonts or filesystem paths.
export async function renderNewsVisual(story: DigestStory, plan: NewsVisualPlan): Promise<Buffer> {
  const fontfile = fileURLToPath(new URL('../assets/fonts/NotoSansSC.ttf', import.meta.url));
  const overlays: OverlayOptions[] = [];
  const text = async (value: string, left: number, top: number, width: number, height: number, color = '#edf7f5', size = 36, center = true) => {
    const input = await sharp({ text: { text: `<span foreground="${color}">${escape(plain(value))}</span>`, font: `Noto Sans SC ${size}`, fontfile, width, height, align: center ? 'center' : 'left', wrap: 'word-char', rgba: true } }).png().toBuffer();
    const meta = await sharp(input).metadata();
    overlays.push({ input, left: left + (center ? Math.floor((width - meta.width!) / 2) : 0), top });
  };
  let scene = '<rect width="1200" height="480" fill="#102b35"/><path d="M0 420 1200 370V480H0Z" fill="#163c44"/><circle cx="1110" cy="50" r="180" fill="#174750"/><path d="M48 94H1152" stroke="#2c5960" stroke-width="2"/>';
  await text(story.title, 58, 26, 1084, 56, '#edf7f5', 38, false);
  if (plan.layout === 'entities') {
    scene += '<rect x="82" y="125" width="370" height="244" rx="22" fill="#173e48"/><rect x="748" y="125" width="370" height="244" rx="22" fill="#173e48"/><path d="M470 235h260" stroke="#66d7cd" stroke-width="3" stroke-dasharray="8 9"/>';
    scene += icon(plan.symbols[0], 214, 143, 106) + icon(plan.symbols[1], 880, 143, 106);
    await text(plan.labels[0], 103, 275, 328, 58);
    await text(plan.labels[1], 769, 275, 328, 58);
    await text(plan.labels[2], 454, 276, 292, 76, '#8ae4da', 32);
  } else if (plan.layout === 'metric') {
    scene += icon(plan.symbols[0], 902, 164, 170);
    await text(plan.labels[0], 82, 118, 714, 152, '#8ae4da', 132, false);
    await text(plan.labels[1], 88, 294, 744, 58, '#edf7f5', 32, false);
    if (plan.labels[2]) await text(plan.labels[2], 88, 360, 744, 42, '#a6c5c8', 27, false);
  } else {
    const width = plan.labels.length === 2 ? 490 : 322;
    for (let i = 0; i < plan.labels.length; i++) {
      const left = 72 + i * (width + 42);
      scene += `<rect x="${left}" y="128" width="${width}" height="252" rx="22" fill="#173e48"/>` + icon(plan.symbols[i], left + (width - 104) / 2, 152, 104);
      await text(plan.labels[i], left + 16, 286, width - 32, 76, '#edf7f5', 32);
    }
  }
  await text(`原创新闻信息图 · 非现场照片${story.verification === 'partial' ? ' · 报道口径待核实' : ''}`, 58, 435, 1084, 26, '#aac6c9', 21, false);
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480">${scene}</svg>`)).composite(overlays).png().toBuffer();
}
export function visualRules(d: DigestV2, prepared: PreparedNewsVisual[]): MediaRule[] {
  const origin = getDailyReportMediaPublicOrigin();
  const rules: MediaRule[] = [];
  for (const m of d.media.filter(m => m.id.startsWith('visual:'))) {
    const v = prepared.find(v => v.id === m.id);
    const linked = [...d.market, ...d.macro, ...d.stories].filter(s => s.media_ids.includes(m.id));
    const story = linked[0];
    const evidence = d.evidence.find(e => e.id === m.evidence_id);
    if (!v || !story || linked.length !== 1 || !evidence || v.storyId !== story.id || v.evidenceId !== evidence.id || m.url !== v.url
      || v.url !== `${origin}/daily-report-media/${v.filename}`) throw new Error('VISUAL_NOT_PREPARED');
    if (v.storyHash !== storyVisualHash(story) || v.evidenceHash !== digestHash(evidence)) throw new Error('VISUAL_CONTENT_CHANGED');
    if (!/^[a-f0-9]{64}\.png$/.test(v.filename) || v.filename !== `${v.sha256}.png`) throw new Error('VISUAL_FILE_INVALID');
    const sourceFile = path.join(dailyReportMediaRoot(), v.filename);
    try {
      const stat = fs.lstatSync(sourceFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024 || digestBytesHash(fs.readFileSync(sourceFile)) !== v.sha256) throw new Error('VISUAL_FILE_INVALID');
    } catch { throw new Error('VISUAL_FILE_INVALID'); }
    rules.push({ pageHost: new URL(evidence.url).hostname, imageHosts: [new URL(origin).hostname], policy: 'OWNED_OPEN',
      licenseRef: 'code-owned-fact-graphic-v1', pageUrl: evidence.url, imageUrls: [m.url], sourceFile, sourceSha256: v.sha256, visualKind: 'illustration',
      credit: { caption: '原创新闻信息图，依据本条标题与摘要绘制，非现场照片', author: 'AI Calendar', sourcePage: v.url, licenseName: '原创信息图', licenseUrl: '' } });
  }
  return rules;
}
export const digestBytesHash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
