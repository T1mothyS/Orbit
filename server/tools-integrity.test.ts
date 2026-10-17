import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProtectedTools } from '../scripts/check-protected-tools.js';
test('all enabled source Tools ship unchanged; missing or mismatched package fails', () => {
  const root = path.resolve('protected-tools');
  const result = checkProtectedTools(root);
  assert(result.some(t => t.slug === 'codex-usage-dashboard-v3-1'));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-package-'));
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(stage, 'manifest.json'));
  try {
    for (const tool of result) for (const file of tool.files) {
      const target = path.join(stage, tool.slug, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, tool.slug, file.path), target);
    }
    assert.deepEqual(checkProtectedTools(root, stage), result);
    const target = path.join(stage, result[0].slug, 'index.html');
    fs.writeFileSync(target, 'different'); assert.throws(() => checkProtectedTools(root, stage), /不一致/);
    fs.unlinkSync(target); assert.throws(() => checkProtectedTools(root, stage));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
});

test('Tools integrity rejects missing, changed and unexpected nested assets', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-assets-'));
  const source = path.join(temporary, 'source'), stage = path.join(temporary, 'stage');
  try {
    fs.mkdirSync(path.join(source, 'toy', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ version: 1, tools: [{ slug: 'toy', title: 'Toy', summary: 'Fixture' }] }));
    fs.writeFileSync(path.join(source, 'toy', 'index.html'), '<video src="assets/clip.mp4"></video>');
    fs.writeFileSync(path.join(source, 'toy', 'assets', 'clip.mp4'), 'synthetic video');
    fs.mkdirSync(path.join(stage, 'toy', 'assets'), { recursive: true });
    for (const filename of ['manifest.json', 'toy/index.html', 'toy/assets/clip.mp4']) fs.copyFileSync(path.join(source, filename), path.join(stage, filename));
    assert.equal(checkProtectedTools(source, stage)[0].files.length, 2);
    const asset = path.join(stage, 'toy', 'assets', 'clip.mp4');
    fs.writeFileSync(asset, 'changed video');
    assert.throws(() => checkProtectedTools(source, stage), /内容不一致/);
    fs.unlinkSync(asset);
    assert.throws(() => checkProtectedTools(source, stage), /文件清单不一致/);
    fs.copyFileSync(path.join(source, 'toy', 'assets', 'clip.mp4'), asset);
    fs.writeFileSync(path.join(stage, 'toy', 'extra.js'), 'unexpected');
    assert.throws(() => checkProtectedTools(source, stage), /文件清单不一致/);
    fs.writeFileSync(path.join(source, 'toy', '.env'), 'synthetic');
    assert.throws(() => checkProtectedTools(source), /隐藏文件/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
