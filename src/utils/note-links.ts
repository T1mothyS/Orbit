import { safeOrbitLink } from './orbit-links';

export interface NoteLinkPiece { text: string; href?: string }
const fileExtensions = new Set(['txt','md','pdf','doc','docx','xls','xlsx','csv','tsv','ppt','pptx','json','yaml','yml','xml','html','htm','css','js','jsx','ts','tsx','py','zip','rar','png','jpg','jpeg','gif','webp','svg','mp3','mp4','exe','dll','log','sql']);
const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>]*)?$/i;
function noteHref(raw: string, origin: string) {
  if (domain.test(raw)) {
    const host = raw.split(/[/:?#]/)[0];
    if (fileExtensions.has(host.split('.').at(-1)!.toLowerCase())) return null;
    return safeOrbitLink(`https://${raw}`, origin);
  }
  return safeOrbitLink(raw, origin);
}

export function noteLinkPieces(text: string, origin: string): NoteLinkPiece[] {
  const pieces: NoteLinkPiece[] = [];
  // Consume explicit schemes first so a rejected URL cannot expose its domain as a separate link.
  const pattern = /\[([^\]\n]+)\]\(([^\s)]+)\)|[a-z][a-z0-9+.-]*:[^\s<>。，；！？、）]+|\/(?:assistant|schedule|reminders|project|reports|library|tools)(?:[/?][^\s<>。，；！？、）]*)?|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>。，；！？、）]*)?/gi;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    if (at > start) pieces.push({ text: text.slice(start, at) });
    let raw = (match[2] || match[0]).replace(/[。，；！？、）.,;!?:]+$/u, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0, -1);
    }
    const bare = !match[1] && domain.test(raw);
    const before = text[at - 1] || '', after = text[at + match[0].length] || '';
    const embedded = bare && (/[\p{L}\p{N}_@:/\\.-]/u.test(before) || /[\p{L}\p{N}_@-]/u.test(after));
    const href = embedded ? null : noteHref(raw, origin);
    pieces.push(href ? { text: match[1] || raw, href } : { text: match[0] });
    if (href && !match[1] && raw.length < match[0].length) pieces.push({ text: match[0].slice(raw.length) });
    start = at + match[0].length;
  }
  if (start < text.length) pieces.push({ text: text.slice(start) });
  return pieces;
}
