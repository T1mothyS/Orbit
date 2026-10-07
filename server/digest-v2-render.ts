import { canonicalJson, publicDigestUrl, validateDigestV2, DIGEST_V2_GENERATION, DIGEST_V2_EDITORIAL_GENERATIONS, DIGEST_V2_ILLUSTRATED_GENERATIONS, type DigestV2, type DigestStory, type DigestEvidence } from './digest-v2-contract.js';
import type { MediaCredit, PreparedImage } from './digest-v2-media.js';

const marker = '<!-- daily-digest.v2 -->\n';
export interface DigestPublication { digest: DigestV2; warnings: string[]; media: PreparedImage[]; renderer: string }
export function encodeDigestPublication(value: DigestPublication): string { return marker + canonicalJson(value); }
export function decodeDigestPublication(value: string): DigestPublication | null {
  if (!value.startsWith(marker) || value.length > 900_000) return null;
  try {
    const parsed = JSON.parse(value.slice(marker.length));
    if (typeof parsed.renderer !== 'string' || !validateDigestV2(parsed.digest, undefined, parsed.renderer).valid || !Array.isArray(parsed.media) || parsed.media.length > 40 || !Array.isArray(parsed.warnings)) return null;
    if (parsed.warnings.some((s: unknown) => typeof s !== 'string') || parsed.media.some((m: any) => !m || typeof m.id !== 'string' || typeof m.publicUrl !== 'string' || typeof m.fallback !== 'boolean')) return null;
    return parsed;
  } catch { return null; }
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function validImageCredit(m: PreparedImage): MediaCredit | null {
  const c = m.credit;
  return c && ['caption', 'author', 'licenseName', 'sourcePage', 'licenseUrl'].every(k => typeof (c as any)[k] === 'string') && publicDigestUrl(c.sourcePage) && (m.visualKind === 'illustration' ? c.licenseUrl === '' : publicDigestUrl(c.licenseUrl)) ? c : null;
}
function imageCredit(m: PreparedImage, html = true): string {
  if (m.fallback) return m.visualKind === 'illustration' ? '原创贴题插画，非新闻现场图片' : '原创栏目占位图，非新闻现场图片';
  const c = validImageCredit(m);
  if (!c) return '新闻配图';
  const changes = '已缩放、转为JPEG并清除元数据';
  if (m.visualKind === 'illustration') return html ? `${esc(c.caption)} · ${esc(c.author)} · <a href="${esc(c.sourcePage)}" rel="noopener noreferrer">原始插画</a> · ${esc(c.licenseName)} · ${changes}` : `${c.caption} · ${c.author} · ${c.sourcePage} · ${c.licenseName} · ${changes}`;
  return html ? `${esc(c.caption)} · ${esc(c.author)} · <a href="${esc(c.sourcePage)}" rel="noopener noreferrer">图片来源</a> · <a href="${esc(c.licenseUrl)}" rel="noopener noreferrer">${esc(c.licenseName)}</a> · ${changes}` : `${c.caption} · ${c.author} · ${c.sourcePage} · ${c.licenseName} ${c.licenseUrl} · ${changes}`;
}
function imageForStory(p: DigestPublication, story: DigestStory): PreparedImage | undefined {
  return [...story.media_ids.map(id => p.media.find(m => m.id === id)), ...p.media.filter(m => m.storyId === story.id)]
    .find(m => m && m.kind !== 'source_icon' && publicDigestUrl(m.publicUrl));
}
export function digestV2Cover(p: DigestPublication) {
  const items = [...p.digest.stories, ...p.digest.market, ...p.digest.macro];
  const story = items.find(s => imageForStory(p, s)) || items[0];
  const image = story && imageForStory(p, story);
  const credit = image && !image.fallback ? validImageCredit(image) : null;
  return {
    headline: story?.title || p.digest.title,
    excerpt: plainEmphasis(story?.summary || p.digest.executive_signals[0] || p.digest.title).slice(0, 240),
    heroImageUrl: image?.publicUrl || null,
    heroImageVisualKind: image?.visualKind || (image?.fallback ? 'placeholder' : image ? 'archive_photo' : null),
    heroImageCredit: image ? image.fallback ? imageCredit(image, false) : credit ? `${credit.caption} · ${credit.author} · ${credit.licenseName}` : '新闻配图，来源见详情' : null,
    heroImageSourceUrl: credit?.sourcePage || null,
    heroImageLicenseUrl: credit?.licenseUrl || null,
  };
}
const warnings: Record<string, string> = { CALENDAR_INCOMPLETE: '本期日程读取不完整，未取得的事项未包含。', MAIL_NOT_CONFIGURED: '本期未配置日报邮箱，邮件摘要未读取。', MAIL_READ_FAILED: '本期邮箱读取失败，邮件摘要未取得。', MAIL_INCOMPLETE: '本期邮箱读取不完整，未取得的邮件未包含。', WATCHLIST_NOT_CONFIGURED: '个人关注列表尚未配置，本期未检查关注对象。', WATCHLIST_READ_FAILED: '个人关注列表读取失败，本期无法判断关注对象变化。', WATCHLIST_INCOMPLETE: '本期观察名单读取不完整，未取得的标的尚未检查。' };
for (const [source, label] of [['AIHOT', 'AIHot'], ['BLOOMBERG', 'Bloomberg'], ['POLYMARKET', 'Polymarket / Polygraph']]) {
  for (const [code, detail] of Object.entries({ FAILED: '读取失败', PARTIAL: '读取不完整或候选已截断', NOT_CONFIGURED: '尚未连接或配置', NO_NEW_MAIL: '本期窗口内没有新邮件', STALE: '最近内容已过旧，不能作为当前数据' })) {
    warnings[`SOURCE_${source}_${code}`] = `${label}：${detail}；不能据此判断相关事件无变化。`;
  }
}
function emptyWatchlistMessage(p: DigestPublication): string {
  if (p.warnings.includes('WATCHLIST_NOT_CONFIGURED')) return '个人关注列表尚未配置，本期未检查关注对象。';
  if (p.warnings.includes('WATCHLIST_READ_FAILED')) return '个人关注列表读取失败，本期无法判断关注对象变化。';
  if (p.warnings.includes('WATCHLIST_INCOMPLETE')) return '个人关注列表读取不完整，本期无法确认全部关注对象的变化。';
  return '本期输入快照未记录关注标的，无法判断个人关注是否有变化。';
}
function watchlistCheckMessage(item: DigestV2['watchlist'][number]): string {
  return item.check === 'incomplete' ? '已读取，尚未完成研究或核验' : item.change === 'nothing_material' ? '有界检查未发现重大变化' : item.change === 'material' ? '发现有依据的重要变化' : '已检查，暂不能判断变化';
}
function emptyMailMessage(p: DigestPublication): string {
  if (p.warnings.includes('MAIL_NOT_CONFIGURED')) return '日报邮箱尚未配置，本期未读取邮件。';
  if (p.warnings.includes('MAIL_READ_FAILED')) return '邮箱读取失败，未取得可展示的邮件摘要。';
  if (p.warnings.includes('MAIL_INCOMPLETE')) return '未取得可展示的邮件摘要。';
  return '本期无新增内容。';
}
function emptyMailHtml(p: DigestPublication): string {
  if (p.renderer === '2026-09-21.1' || p.renderer === '2026-09-22.2') {
    return p.warnings.includes('MAIL_INCOMPLETE') ? '<p>未取得可展示的邮件摘要。</p>' : '';
  }
  return `<p>${emptyMailMessage(p)}</p>`;
}
function digestDisplayTitle(p: DigestPublication): string {
  if (!DIGEST_V2_ILLUSTRATED_GENERATIONS.includes(p.renderer)) return p.digest.title;
  return [...p.digest.stories, ...p.digest.market, ...p.digest.macro].length ? '今日重点新闻' : '今日情报简报';
}
const plainEmphasis = (value: string): string => value.replace(/\*\*/g, '');
const emphasis = (value: string, email = false): string => value.split('**').map((part, i) => i % 2 ? `<strong${email ? ' style="font-weight:600"' : ''}>${esc(part)}</strong>` : esc(part)).join('');
function conciseImageCredit(image: PreparedImage): string {
  if (image.fallback || image.visualKind === 'illustration') return imageCredit(image);
  const c = validImageCredit(image);
  if (!c) return '新闻配图';
  return `${esc(c.caption)} · ${esc(c.author)} · <a href="${esc(c.sourcePage)}" rel="noopener noreferrer">图片来源</a> · <a href="${esc(c.licenseUrl)}" rel="noopener noreferrer">${esc(c.licenseName)}</a> · 已编辑`;
}
function plainImageCredit(image: PreparedImage): string {
  if (image.fallback || image.visualKind === 'illustration') return imageCredit(image, false);
  const c = validImageCredit(image);
  if (!c) return '新闻配图';
  return `${c.caption} · ${c.author} · ${c.sourcePage} · ${c.licenseName} ${c.licenseUrl} · 已编辑`;
}
function evidenceTime(value: string): string {
  return value ? esc(value.replace('T', ' ').replace(/Z$/, ' UTC').replace(/([+-]\d\d:\d\d)$/, ' $1')) : '时间未知';
}
function watchlistReadingParts(item: DigestV2['watchlist'][number]) {
  const lines = item.summary.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const references = lines.findIndex(line => /^参考内容[：:]$/.test(line));
  return {
    lines: references < 0 ? lines : lines.slice(0, references),
    titles: references < 0 ? [] : lines.slice(references + 1).map(line => line.replace(/^[•●]\s*/, '')),
    readable: lines.some(line => /^[•●]\s*\S/.test(line)) && lines.some(line => /^窗口时间[：:]/.test(line)),
  };
}
function watchlistReferenceDate(evidence: DigestEvidence, title: string): string {
  // A confirmed date-only title is preserved without inventing a timestamp.
  if (evidence.published_at) {
    const date = new Date(evidence.published_at);
    if (Number.isFinite(date.getTime())) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const value = (type: string) => parts.find(part => part.type === type)?.value || '';
      return ` · ${Number(value('month'))}月${Number(value('day'))}日 ${value('hour')}:${value('minute')}（北京时间）`;
    }
  }
  return /\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}/.test(title) ? '' : ' · 发布时间：时间未知';
}
function renderEditorialDigestV2(p: DigestPublication, email: boolean): string {
  const d = p.digest;
  const rich = (value: string) => emphasis(value, email);
  const section = (title: string, body: string) => `<section style="margin:28px 0"><h2 style="font-size:${email ? '20px;line-height:1.5' : '18px'};border-bottom:1px solid ${email ? '#b9c2ce' : 'var(--td-component-stroke, #b9c2ce)'};padding-bottom:10px">${title}</h2>${body || '<p>本期无新增内容。</p>'}</section>`;
  const list = (items: string[]) => items.length ? `<ul style="padding-left:24px">${items.map(item => `<li style="margin:8px 0">${rich(item)}</li>`).join('')}</ul>` : '';
  const mediaEvidenceIds = new Set(d.media.map(item => item.evidence_id));
  const sources = new Map<string, { number: number; evidence: DigestEvidence }>();
  const citedIds = (ids: string[]) => {
    const newsIds = ids.filter(id => !mediaEvidenceIds.has(id));
    return newsIds.length ? newsIds : ids;
  };
  const citations = (ids: string[]) => citedIds(ids).map(id => {
    const evidence = d.evidence.find(item => item.id === id);
    if (!evidence || !publicDigestUrl(evidence.url)) return '';
    if (!sources.has(id)) sources.set(id, { number: sources.size + 1, evidence });
    const number = sources.get(id)!.number;
    return `<sup style="font-size:11px;white-space:nowrap"><a href="#digest-source-${number}" aria-label="跳转到来源 ${number}" style="color:${email ? '#285eaa' : 'var(--td-brand-color, #285eaa)'}">[${number}]</a></sup>`;
  }).join('');
  const sourceIcon = (evidence: DigestEvidence) => {
    const host = new URL(evidence.url).hostname;
    const icon = p.media.find(media => media.kind === 'source_icon' && media.sourceHost === host && !media.fallback && publicDigestUrl(media.publicUrl));
    if (icon) return `<img src="${esc(icon.publicUrl)}" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:6px"/>`;
    const initial = evidence.source.match(/[A-Za-z]/)?.[0]?.toUpperCase() || Array.from(evidence.source.trim())[0] || '文';
    return `<span aria-hidden="true" style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;font-size:11px;font-weight:700;border:1px solid #9aa9bd;border-radius:4px;vertical-align:middle;margin-right:6px">${esc(initial)}</span>`;
  };
  const imageFor = (story: DigestStory) => imageForStory(p, story);
  const coverStory = [...d.stories, ...d.market, ...d.macro].find(story => imageFor(story));
  const coverImage = coverStory && imageFor(coverStory);
  const imageAlt = (image: PreparedImage, story: DigestStory) => image.fallback ? imageCredit(image, false) : image.credit?.caption || story.title;
  const stories = (items: DigestStory[], news = false) => {
    const leadId = news ? items.find(story => imageFor(story))?.id : undefined;
    return items.map(story => {
      const image = imageFor(story);
      const lead = story.id === leadId;
      const title = `<h3 class="digest-v2-story-title" style="margin:0 0 8px;font-size:${lead ? email ? '22px' : '24px' : email ? '18px' : '17px'};line-height:${email ? '1.45' : '1.4'}">${esc(story.title)}</h3>`;
      const paragraphs = story.summary.split(/\r?\n\s*\r?\n/);
      const summary = `<div class="digest-v2-story-body">${paragraphs.map((paragraph, index) => `<p style="margin:${email ? '12' : '8'}px 0 0">${rich(paragraph)}${index === paragraphs.length - 1 ? citations(story.evidence_ids) : ''}</p>`).join('')}</div>`;
      const frame = `class="digest-v2-story${lead ? ' digest-v2-story--lead' : ' digest-v2-story--compact'}" style="margin:24px 0;padding-top:16px;border-top:1px solid ${email ? '#c9d0d8' : 'var(--td-component-stroke, #c9d0d8)'}"`;
      if (!image) return `<article class="digest-v2-story digest-v2-story--no-image" style="margin:24px 0;padding-top:16px;border-top:1px solid ${email ? '#c9d0d8' : 'var(--td-component-stroke, #c9d0d8)'}">${title}<p style="font-size:12px;opacity:.7">此条暂无可用配图</p>${summary}</article>`;
      if (image === coverImage) return `<article ${frame}>${title}${summary}</article>`;
      const creditStyle = `font-size:${email ? '12px;line-height:1.6;color:#536174' : '11px;line-height:1.5;opacity:.75'};overflow-wrap:anywhere`;
      const credit = `<div class="digest-v2-image-credit" style="${creditStyle}">${conciseImageCredit(image)}</div>`;
      if (lead) return `<article ${frame}>${title}<figure style="margin:14px 0"><img src="${esc(image.publicUrl)}" alt="${esc(imageAlt(image, story))}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:360px;object-fit:cover;border-radius:6px"/><figcaption class="digest-v2-image-credit" style="${creditStyle}">${conciseImageCredit(image)}</figcaption></figure>${summary}</article>`;
      if (email) return `<article ${frame}><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td valign="top" style="min-width:0;padding-right:12px;overflow-wrap:anywhere">${title}</td><td valign="top" width="96" style="width:96px"><img src="${esc(image.publicUrl)}" alt="${esc(imageAlt(image, story))}" width="96" height="72" style="display:block;width:96px;height:72px;object-fit:cover;border-radius:5px"/></td></tr></table>${summary}${credit}</article>`;
      return `<article ${frame}><div class="digest-v2-story-layout">${title}<img class="digest-v2-story-thumb" src="${esc(image.publicUrl)}" alt="${esc(imageAlt(image, story))}" width="116" height="82"/>${summary}</div>${credit}</article>`;
    }).join('');
  };
  const alerts = p.warnings.filter(warning => warnings[warning]).map(warning => `<p>${warnings[warning]}</p>`).join('');
  // The generated placeholder is a wide 3:1 card. A tall, cover-fitted hero crops its label and artwork.
  const coverStyle = coverImage?.visualKind === 'placeholder' || coverImage?.visualKind === 'illustration' || coverImage?.fallback
    ? 'height:auto;max-height:320px;object-fit:contain'
    : email ? 'height:auto;max-height:440px;aspect-ratio:16/9;object-fit:cover' : 'height:70svh;min-height:360px;max-height:720px;object-fit:cover';
  const cover = coverImage && coverStory ? `<figure class="digest-v2-cover" style="margin:0 0 8px"><img src="${esc(coverImage.publicUrl)}" alt="${esc(imageAlt(coverImage, coverStory))}" width="680" style="display:block;width:100%;${coverStyle};border-radius:6px"/></figure>` : '';
  const coverCredit = coverImage ? `<p class="digest-v2-image-credit" style="font-size:${email ? '12px;line-height:1.6;color:#536174' : '11px;line-height:1.5;opacity:.75'};margin:4px 0 0">${conciseImageCredit(coverImage)}</p>` : '';
  const readings = p.renderer === DIGEST_V2_GENERATION ? d.further_reading || [] : [];
  const renderFurtherReading = () => readings.length ? section('拓展阅读', `<ul style="padding-left:24px">${readings.map(item => {
    const source = d.evidence.find(evidence => evidence.id === item.evidence_ids[0]);
    const title = source && publicDigestUrl(source.url) ? `<a href="${esc(source.url)}" rel="noopener noreferrer" style="color:${email ? '#285eaa' : 'var(--td-brand-color, #285eaa)'}">${esc(item.title)}</a>` : esc(item.title);
    return `<li class="digest-v2-reading" style="margin:16px 0"><strong${email ? ' style="font-weight:600"' : ''}>${title}</strong><p style="margin:4px 0">${rich(item.reason)}${citations(item.evidence_ids)}</p></li>`;
  }).join('')}</ul>`) : '';
  const renderWatchlist = (item: DigestV2['watchlist'][number]) => {
    const parts = watchlistReadingParts(item);
    if (!parts.readable) return `<p>${rich(item.summary)}${citations(item.evidence_ids)}<br/><small>${watchlistCheckMessage(item)}</small></p>`;
    const blocks: string[] = [];
    let bullets: string[] = [];
    const flush = () => { if (bullets.length) { blocks.push(list(bullets)); bullets = []; } };
    for (const line of parts.lines) {
      if (/^[•●]\s*\S/.test(line)) bullets.push(line.replace(/^[•●]\s*/, ''));
      else { flush(); blocks.push(`<p style="margin:8px 0">${rich(line)}</p>`); }
    }
    flush();
    const references = citedIds(item.evidence_ids).map(id => d.evidence.find(evidence => evidence.id === id)).filter((evidence): evidence is DigestEvidence => !!evidence && publicDigestUrl(evidence.url));
    const links = references.map((evidence, index) => {
      const title = parts.titles.length === references.length ? parts.titles[index] : evidence.source;
      return `<li style="margin:6px 0"><a href="${esc(evidence.url)}" rel="noopener noreferrer" style="color:${email ? '#285eaa' : 'var(--td-brand-color, #285eaa)'}">${rich(title)}</a>${watchlistReferenceDate(evidence, title)}${citations([evidence.id])}</li>`;
    }).join('');
    const scope = item.check === 'incomplete' ? '<p style="font-size:12px;opacity:.75">资料范围：仅覆盖列出的参考内容，未覆盖全部动态。</p>' : '';
    return `<article class="digest-v2-watchlist" style="margin:20px 0">${blocks.join('')}${links ? `<p style="margin:12px 0 4px"><strong>参考内容：</strong></p><ul style="padding-left:24px">${links}</ul>` : ''}${scope}</article>`;
  };
  const body = `${section('Executive Signals · 重点信号', list(d.executive_signals) || '<p>在本期检查范围内，没有选出重大信号。</p>')}${section('个人日程', list(d.calendar.map(item => item.text)) || (p.warnings.includes('CALENDAR_INCOMPLETE') ? '<p>未取得可展示的日程内容。</p>' : ''))}${section('邮件简报与行动', d.mail.length ? `<ul style="padding-left:24px">${d.mail.map(item => `<li style="margin:8px 0">${rich(item.summary)}${item.action ? `<br/><span>行动：${rich(item.action)}</span>` : ''}</li>`).join('')}</ul>` : emptyMailHtml(p))}${section('市场快照', stories(d.market))}${section('Macro Radar · 宏观简报', stories(d.macro))}${section('重要新闻', stories(d.stories, true))}${section('Watchlist · 持续关注', d.watchlist.length ? d.watchlist.map(renderWatchlist).join('') : `<p>${emptyWatchlistMessage(p)}</p>`)}${section('What Matters Next · 后续关注', list(d.what_matters_next))}`;
  const furtherReading = renderFurtherReading();
  const references = sources.size ? section('来源', `<ol style="padding-left:24px">${[...sources.values()].map(({ number, evidence }) => `<li id="digest-source-${number}" style="margin:10px 0;font-size:13px;line-height:1.65;scroll-margin-top:20px">${sourceIcon(evidence)}${esc(evidence.source)} · 发布时间：${evidenceTime(evidence.published_at)} · <a href="${esc(evidence.url)}" rel="noopener noreferrer" style="color:${email ? '#285eaa' : 'var(--td-brand-color, #285eaa)'}">原文链接</a></li>`).join('')}</ol>`) : '';
  return `<div class="digest-v2 digest-v2--editorial" style="width:100%;max-width:680px;box-sizing:border-box;margin:0 auto;overflow-wrap:anywhere;line-height:${email ? '1.75' : '1.8'};${email ? 'font-size:16px;color:#253247;background:#fff;font-family:Arial,sans-serif;padding:16px' : 'color:inherit'}">${cover}<header><h1 style="font-size:26px;line-height:1.4;margin:12px 0 2px">${esc(digestDisplayTitle(p))}</h1><p style="font-size:12px;letter-spacing:.08em;margin:0">DAILY DIGEST · ${esc(d.date)}</p></header>${coverCredit}${alerts ? `<aside role="status" style="border-left:4px solid #bd830e;padding:4px 16px"><strong>${p.renderer === DIGEST_V2_GENERATION && p.warnings.some(warning => warning.startsWith('SOURCE_')) ? '本期来源与输入说明' : '本期信息不完整'}</strong>${alerts}</aside>` : ''}${body}${furtherReading}${references}</div>`;
}
export function renderDigestV2(p: DigestPublication, email = false): string {
  if (DIGEST_V2_EDITORIAL_GENERATIONS.includes(p.renderer)) return renderEditorialDigestV2(p, email);
  const d = p.digest;
  const section = (title: string, body: string) => `<section style="margin:28px 0"><h2 style="font-size:18px;border-bottom:1px solid #b9c2ce;padding-bottom:10px">${title}</h2>${body || '<p>本期无新增内容。</p>'}</section>`;
  const list = (items: string[]) => items.length ? `<ul style="padding-left:24px">${items.map(x => `<li style="margin:8px 0">${esc(x)}</li>`).join('')}</ul>` : '';
  const sourceIcon = (url: string) => {
    const icon = p.media.find(m => m.kind === 'source_icon' && m.sourceHost === new URL(url).hostname && !m.fallback && publicDigestUrl(m.publicUrl));
    return icon ? `<img src="${esc(icon.publicUrl)}" alt="" width="16" height="16" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:5px"/>` : '';
  };
  const evidence = (ids: string[]) => ids.map(id => d.evidence.find(e => e.id === id)).filter(Boolean).map(e => `<a href="${esc(e!.url)}" rel="noopener noreferrer" style="color:${email ? '#285eaa' : 'var(--td-brand-color, #285eaa)'}">${sourceIcon(e!.url)}${esc(e!.source)}</a>${e!.published_at ? ` · ${esc(e!.published_at)}` : ' · 发布时间未提供'}`).join('；');
  const legacyStories = (items: DigestStory[]) => items.map(s => {
    const images = s.media_ids.map(id => p.media.find(m => m.id === id)).filter(m => m && m.kind !== 'source_icon' && publicDigestUrl(m.publicUrl));
    return `<article style="margin:24px 0"><h3 style="font-size:17px;line-height:1.5">${esc(s.title)}</h3>${images.map(m => `<figure style="margin:12px 0"><img src="${esc(m!.publicUrl)}" alt="${m!.fallback ? '分类示意图' : esc(s.title)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border-radius:6px"/><figcaption style="font-size:12px;opacity:.7">${imageCredit(m!)}</figcaption></figure>`).join('')}<p>${esc(s.summary)}</p><p style="font-size:12px;opacity:.85">${s.verification === 'verified' ? '证据已核对' : s.verification === 'partial' ? '部分核对' : '尚未核实'} · ${evidence(s.evidence_ids)}</p></article>`;
  }).join('');
  const imageFor = (story: DigestStory) => imageForStory(p, story);
  const stories = (items: DigestStory[], news = false) => {
    if (p.renderer !== '2026-09-26.1') return legacyStories(items);
    const leadId = news ? items.find(s => imageFor(s))?.id : undefined;
    return items.map(s => {
      const image = imageFor(s);
      const lead = s.id === leadId;
      const title = `<h3 style="margin:0 0 8px;font-size:${lead ? '24px' : '17px'};line-height:1.4">${esc(s.title)}</h3>`;
      const summary = `<p style="margin:8px 0 0">${esc(s.summary)}</p>`;
      const attribution = `<p style="font-size:12px;opacity:.85">${s.verification === 'verified' ? '证据已核对' : s.verification === 'partial' ? '部分核对' : '尚未核实'} · ${evidence(s.evidence_ids)}</p>`;
      if (!image) return `<article class="digest-v2-story digest-v2-story--no-image" style="margin:24px 0;padding-top:16px;border-top:1px solid #c9d0d8">${title}<p style="font-size:12px;opacity:.7">此条暂无可用配图</p>${summary}${attribution}</article>`;
      const alt = image.fallback ? imageCredit(image, false) : image.credit?.caption || s.title;
      const credit = `<div style="font-size:11px;line-height:1.5;opacity:.75;overflow-wrap:anywhere">${imageCredit(image)}</div>`;
      if (lead) return `<article class="digest-v2-story digest-v2-story--lead" style="margin:28px 0;padding-top:18px;border-top:1px solid #c9d0d8">${title}<figure style="margin:14px 0"><img src="${esc(image.publicUrl)}" alt="${esc(alt)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:360px;object-fit:cover;border-radius:6px"/><figcaption>${credit}</figcaption></figure>${summary}${attribution}</article>`;
      return `<article class="digest-v2-story digest-v2-story--compact" style="margin:20px 0;padding-top:16px;border-top:1px solid #c9d0d8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td valign="top" style="min-width:0;padding-right:14px;overflow-wrap:anywhere">${title}${summary}</td><td valign="top" width="116" style="width:116px"><img src="${esc(image.publicUrl)}" alt="${esc(alt)}" width="116" height="82" style="display:block;width:116px;height:82px;object-fit:cover;border-radius:5px"/></td></tr></table>${credit}${attribution}</article>`;
    }).join('');
  };
  const alerts = p.warnings.filter(w => warnings[w]).map(w => `<p>${warnings[w]}</p>`).join('');
  return `<div class="digest-v2" style="max-width:680px;margin:0 auto;overflow-wrap:anywhere;line-height:1.8;${email ? 'color:#253247;background:#fff;font-family:Arial,sans-serif;padding:20px' : 'color:inherit'}"><header><p style="font-size:12px;letter-spacing:.08em">DAILY DIGEST · ${esc(d.date)}</p><h1 style="font-size:26px;line-height:1.4">${esc(digestDisplayTitle(p))}</h1></header>${alerts ? `<aside role="status" style="border-left:4px solid #bd830e;padding:4px 16px"><strong>本期信息不完整</strong>${alerts}</aside>` : ''}${section('Executive Signals · 重点信号', list(d.executive_signals) || '<p>在本期检查范围内，没有选出重大信号。</p>')}${section('个人日程', list(d.calendar.map(x => x.text)) || (p.warnings.includes('CALENDAR_INCOMPLETE') ? '<p>未取得可展示的日程内容。</p>' : ''))}${section('邮件简报与行动', list(d.mail.map(x => x.summary + (x.action ? '；行动：' + x.action : ''))) || emptyMailHtml(p))}${section('市场快照', stories(d.market))}${section('Macro Radar · 宏观简报', stories(d.macro))}${section('重要新闻', stories(d.stories, true))}${section('Watchlist · 持续关注', d.watchlist.length ? d.watchlist.map(w => `<p>${esc(w.summary)}<br/><small>${watchlistCheckMessage(w)} · ${evidence(w.evidence_ids)}</small></p>`).join('') : `<p>${emptyWatchlistMessage(p)}</p>`)}${section('What Matters Next · 后续关注', list(d.what_matters_next))}<footer style="font-size:12px;opacity:.65">daily-digest.v2 · 事实、分析与尚待核实内容请结合来源阅读。</footer></div>`;
}
export function digestV2Text(p: DigestPublication): string {
  const d = p.digest;
  if (DIGEST_V2_EDITORIAL_GENERATIONS.includes(p.renderer)) {
    const mediaEvidenceIds = new Set(d.media.map(item => item.evidence_id));
    const sources = new Map<string, DigestEvidence>();
    const refs = (ids: string[]) => {
      const newsIds = ids.filter(id => !mediaEvidenceIds.has(id));
      return (newsIds.length ? newsIds : ids).map(id => {
        const evidence = d.evidence.find(item => item.id === id);
        if (!evidence) return '';
        if (!sources.has(id)) sources.set(id, evidence);
        return `[${[...sources.keys()].indexOf(id) + 1}]`;
      }).join('');
    };
    const stories = [...d.market, ...d.macro, ...d.stories].map(story => story.title + '\n' + plainEmphasis(story.summary) + refs(story.evidence_ids));
    const watchlist = d.watchlist.length ? d.watchlist.map(item => {
      const parts = watchlistReadingParts(item);
      if (!parts.readable) return plainEmphasis(item.summary) + refs(item.evidence_ids) + ' · ' + watchlistCheckMessage(item);
      const evidence = item.evidence_ids.filter(id => !mediaEvidenceIds.has(id)).map(id => d.evidence.find(source => source.id === id)).filter((source): source is DigestEvidence => !!source);
      const references = evidence.map((source, index) => {
        const title = parts.titles.length === evidence.length ? parts.titles[index] : source.source;
        return `• ${plainEmphasis(title)}${watchlistReferenceDate(source, title)} ${source.url}${refs([source.id])}`;
      });
      return [parts.lines.map(plainEmphasis).join('\n'), ...(references.length ? ['参考内容：', ...references] : []), ...(item.check === 'incomplete' ? ['资料范围：仅覆盖列出的参考内容，未覆盖全部动态。'] : [])].join('\n');
    }) : [emptyWatchlistMessage(p)];
    const readings = p.renderer === DIGEST_V2_GENERATION ? (d.further_reading || []).map(item => item.title + '\n' + plainEmphasis(item.reason) + refs(item.evidence_ids)) : [];
    const sourceList = [...sources.values()].map((item, index) => `[${index + 1}] ${item.source} · 发布时间：${item.published_at ? item.published_at.replace('T', ' ') : '时间未知'} · ${item.url}`);
    return [d.date, digestDisplayTitle(p), ...p.warnings.map(w => warnings[w] || ''), '重点信号', ...d.executive_signals.map(plainEmphasis), '日程', ...d.calendar.map(item => plainEmphasis(item.text)), '邮件', ...d.mail.map(item => plainEmphasis(item.summary) + (item.action ? '\n行动：' + plainEmphasis(item.action) : '')), ...(d.mail.length ? [] : [emptyMailMessage(p)]), '新闻', ...stories, '观察名单', ...watchlist, '后续关注', ...d.what_matters_next.map(plainEmphasis), ...(readings.length ? ['拓展阅读', ...readings] : []), '来源', ...sourceList, '图片署名', ...p.media.filter(media => media.publicUrl && media.kind !== 'source_icon').map(plainImageCredit)].join('\n\n');
  }
  return [d.date, digestDisplayTitle(p), ...p.warnings.map(w => warnings[w] || ''), '重点信号', ...d.executive_signals, '日程', ...d.calendar.map(x => x.text), '邮件', ...d.mail.map(x => x.summary + '\n' + x.action), ...(d.mail.length === 0 && p.renderer !== '2026-09-21.1' && p.renderer !== '2026-09-22.2' ? [emptyMailMessage(p)] : []), ...[...d.market, ...d.macro, ...d.stories].map(x => x.title + '\n' + x.summary), '观察名单', ...(d.watchlist.length ? d.watchlist.map(x => x.summary + ' · ' + watchlistCheckMessage(x)) : [emptyWatchlistMessage(p)]), '后续关注', ...d.what_matters_next, '图片署名', ...p.media.filter(m => m.publicUrl && m.kind !== 'source_icon').map(m => imageCredit(m, false)), '来源', ...d.evidence.map(x => x.source + ': ' + x.url)].join('\n\n');
}
