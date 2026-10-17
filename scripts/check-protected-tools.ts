import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readToolsManifest } from '../server/protected-tools.js';

const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function toolFiles(root: string, relative = ''): string[] {
  const directory = path.join(root, relative);
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Tools 不允许符号链接');
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) throw new Error(`Tools 不允许链接或隐藏文件: ${entry.name}`);
    const filename = path.join(relative, entry.name);
    if (entry.isDirectory()) return toolFiles(root, filename);
    if (!entry.isFile()) throw new Error(`Tools 文件类型无效: ${filename}`);
    return [filename.replace(/\\/g, '/')];
  });
}
export function checkProtectedTools(sourceRoot: string, packageRoot = sourceRoot) {
  const manifest = readToolsManifest(sourceRoot);
  if (hash(path.join(sourceRoot, 'manifest.json')) !== hash(path.join(packageRoot, 'manifest.json'))) throw new Error('Tools 发布包清单与源码不一致');
  return manifest.tools.filter(t => t.enabled).map(tool => {
    const source = path.join(sourceRoot, tool.slug);
    const packaged = path.join(packageRoot, tool.slug);
    const filenames = toolFiles(source);
    if (!filenames.includes('index.html')) throw new Error(`Tools 缺少入口: ${tool.slug}`);
    if (JSON.stringify(toolFiles(packaged)) !== JSON.stringify(filenames)) throw new Error(`Tools 发布包文件清单不一致: ${tool.slug}`);
    const files = filenames.map(filename => {
      const expected = hash(path.join(source, filename));
      if (hash(path.join(packaged, filename)) !== expected) throw new Error(`Tools 发布包内容不一致: ${tool.slug}/${filename}`);
      return { path: filename, sha256: expected, bytes: fs.statSync(path.join(source, filename)).size };
    });
    return { slug: tool.slug, sha256: files.find(file => file.path === 'index.html')!.sha256, files };
  });
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/check-protected-tools.ts')) {
  const result = checkProtectedTools(path.resolve('protected-tools'), path.resolve(process.argv[2] || 'protected-tools'));
  console.log(JSON.stringify({ tools: result }, null, 2));
}
