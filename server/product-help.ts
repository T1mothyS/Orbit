import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json';
export interface ProductHelpChunk { id: string; source: string; title: string; content: string; contentHash: string; sourceHash: string; admin: boolean }
export interface ProductHelpIndex { formatVersion: number; version: string; chunks: ProductHelpChunk[] }
export function searchProductHelp(query: string, admin = false, supplied?: ProductHelpIndex) {
  if (!query.trim() || query.length > 300) throw new Error('产品查询长度须为 1–300 个字符');
  let index: ProductHelpIndex;
  try {
    if (supplied) index = supplied;
    else {
      const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.product-help.json');
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('Invalid product index');
      index = JSON.parse(fs.readFileSync(filename, 'utf8'));
    }
    if (!Array.isArray(index?.chunks)) throw new Error('Invalid product index');
  }
  catch { return { domain: 'product', status: 'unobserved', version: pkg.version, matches: [], reason: '产品帮助索引尚未构建' }; }
  if (index.version !== pkg.version || index.formatVersion !== 1) return { domain: 'product', status: 'unobserved', version: pkg.version, matches: [], reason: '产品帮助索引与应用版本不匹配' };
  const normal = query.toLowerCase();
  const words = new Set([...normal.matchAll(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g)].flatMap(m => /^[a-z0-9_]+$/.test(m[0]) ? [m[0]] : Array.from({ length: m[0].length - 1 }, (_, i) => m[0].slice(i, i + 2))));
  const matches = index.chunks.filter(c => admin || !c.admin).map(c => ({ c, score: [...words].reduce((sum, word) => sum + (c.title.toLowerCase().includes(word) ? 4 : c.content.toLowerCase().includes(word) ? 1 : 0), 0) }))
    .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ c }) => ({ ...c, content: c.content.slice(0, 1400) }));
  return { domain: 'product', status: matches.length ? 'observed' : 'no_match', observedAt: new Date().toISOString(), version: index.version, matches };
}
