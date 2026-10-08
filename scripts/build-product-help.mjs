import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const PRODUCT_HELP_FILES = ['docs/USER-GUIDE.md', 'docs/LIBRARY.md', 'docs/ARCHITECTURE.md', 'docs/CHATGPT-WORK-CLOUD.md', 'docs/RELEASE.md', 'docs/DEPLOYMENT-PATHS.md'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
export function buildProductHelp(directory = root) {
  const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
  const chunks = [];
  for (const source of PRODUCT_HELP_FILES) {
    const raw = fs.readFileSync(path.join(directory, source), 'utf8');
    // Publish only documented product behavior. Code examples and machine-specific lines are not help material.
    const text = raw.replace(/```[\s\S]*?```/g, '').split(/\r?\n/).filter(line => !/(?:[A-Z]:[\\/]|\/root\/|\/home\/|\/opt\/|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i.test(line)).join('\n');
    const sections = text.split(/(?=^#{1,4} )/m);
    for (const [index, section] of sections.entries()) {
      const title = section.split('\n')[0].replace(/^#+\s*/, '').trim();
      for (let offset = 0; offset < section.length; offset += 1400) {
        const content = section.slice(offset, offset + 1400).trim();
        if (content.length < 30) continue;
        chunks.push({ id: `${source}:${index}:${offset}`, source, title, content, contentHash: hash(content), sourceHash: hash(raw), admin: /(?:RELEASE|DEPLOYMENT-PATHS)/.test(source) });
      }
    }
  }
  return { formatVersion: 1, version, chunks };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = buildProductHelp();
  // Keep the index outside the public web root, including behind a static reverse proxy.
  fs.writeFileSync(path.join(root, 'server/.product-help.json'), JSON.stringify(index));
  console.log(`Product help: ${index.chunks.length} chunks for ${index.version}`);
}
