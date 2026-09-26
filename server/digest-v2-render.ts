import { canonicalJson, publicDigestUrl, validateDigestV2, DIGEST_V2_GENERATION, type DigestV2, type DigestStory } from './digest-v2-contract.js';
import type { PreparedImage } from './digest-v2-media.js';

const marker = '<!-- daily-digest.v2 -->\n';
export interface DigestPublication { digest: DigestV2; warnings: string[]; media: PreparedImage[]; renderer: string }
export function encodeDigestPublication(value: DigestPublication): string { return marker + canonicalJson(value); }
export function decodeDigestPublication(value: string): DigestPublication | null {
  if (!value.startsWith(marker) || value.length > 900_000) return null;
  try {
    const parsed = JSON.parse(value.slice(marker.length));
    if (!validateDigestV2(parsed.digest).valid || !Array.isArray(parsed.media) || parsed.media.length > 40 || !Array.isArray(parsed.warnings)) return null;
    if (parsed.warnings.some((s: unknown) => typeof s !== 'string') || parsed.media.some((m: any) => !m || typeof m.id !== 'string' || typeof m.publicUrl !== 'string' || typeof m.fallback !== 'boolean')) return null;
    return parsed;
  } catch { return null; }
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function imageCredit(m: PreparedImage, html = true): string {
  if (m.fallback) return m.storyId ? '原创编辑插画，非新闻现场图片' : '原创分类示意图，非新闻现场图片';
  const c = m.credit;
  if (!c || !['caption', 'author', 'licenseName', 'sourcePage', 'licenseUrl'].every(k => typeof (c as any)[k] === 'string') || !publicDigestUrl(c.sourcePage) || !publicDigestUrl(c.licenseUrl)) return '新闻配图';
  const changes = '已缩放、转为JPEG并清除元数据';
  return html ? `${esc(c.caption)} · ${esc(c.author)} · <a href="${esc(c.sourcePage)}" rel="noopener noreferrer">图片来源</a> · <a href="${esc(c.licenseUrl)}" rel="noopener noreferrer">${esc(c.licenseName)}</a> · ${changes}` : `${c.caption} · ${c.author} · ${c.sourcePage} · ${c.licenseName} ${c.licenseUrl} · ${changes}`;
}
const warnings: Record<string, string> = { CALENDAR_INCOMPLETE: '本期日程读取不完整，未取得的事项未包含。', MAIL_NOT_CONFIGURED: '本期未配置日报邮箱，邮件摘要未读取。', MAIL_READ_FAILED: '本期邮箱读取失败，邮件摘要未取得。', MAIL_INCOMPLETE: '本期邮箱读取不完整，未取得的邮件未包含。', WATCHLIST_INCOMPLETE: '本期观察名单检查不完整。' };
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
export function renderDigestV2(p: DigestPublication, email = false): string {
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
  const imageFor = (story: DigestStory) => [...story.media_ids.map(id => p.media.find(m => m.id === id)), ...p.media.filter(m => m.storyId === story.id)].find(m => m && m.kind !== 'source_icon' && publicDigestUrl(m.publicUrl));
  const stories = (items: DigestStory[], news = false) => {
    if (p.renderer !== DIGEST_V2_GENERATION) return legacyStories(items);
    const leadId = news ? items.find(s => imageFor(s))?.id : undefined;
    return items.map(s => {
      const image = imageFor(s);
      const lead = s.id === leadId;
      const title = `<h3 style="margin:0 0 8px;font-size:${lead ? '24px' : '17px'};line-height:1.4">${esc(s.title)}</h3>`;
      const summary = `<p style="margin:8px 0 0">${esc(s.summary)}</p>`;
      const attribution = `<p style="font-size:12px;opacity:.85">${s.verification === 'verified' ? '证据已核对' : s.verification === 'partial' ? '部分核对' : '尚未核实'} · ${evidence(s.evidence_ids)}</p>`;
      if (!image) return `<article class="digest-v2-story digest-v2-story--no-image" style="margin:24px 0;padding-top:16px;border-top:1px solid #c9d0d8">${title}<p style="font-size:12px;opacity:.7">此条暂无可用配图</p>${summary}${attribution}</article>`;
      const alt = image.fallback ? image.storyId ? '原创编辑插画，非新闻现场' : '原创分类示意图，非新闻现场' : image.credit?.caption || s.title;
      const credit = `<div style="font-size:11px;line-height:1.5;opacity:.75;overflow-wrap:anywhere">${imageCredit(image)}</div>`;
      if (lead) return `<article class="digest-v2-story digest-v2-story--lead" style="margin:28px 0;padding-top:18px;border-top:1px solid #c9d0d8">${title}<figure style="margin:14px 0"><img src="${esc(image.publicUrl)}" alt="${esc(alt)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:360px;object-fit:cover;border-radius:6px"/><figcaption>${credit}</figcaption></figure>${summary}${attribution}</article>`;
      return `<article class="digest-v2-story digest-v2-story--compact" style="margin:20px 0;padding-top:16px;border-top:1px solid #c9d0d8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td valign="top" style="min-width:0;padding-right:14px;overflow-wrap:anywhere">${title}${summary}</td><td valign="top" width="116" style="width:116px"><img src="${esc(image.publicUrl)}" alt="${esc(alt)}" width="116" height="82" style="display:block;width:116px;height:82px;object-fit:cover;border-radius:5px"/></td></tr></table>${credit}${attribution}</article>`;
    }).join('');
  };
  const alerts = p.warnings.filter(w => warnings[w]).map(w => `<p>${warnings[w]}</p>`).join('');
  return `<div class="digest-v2" style="max-width:680px;margin:0 auto;overflow-wrap:anywhere;line-height:1.8;${email ? 'color:#253247;background:#fff;font-family:Arial,sans-serif;padding:20px' : 'color:inherit'}"><header><p style="font-size:12px;letter-spacing:.08em">DAILY DIGEST · ${esc(d.date)}</p><h1 style="font-size:26px;line-height:1.4">${esc(d.title)}</h1></header>${alerts ? `<aside role="status" style="border-left:4px solid #bd830e;padding:4px 16px"><strong>本期信息不完整</strong>${alerts}</aside>` : ''}${section('Executive Signals · 重点信号', list(d.executive_signals) || '<p>在本期检查范围内，没有选出重大信号。</p>')}${section('个人日程', list(d.calendar.map(x => x.text)) || (p.warnings.includes('CALENDAR_INCOMPLETE') ? '<p>未取得可展示的日程内容。</p>' : ''))}${section('邮件简报与行动', list(d.mail.map(x => x.summary + (x.action ? '；行动：' + x.action : ''))) || emptyMailHtml(p))}${section('市场快照', stories(d.market))}${section('Macro Radar · 宏观简报', stories(d.macro))}${section('重要新闻', stories(d.stories, true))}${section('Watchlist · 持续关注', d.watchlist.map(w => `<p>${esc(w.summary)}<br/><small>${w.check === 'incomplete' ? '检查不完整' : w.change === 'nothing_material' ? '本期检查范围内无重大变化' : w.change === 'material' ? '重大变化' : '尚不能判断'} · ${evidence(w.evidence_ids)}</small></p>`).join(''))}${section('What Matters Next · 后续关注', list(d.what_matters_next))}<footer style="font-size:12px;opacity:.65">daily-digest.v2 · 事实、分析与尚待核实内容请结合来源阅读。</footer></div>`;
}
export function digestV2Text(p: DigestPublication): string {
  const d = p.digest;
  return [d.date, d.title, ...p.warnings.map(w => warnings[w] || ''), '重点信号', ...d.executive_signals, '日程', ...d.calendar.map(x => x.text), '邮件', ...d.mail.map(x => x.summary + '\n' + x.action), ...(d.mail.length === 0 && p.renderer !== '2026-09-21.1' && p.renderer !== '2026-09-22.2' ? [emptyMailMessage(p)] : []), ...[...d.market, ...d.macro, ...d.stories].map(x => x.title + '\n' + x.summary), '观察名单', ...d.watchlist.map(x => x.summary + ' · ' + (x.check === 'incomplete' ? '检查不完整' : x.change === 'nothing_material' ? '检查范围内无重大变化' : x.change === 'material' ? '重大变化' : '尚不能判断')), '后续关注', ...d.what_matters_next, '图片署名', ...p.media.filter(m => m.publicUrl && m.kind !== 'source_icon').map(m => imageCredit(m, false)), '来源', ...d.evidence.map(x => x.source + ': ' + x.url)].join('\n\n');
}
