import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildProductHelp, PRODUCT_HELP_FILES } from './build-product-help.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
export function repositoryFiles(directory) {
  return [...new Set(git(directory, ['-c', 'core.quotepath=false', 'ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
}
export function documentFiles(directory) {
  return repositoryFiles(directory).filter(file => /\.(md|mdx|markdown|rst|adoc|txt)$/i.test(file) || /^docs\/.*\.html$/i.test(file));
}
export function headingAnchors(text) {
  const anchors = new Set(), counts = new Map();
  for (const match of text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '').matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = match[1].trim().toLowerCase().replace(/<[^>]*>/g, '').replace(/[\p{P}\p{S}]/gu, c => c === '-' || c === '_' ? c : '').replace(/\s/g, '-');
    const count = counts.get(slug) || 0; counts.set(slug, count + 1); anchors.add(slug + (count ? `-${count}` : ''));
  }
  for (const match of text.matchAll(/(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
  return anchors;
}
/** Destinations and offsets, retaining the original bytes outside link targets. */
export function markdownLinks(text) {
  const masked = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, value => value.replace(/[^\n\r]/g, ' '));
  const links = [];
  for (const match of masked.matchAll(/\]\(\s*(<?)/g)) {
    const start = match.index + match[0].length;
    let end = start, depth = 0;
    while (end < masked.length) {
      const char = masked[end];
      if (match[1] === '<' ? char === '>' : (char === ')' && depth === 0) || (/\s/.test(char) && depth === 0)) break;
      if (char === '(') depth++; if (char === ')') depth--;
      if (char === '\n') break;
      end++;
    }
    if (end > start) links.push({ target: text.slice(start, end), start, end });
  }
  for (const match of masked.matchAll(/^\s*\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)) {
    const start = match.index + match[0].indexOf(match[1]);
    links.push({ target: match[1], start, end: start + match[1].length });
  }
  return links.sort((a, b) => a.start - b.start);
}
export function rewriteRelativeLinks(text, from, to) {
  for (const link of markdownLinks(text).reverse()) {
    if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(link.target)) continue;
    const [file, ...fragment] = link.target.split('#');
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), file));
    const relative = path.posix.relative(path.posix.dirname(to), target) + (fragment.length ? '#' + fragment.join('#') : '');
    text = text.slice(0, link.start) + relative + text.slice(link.end);
  }
  return text;
}
export function checkDocuments(directory = root, { generated = false, inventory = false } = {}) {
  const files = repositoryFiles(directory), documents = documentFiles(directory);
  const errors = [], warnings = [], inbound = new Map(documents.map(file => [file, new Set()]));
  const sourceReaders = new Map(documents.map(file => [file, []]));
  let links = 0;
  for (const file of files.filter(file => /\.(?:mjs|cjs|ts|tsx|json|yml|yaml|ps1|sh|py)$/.test(file) && !file.startsWith('docs/'))) {
    if (!fs.existsSync(path.join(directory, file))) continue;
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const doc of documents) if (text.includes(doc)) sourceReaders.get(doc).push(file);
  }
  for (const file of documents.filter(file => file.endsWith('.md'))) {
    if (!fs.existsSync(path.join(directory, file))) { errors.push(`Missing indexed document: ${file}`); continue; }
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) errors.push(`Private-key material: ${file}`);
    for (const link of markdownLinks(text)) {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link.target)) continue;
      if (link.target.startsWith('/')) continue; // Product routes, not repository paths.
      let [relative, fragment] = link.target.split('#');
      try { relative = decodeURIComponent(relative); fragment = fragment ? decodeURIComponent(fragment) : ''; }
      catch { errors.push(`Invalid link encoding: ${file}`); continue; }
      const target = relative ? path.posix.normalize(path.posix.join(path.posix.dirname(file), relative)) : file;
      if (target === '..' || target.startsWith('../')) { errors.push(`Link escapes repository: ${file} -> ${link.target}`); continue; }
      links++;
      if (inbound.has(target)) inbound.get(target).add(file);
      if (!fs.existsSync(path.join(directory, target))) { errors.push(`Missing link: ${file} -> ${link.target}`); continue; }
      if (fragment && target.endsWith('.md') && !headingAnchors(fs.readFileSync(path.join(directory, target), 'utf8')).has(fragment)) errors.push(`Missing anchor: ${file} -> ${link.target}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  for (const file of documents.filter(file => file.endsWith('.md') && !file.startsWith('docs/archive/'))) {
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const command of text.matchAll(/\bnpm run ([a-z0-9][\w:*.-]*)/g)) if (!command[1].includes('*') && !pkg.scripts?.[command[1]]) errors.push(`Unknown npm command: ${file} -> ${command[1]}`);
    if (/[A-Z]:[\\/]Users[\\/](?!<|%|\$)[\w.-]+[\\/]/i.test(text)) errors.push(`Personal absolute path in current documentation: ${file}`);
  }
  const lockFile = path.join(directory, 'package-lock.json');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) errors.push('package.json/lock versions disagree');
  }
  const help = buildProductHelp(directory);
  for (const source of PRODUCT_HELP_FILES) if (!help.chunks.some(chunk => chunk.source === source)) errors.push(`Empty product-help source: ${source}`);
  for (const chunk of help.chunks) if (sha256(chunk.content) !== chunk.contentHash || sha256(fs.readFileSync(path.join(directory, chunk.source), 'utf8')) !== chunk.sourceHash) errors.push(`Invalid product-help hash: ${chunk.source}`);
  if (generated) {
    const filename = path.join(directory, 'server/.product-help.json');
    if (!fs.existsSync(filename) || fs.readFileSync(filename, 'utf8') !== JSON.stringify(help)) errors.push('Generated product help missing/stale; rebuild it');
  }
  const rows = inventory ? documents.filter(file => fs.existsSync(path.join(directory, file))).map(file => {
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    let updated = null; try { updated = git(directory, ['log', '-1', '--format=%cs', '--', file]).trim() || null; } catch { /* New file. */ }
    return { file, bytes: Buffer.byteLength(text), lines: text.split(/\r?\n/).length, updated,
      category: file.startsWith('docs/archive/') ? 'historical' : /(?:AGENTS)/.test(file) ? 'agent' : /(?:TASKS|FRONTEND-DEBT)/.test(file) ? 'status' : /(?:route|ROADMAP)/.test(file) ? 'roadmap' : /(?:CHANGELOG)/.test(file) ? 'versions' : /(?:CONTRACT|ARCHITECTURE|CLOUD|LIBRARY|CALDAV-BRIDGE|DATA-GUIDE)/.test(file) ? 'contract' : 'guide/resource',
      inbound: [...inbound.get(file)], consumers: sourceReaders.get(file), title: /^# (.+)$/m.exec(text)?.[1] || null };
  }) : undefined;
  return { documents: documents.length, links, helpChunks: help.chunks.length, errors, warnings, ...(rows ? { inventory: rows } : {}) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkDocuments(root, { generated: process.argv.includes('--generated'), inventory: process.argv.includes('--inventory') });
    if (result.inventory) console.log(JSON.stringify(result, null, 2));
    else { console.log(`Docs: ${result.documents} files, ${result.links} links, ${result.helpChunks} help chunks`); for (const issue of result.errors) console.error(issue); }
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
