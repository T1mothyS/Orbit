import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helpFiles = new Set(['docs/QUICK-START.md', 'docs/USER-GUIDE.md', 'docs/LIBRARY.md', 'docs/ARCHITECTURE.md', 'docs/CHATGPT-WORK-CLOUD.md', 'docs/RELEASE.md', 'docs/DEPLOYMENT-PATHS.md']);
const test = name => `server/${name}.test.ts`;
// Conservative domain mapping. Unknown inputs escalate; this is not a dependency graph or a result cache.
const domains = [
  { match: /^src\/(?:ui|design|dev)\//, tests: ['ui-lint', 'ui-request-error'], ui: 'gallery' },
  { match: /^src\/(?:features\/(?:settings|help)|layouts\/Settings|utils\/(?:settings-registry|module-settings|navigation-actions))/, tests: ['settings-state', 'module-settings', 'notification-preferences-client', 'system-assistant'], ui: 'app' },
  { match: /^(?:src\/utils\/schedule-(?:time|form-time)|server\/schedule-(?:time|form-time|conflict|actions))\./, tests: ['schedule-time', 'schedule-form-time', 'schedule-conflict', 'schedule-actions'] },
  { match: /^server\/(?:library-|routes\/library\.)/, tests: ['library', 'library-markdown', 'search-service', 'persistence'] },
  { match: /^server\/(?:note-|routes\/notes\.)/, tests: ['note-item', 'note-images', 'note-color-migration', 'note-export', 'note-links', 'composer-draft'] },
  { match: /^server\/(?:digest-|daily-report|routes\/reports-)/, tests: ['daily-report', 'daily-report-api', 'daily-report-cloud-api', 'daily-report-cloud-completeness', 'daily-report-media', 'daily-report-media-prepare', 'digest-v2', 'digest-v2-sources', 'digest-v2-quality', 'digest-v2-photos', 'digest-v2-dns', 'digest-v2-photo-sources', 'digest-research', 'digest-v3-store'] },
  { match: /^server\/(?:reminder-|notification-|routes\/(?:reminders|notifications)\.)/, tests: ['reminder-timing', 'notification-preferences-client', 'notification-scheduler', 'notification-service', 'android-push'] },
  { match: /^server\/(?:caldav-|routes\/caldav\.)/, tests: ['caldav-api', 'caldav-bridge', 'caldav-control', 'caldav-lock'] },
];
const shared = /^(?:package(?:-lock)?\.json$|(?:tsconfig|vite\.config|playwright\.config)|\.github\/|protected-tools\/|project-evolution\/|assets\/|server\/(?:auth\.|db\.|app\.|application\.|index\.|database\/|runtime\/|.*(?:store|migration|backup|persistence|security|password|credential)|routes\/(?:accounts|backups|admin)\.)|src\/(?:hooks\/useAuth|features\/settings\/state\.|utils\/password-policy)|android\/|electron\/|tests\/ui\/(?!.*\.spec\.ts$))/;

export function selectChecks(files, { mode = 'quick', ci = false } = {}) {
  if (!['quick', 'full', 'release'].includes(mode)) throw new Error('Expected quick, full or release');
  const changed = [...new Set(files.map(file => file.replaceAll('\\', '/').replace(/^\.\//, '')))];
  if (changed.some(file => file.startsWith('/') || file.split('/').includes('..'))) throw new Error('Expected repository-relative files');
  const full = reason => ({ mode: mode === 'release' ? 'release' : 'full', reason, changed, typecheck: true, lint: true, build: true, ui: 'all', tests: 'all', docs: true, help: false });
  if (mode !== 'quick' || ci) return full(ci ? 'CI always runs Full or Release' : 'Explicit complete gate');
  if (!changed.length) throw new Error('No changed inputs; pass --base <task-start-SHA> or --files <paths>. No verification was performed.');
  const result = { mode: 'quick', reason: 'Affected checks only', changed, typecheck: false, lint: false, build: false, ui: null, tests: [], docs: false, help: false };
  const selected = new Set();
  for (const file of changed) {
    if (shared.test(file)) return full(`Shared or high-risk input: ${file}`);
    if (/\.(md|mdx|txt)$/.test(file) || /^docs\/.*\.html$/.test(file)) { result.docs = true; if (helpFiles.has(file)) { result.help = true; selected.add(test('system-assistant')); selected.add(test('maintenance-scripts')); } continue; }
    if (/^server\/[^/]+\.test\.ts$/.test(file)) { result.typecheck = true; selected.add(file); continue; }
    if (/^tests\/ui\/[^/]+\.spec\.ts$/.test(file)) { const ui = file.endsWith('gallery.spec.ts') ? 'gallery' : 'app'; result.typecheck = true; result.ui = result.ui && result.ui !== ui ? 'all' : ui; result.build ||= result.ui !== 'gallery'; continue; }
    const domain = domains.find(domain => domain.match.test(file));
    if (!domain) return full(`Unmapped input: ${file}`);
    result.typecheck = true;
    if (file.startsWith('src/')) result.lint = true;
    for (const name of domain.tests) selected.add(test(name));
    if (domain.ui) result.ui = result.ui && result.ui !== domain.ui ? 'all' : domain.ui;
  }
  result.tests = [...selected].sort();
  result.build ||= !!result.ui && result.ui !== 'gallery';
  return result;
}
export function changedFiles(directory, base) {
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const ref = base ? git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim() : 'HEAD';
  return [...new Set([...git(['diff', '--name-only', '-z', ref, '--']).split('\0'), ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))];
}
async function freePreviewPort() {
  const probe = port => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => { const bound = server.address().port; server.close(() => resolve(bound)); });
  });
  const port = await probe(0); if (port >= 65535) throw new Error('No adjacent preview port'); await probe(port + 1); return port;
}
export async function verificationMain(args = process.argv.slice(2)) {
  let mode = 'quick', base, explicit, list = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode') mode = args[++i];
    else if (args[i] === '--base') base = args[++i];
    else if (args[i] === '--list') list = true;
    else if (args[i] === '--files') { explicit = []; while (i + 1 < args.length && !args[i + 1].startsWith('--')) explicit.push(args[++i]); }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const files = explicit || changedFiles(root, base);
  if (explicit?.some(file => !fs.existsSync(path.join(root, file)))) throw new Error('Explicit input does not exist; use --base to include deletions');
  const deletedCode = !explicit && files.some(file => !/\.(?:md|mdx|txt)$/.test(file) && !fs.existsSync(path.join(root, file)));
  const selection = selectChecks(files, { mode: mode === 'quick' && deletedCode ? 'full' : mode, ci: !!process.env.CI });
  if (list) { console.log(JSON.stringify(selection, null, 2)); return; }
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-verify-'));
  const report = { ...selection, explicitScope: !!explicit, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, startedAt: new Date().toISOString(), output, steps: [] };
  console.log(`${selection.mode.toUpperCase()}: ${selection.reason}${explicit ? ' (--files is an explicit development scope)' : ''}`);
  const run = (name, executable, parameters, extra = {}) => {
    const started = performance.now();
    const child = spawnSync(executable, parameters, { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, env: { ...process.env, ...extra } });
    const log = path.join(output, `${name}.log`); fs.writeFileSync(log, (child.stdout || '') + (child.stderr || '') + (child.error ? String(child.error) : ''));
    const step = { name, seconds: (performance.now() - started) / 1000, exit: child.status ?? 1, log };
    report.steps.push(step); console.log(`${name}: ${step.exit ? 'FAILED' : 'passed'} (${step.seconds.toFixed(2)}s)`);
    if (step.exit) throw new Error(`${name} failed. See ${log}`);
    return child.stdout || '';
  };
  // Invoke npm's JavaScript entry point to avoid shell interpolation and .cmd portability issues.
  const npmCli = process.env.npm_execpath;
  const npm = name => { if (!npmCli) throw new Error('Run verification through npm run verify:*'); return run(name.replaceAll(':', '-'), process.execPath, [npmCli, 'run', name], name === 'build' ? { ELECTRON_APP_URL: process.env.ELECTRON_APP_URL || 'https://build.invalid.local' } : {}); };
  const node = (name, parameters, extra) => run(name, process.execPath, parameters, extra);
  try {
    if (selection.typecheck) npm('typecheck');
    if (selection.lint) npm('ui:lint');
    if (selection.build) npm('build'); // tools/evolution/help run here once, not as parallel duplicate steps.
    else if (selection.help) node('product-help', ['scripts/build-product-help.mjs']);
    if (selection.tests === 'all' || selection.tests.length) {
      const tests = selection.tests === 'all' ? fs.readdirSync(path.join(root, 'server')).filter(file => file.endsWith('.test.ts')).map(file => `server/${file}`) : selection.tests;
      node('service', ['--import', 'tsx', '--test', ...tests]);
    }
    if (selection.ui) node('playwright', ['node_modules/@playwright/test/cli.js', 'test', '--reporter=json'], { ORBIT_UI_SCOPE: selection.ui, ORBIT_UI_QA_DIR: path.join(output, 'ui') });
    if (selection.build) node('gallery-exclusion', ['scripts/verify-ui-build.mjs']);
    if (selection.docs) node('docs', ['scripts/docs-check.mjs', ...(selection.build || selection.help ? ['--generated'] : [])]);
    if (selection.mode === 'release') {
      // Fresh service/database per mutating suite. Reuse code, not credentials or business state.
      for (const script of ['mobile-compact-browser-smoke.cjs', 'native-dialog-browser-smoke.cjs']) {
        const port = await freePreviewPort(), started = performance.now();
        const previewLog = fs.createWriteStream(path.join(output, `${script}-preview.log`));
        const preview = spawn(process.execPath, ['--import', 'tsx', 'scripts/orbit-ui-preview.ts', String(port), '--iteration', '--browser-audit'], { cwd: root, env: { ...process.env, ORBIT_UI_AUDIT_SYNTHETIC: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Synthetic preview startup timed out')), 60000);
            preview.once('error', error => { clearTimeout(timer); reject(error); });
            preview.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic preview exited: ${code}`)); });
            preview.stdout.on('data', bytes => { previewLog.write(bytes); if (bytes.toString().includes('Synthetic browser audit:')) { clearTimeout(timer); resolve(); } });
            preview.stderr.on('data', bytes => previewLog.write(bytes));
          });
          report.steps.push({ name: `${script}-startup`, seconds: (performance.now() - started) / 1000, exit: 0 });
          node(script.replace('.cjs', ''), [`scripts/${script}`], { ORBIT_UI_AUDIT_SYNTHETIC: 'true', ORBIT_PREVIEW_URL: `http://127.0.0.1:${port}`, ORBIT_AUDIT_URL: `http://127.0.0.1:${port + 1}`, ORBIT_UI_QA_DIR: path.join(output, script.replace('.cjs', '')) });
        } finally {
          if (preview.exitCode === null) { const stopped = new Promise(resolve => preview.once('exit', resolve)); preview.kill('SIGTERM'); await stopped; }
          previewLog.end();
        }
      }
    }
    run('diff', 'git', ['diff', '--check', 'HEAD']); // Include staged as well as unstaged changes.
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; throw error; }
  finally { report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(`Evidence: ${path.join(output, 'result.json')}`); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verificationMain().catch(error => { console.error(error.message); process.exitCode = 1; });
