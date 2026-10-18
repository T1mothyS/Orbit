import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pkg from '../package.json';
import { searchProductHelp } from './product-help.js';

// These are plain-JavaScript CLIs; exercise the same exported code used by their commands.
const { buildProductHelp, helpSections, PRODUCT_HELP_FILES } = await import(new URL('../scripts/build-product-help.mjs', import.meta.url).href);
const { headingAnchors, markdownLinks, rewriteRelativeLinks, checkDocuments, sha256 } = await import(new URL('../scripts/docs-check.mjs', import.meta.url).href);
const { selectChecks, changedFiles } = await import(new URL('../scripts/verify.mjs', import.meta.url).href);
const { archiveHistory, recoverHistory, historyCheck } = await import(new URL('../scripts/history-maintenance.mjs', import.meta.url).href);
const temporary: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-maintenance-test-')); temporary.push(directory);
  execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'pipe' });
  fs.writeFileSync(path.join(directory, '.gitignore'), '.local-docs/\nCONTINUOUS-REQUIREMENTS.md\n');
  return directory;
}
function write(directory: string, name: string, value: string | Buffer) { const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
test.after(() => { for (const directory of temporary) { assert(directory.startsWith(path.join(os.tmpdir(), 'orbit-maintenance-test-'))); fs.rmSync(directory, { recursive: true, force: true }); } });

test('reviewed user help covers real product questions without exposing technical contracts', () => {
  const index = buildProductHelp();
  assert.equal(index.version, pkg.version); assert.equal(index.formatVersion, 1);
  assert.deepEqual([...new Set(index.chunks.map((chunk: any) => chunk.source))], PRODUCT_HELP_FILES);
  const scenarios = [
    ['如何创建日程和无日期待办', /日程|待办/, /确认|挂起/],
    ['怎么修改密码', /账户|密码/, /重新登录|登录失效/],
    ['提醒与通知在哪里设置', /提醒|通知/, /免打扰|收件邮箱/],
    ['如何查询知识库和管理条目', /知识库/, /阅读|评论|导出|经历/],
    ['怎么修改日报关注行业', /日报|个人资料/, /关注|行业/],
  ] as const;
  for (const [query, title, behavior] of scenarios) {
    const result = searchProductHelp(query, false, index);
    assert.equal(result.status, 'observed', query); assert(result.matches.some((chunk: any) => title.test(chunk.title) && behavior.test(chunk.content)), query);
    assert(title.test(result.matches[0].title), `First match: ${query}`);
    assert(result.matches.every((chunk: any) => !chunk.admin && ['docs/QUICK-START.md', 'docs/USER-GUIDE.md', 'docs/LIBRARY.md'].includes(chunk.source)));
  }
  for (const chunk of index.chunks) {
    assert.equal(chunk.contentHash, sha256(chunk.content));
    assert.equal(chunk.sourceHash, sha256(fs.readFileSync(chunk.source, 'utf8')));
    assert.doesNotMatch(chunk.content, /<!-- product-help:/);
    if (!chunk.admin) assert.doesNotMatch(chunk.content, /JWT_SECRET|SMTP_PASS|\/api\/|DIGEST_|\.db\b|server\//);
  }
  const admin = searchProductHelp('产品助手与受控运行诊断', true, index);
  assert(admin.matches.some((chunk: any) => chunk.source === 'docs/ARCHITECTURE.md' && chunk.admin));
  assert(!searchProductHelp('产品助手与受控运行诊断', false, index).matches.some((chunk: any) => chunk.source === 'docs/ARCHITECTURE.md'));
});

test('help markers inherit only within a heading tree, reject ambiguous metadata, and ignore examples', () => {
  const raw = '# Internal\n\n## User\n<!-- product-help: user -->\nUser instructions retained.\n### Child\nChild instructions retained.\n## Internal sibling\nPrivate instructions retained.\n```md\n## Fake\n<!-- product-help: user -->\n```\n';
  const sections = helpSections(raw, 'docs/USER-GUIDE.md');
  assert.deepEqual(sections.map((section: any) => [section.title, section.admin]), [['Internal', true], ['User', false], ['Child', false], ['Internal sibling', true]]);
  assert.throws(() => helpSections('# A\n<!-- product-help: everyone -->', 'docs/USER-GUIDE.md'));
  assert.throws(() => helpSections('# A\nbody\n<!-- product-help: user -->', 'docs/USER-GUIDE.md'));
  assert.throws(() => helpSections('# A\n<!-- product-help: user -->\n<!-- product-help: admin -->', 'docs/USER-GUIDE.md'));
  assert.throws(() => helpSections('# A\n<!-- product-help: user -->', 'docs/ARCHITECTURE.md'));
});

test('Markdown checks understand unicode/duplicate anchors, directory links and reversible moved links', () => {
  const anchors = headingAnchors('# 中文 `API`\n## 重复\n## 重复\n```md\n# Hidden\n```');
  assert(anchors.has('中文-api')); assert(anchors.has('重复-1')); assert(!anchors.has('hidden'));
  const text = '[one](docs/guide.md#中文) [two](<assets/a(b).png>)\n[ref]: docs/guide.md\n```md\n[ignored](missing.md)\n```\n';
  assert.equal(markdownLinks(text).length, 3);
  assert.equal(rewriteRelativeLinks(rewriteRelativeLinks(text, 'README.md', 'docs/archive/log.md'), 'docs/archive/log.md', 'README.md'), text);
  const directory = fixture();
  write(directory, 'package.json', JSON.stringify({ version: pkg.version }));
  for (const file of PRODUCT_HELP_FILES) write(directory, file, '# Help\n\nA documented behavior with enough text for an index chunk.\n');
  write(directory, 'README.md', '[directory](docs/) [missing](docs/USER-GUIDE.md#不存在)');
  const result = checkDocuments(directory);
  assert(result.errors.some((message: string) => message.includes('Missing anchor')));
  assert(!result.errors.some((message: string) => message.includes('Missing link')));
  write(directory, 'docs/QUICK-START.md', '# Empty\n');
  assert.throws(() => buildProductHelp(directory), /Empty product-help source/);
  assert.throws(() => { fs.unlinkSync(path.join(directory, 'docs/QUICK-START.md')); checkDocuments(directory); });
});

test('Quick selects affected checks, combines browser scopes and never downgrades CI or shared changes', () => {
  const docs = selectChecks(['route.md']); assert.equal(docs.mode, 'quick'); assert.equal(docs.build, false); assert.deepEqual(docs.tests, []);
  const help = selectChecks(['docs/USER-GUIDE.md']); assert(help.help); assert.equal(help.build, false); assert(help.tests.includes('server/system-assistant.test.ts'));
  const gallery = selectChecks(['src/ui/Button.tsx']); assert.equal(gallery.ui, 'gallery'); assert.equal(gallery.build, false);
  const app = selectChecks(['src/features/settings/sections/DailyReportSettings.tsx']); assert.equal(app.ui, 'app'); assert(app.build);
  for (const files of [['src/ui/Button.tsx', 'src/features/settings/sections/DailyReportSettings.tsx'], ['tests/ui/account.spec.ts', 'tests/ui/gallery.spec.ts']]) assert.equal(selectChecks(files).ui, 'all');
  for (const input of ['package-lock.json', 'server/database/connection.ts', 'server/auth.ts', 'src/hooks/useAuth.ts', 'unmapped-new-module.ts', 'android/app/build.gradle.kts', 'docs/digest-v3-d08-oracle.json', 'protected-tools/tool/VERSION.txt']) assert.equal(selectChecks([input]).mode, 'full', input);
  assert.equal(selectChecks(['route.md'], { ci: true }).mode, 'full'); assert.equal(selectChecks([], { mode: 'release' }).mode, 'release');
  assert.throws(() => selectChecks([])); assert.throws(() => selectChecks(['../private']));
});

test('impact collection includes staged, unstaged and untracked files and rejects an invalid base', () => {
  const directory = fixture(); write(directory, 'tracked.md', 'before');
  execFileSync('git', ['add', 'tracked.md'], { cwd: directory });
  execFileSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: directory });
  const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  write(directory, 'staged.md', 'staged'); execFileSync('git', ['add', 'staged.md'], { cwd: directory });
  write(directory, 'tracked.md', 'changed'); write(directory, 'untracked.md', 'new');
  assert.deepEqual(changedFiles(directory, baseline).sort(), ['.gitignore', 'staged.md', 'tracked.md', 'untracked.md']);
  assert.throws(() => changedFiles(directory, '--not-a-ref'));
});

const now = new Date('2026-10-18T04:00:00Z');
function historyFixture() {
  const directory = fixture();
  const original = Buffer.from('\ufeff# Local history\r\n\r\n## 2026-08\r\n### 2026-08-17 task one\r\n原始记录，不改写。\r\n### 2026-08-31 task two\nSecond record\n## 2026-09\n### 2026-09-01 keep entire month\nRecent history\n## 2026-10-18 current task\n<!-- task: running -->\n');
  write(directory, 'CONTINUOUS-REQUIREMENTS.md', original);
  return { directory, original };
}
test('monthly archival preserves original bytes, order, backup and recent/in-progress records; reapply is a no-op', () => {
  const { directory, original } = historyFixture();
  const preview = archiveHistory(directory, { now }); assert.equal(preview.continuous[0].records, 2);
  assert(fs.readFileSync(path.join(directory, 'CONTINUOUS-REQUIREMENTS.md')).equals(original));
  archiveHistory(directory, { now, apply: true });
  const state = JSON.parse(fs.readFileSync(path.join(directory, '.local-docs/history/state.json'), 'utf8'));
  const volume = state.continuous.volumes[0];
  const payload = fs.readFileSync(path.join(directory, volume.file)).subarray(volume.payloadOffset);
  const first = original.indexOf(Buffer.from('## 2026-08')), last = original.indexOf(Buffer.from('## 2026-09'));
  assert(payload.equals(original.subarray(first, last))); assert.equal(sha256(payload), volume.payloadHash);
  const active = fs.readFileSync(path.join(directory, 'CONTINUOUS-REQUIREMENTS.md'));
  assert(active.includes(Buffer.from('2026-09-01'))); assert(active.includes(Buffer.from('<!-- task: running -->'))); assert.equal(active[0], 0xef);
  const backupRoot = path.join(directory, '.local-docs/history/backups');
  assert(fs.readdirSync(backupRoot).some(name => fs.readdirSync(path.join(backupRoot, name)).some(file => file.endsWith('.original') && fs.readFileSync(path.join(backupRoot, name, file)).equals(original))));
  assert.deepEqual(archiveHistory(directory, { now, apply: true }).files, []);
  assert.equal(historyCheck(directory, now).continuous.scanDue, false);
});

test('archive failure can restore the entire original stream and retry; external edits block recovery', () => {
  const { directory, original } = historyFixture();
  assert.throws(() => archiveHistory(directory, { now, apply: true, afterInstall: () => { throw new Error('synthetic interruption'); } }));
  assert(historyCheck(directory, now).pendingRecovery); assert.throws(() => archiveHistory(directory, { now, apply: true }));
  assert(recoverHistory(directory).recovered); assert(fs.readFileSync(path.join(directory, 'CONTINUOUS-REQUIREMENTS.md')).equals(original));
  assert(!fs.existsSync(path.join(directory, '.local-docs/continuous/2026-08.md')));
  archiveHistory(directory, { now, apply: true }); assert.deepEqual(archiveHistory(directory, { now, apply: true }).files, []);
  const conflicting = historyFixture();
  assert.throws(() => archiveHistory(conflicting.directory, { now, apply: true, afterInstall: () => { fs.appendFileSync(path.join(conflicting.directory, 'CONTINUOUS-REQUIREMENTS.md'), '\nexternal edit'); throw new Error('stop'); } }));
  assert.throws(() => recoverHistory(conflicting.directory), /External modification/);
  assert(fs.readFileSync(path.join(conflicting.directory, 'CONTINUOUS-REQUIREMENTS.md'), 'utf8').endsWith('external edit'));
});

test('ambiguous dates, duplicate volumes, modified archives and missing ignore protection fail safely', () => {
  const unsorted = historyFixture(); write(unsorted.directory, 'CONTINUOUS-REQUIREMENTS.md', '# H\n## 2026-09-01 x\n## 2026-08-01 y\n');
  assert.throws(() => archiveHistory(unsorted.directory, { now, apply: true }), /out of order/);
  const undated = historyFixture(); write(undated.directory, 'CONTINUOUS-REQUIREMENTS.md', '# H\n## 2026-08-01 x\n## Unknown task date\noriginal\n## 2026-10-18 keep\n');
  assert.throws(() => archiveHistory(undated.directory, { now, apply: true }), /Undated record boundary/);
  const running = historyFixture(); write(running.directory, 'CONTINUOUS-REQUIREMENTS.md', '# H\n## 2026-08-01 x\n<!-- task: running -->\n## 2026-10-18 keep\n');
  assert.throws(() => archiveHistory(running.directory, { now, apply: true }), /unfinished task/);
  const duplicate = historyFixture(); write(duplicate.directory, '.local-docs/continuous/2026-08.md', 'existing material');
  assert.throws(() => archiveHistory(duplicate.directory, { now, apply: true }), /already exists/);
  const modified = historyFixture(); archiveHistory(modified.directory, { now, apply: true }); fs.appendFileSync(path.join(modified.directory, '.local-docs/continuous/2026-08.md'), 'changed');
  assert.throws(() => archiveHistory(modified.directory, { now, apply: true, forceScan: true }), /archive changed/);
  const invalid = historyFixture(); archiveHistory(invalid.directory, { now, apply: true });
  const statePath = path.join(invalid.directory, '.local-docs/history/state.json'), state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.continuous.volumes[0].file = '../private-config'; fs.writeFileSync(statePath, JSON.stringify(state));
  assert.throws(() => archiveHistory(invalid.directory, { now, apply: true, forceScan: true }), /Invalid local volume/);
  const unprotected = historyFixture(); write(unprotected.directory, '.gitignore', '');
  assert.throws(() => archiveHistory(unprotected.directory, { now, apply: true }));
});

test('changelog rolls complete batches to 20 versions, preserves old text/links and is idempotent', () => {
  const directory = fixture();
  const versions = Array.from({ length: 27 }, (_, i) => `## 0.1.${27 - i}-261018.${String(27 - i).padStart(4, '0')}\r\n\r\n原始结论 ${i} [evidence](docs/TEST-MATRIX.md#中文)\r\n\r\n`).join('');
  write(directory, 'CHANGELOG.md', '# Changes\r\n\r\n' + versions);
  const result = archiveHistory(directory, { now, apply: true }); assert.equal(result.archivedVersions, 7);
  const active = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8'); assert.equal([...active.matchAll(/^## /gm)].length, 20);
  assert(active.endsWith('\n')); assert(!active.endsWith('\n\n'));
  const archive = fs.readFileSync(path.join(directory, 'docs/archive/changelog/CHANGELOG-2026-10.md'), 'utf8').split('<!-- history-payload:start -->\n')[1];
  assert.equal(rewriteRelativeLinks(archive, 'docs/archive/changelog/CHANGELOG-2026-10.md', 'CHANGELOG.md'), versions.slice(versions.indexOf('## 0.1.7-')));
  assert.deepEqual(archiveHistory(directory, { now, apply: true }).files, []);
});
