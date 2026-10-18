import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const PRODUCT_HELP_FILES = ['docs/QUICK-START.md', 'docs/USER-GUIDE.md', 'docs/LIBRARY.md', 'docs/ARCHITECTURE.md', 'docs/CHATGPT-WORK-CLOUD.md', 'docs/RELEASE.md', 'docs/DEPLOYMENT-PATHS.md'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
// Permission is attached to a heading, inherited by its children, and defaults to admin.
// Only reviewed user-facing instructions opt in; contracts remain available to administrators.
export function helpSections(raw, source) {
  const withoutCode = raw.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  const stack = [], sections = [];
  let current;
  for (const line of withoutCode.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      current = { title: heading[2].trim(), level, admin: stack.at(-1)?.admin ?? true, lines: [line] };
      stack.push(current); sections.push(current);
      continue;
    }
    if (/^\s*<!--\s*product-help:/.test(line)) {
      const marker = /^\s*<!-- product-help: (user|admin) -->\s*$/.exec(line);
      if (!current || !marker || current.marked || current.lines.slice(1).some(value => value.trim())) throw new Error(`Invalid product-help marker in ${source}`);
      if (marker[1] === 'user' && /(?:RELEASE|DEPLOYMENT-PATHS|ARCHITECTURE|CHATGPT-WORK-CLOUD)\.md$/.test(source)) throw new Error(`Technical contract cannot opt in to user help: ${source}`);
      current.admin = marker[1] !== 'user';
      current.marked = true;
      continue;
    }
    if (current && !/(?:[A-Z]:[\\/]|\/root\/|\/home\/|\/opt\/|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i.test(line)) current.lines.push(line.replace(/<!--.*?-->/g, ''));
  }
  return sections.map(section => ({ title: section.title, admin: section.admin, content: section.lines.join('\n') }));
}
export function buildProductHelp(directory = root) {
  const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
  const chunks = [];
  for (const source of PRODUCT_HELP_FILES) {
    const firstChunk = chunks.length;
    const raw = fs.readFileSync(path.join(directory, source), 'utf8');
    const sections = helpSections(raw, source);
    for (const [index, section] of sections.entries()) {
      for (let offset = 0; offset < section.content.length; offset += 1400) {
        const content = section.content.slice(offset, offset + 1400).trim();
        if (content.length < 30) continue;
        chunks.push({ id: `${source}:${index}:${offset}`, source, title: section.title, content, contentHash: hash(content), sourceHash: hash(raw), admin: section.admin });
      }
    }
    if (chunks.length === firstChunk) throw new Error(`Empty product-help source: ${source}`);
  }
  return { formatVersion: 1, version, chunks };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = buildProductHelp();
  // Keep the index outside the public web root, including behind a static reverse proxy.
  fs.writeFileSync(path.join(root, 'server/.product-help.json'), JSON.stringify(index));
  console.log(`Product help: ${index.chunks.length} chunks for ${index.version}`);
}
