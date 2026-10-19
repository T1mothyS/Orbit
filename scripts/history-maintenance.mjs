import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, rewriteRelativeLinks } from './docs-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = '.local-docs/history';
const stateFile = `${local}/state.json`, journalFile = `${local}/pending.json`;
const indexStart = '<!-- history-index:start -->', indexEnd = '<!-- history-index:end -->';
const payloadStart = '<!-- history-payload:start -->\n';
const read = (directory, file) => fs.readFileSync(path.join(directory, file));
const exists = (directory, file) => fs.existsSync(path.join(directory, file));
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const today = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const hashFile = (directory, file) => exists(directory, file) ? sha256(read(directory, file)) : null;
function assertTarget(directory, file) {
  if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !/^(?:CONTINUOUS-REQUIREMENTS\.md$|CHANGELOG\.md$|docs\/archive\/changelog\/[\w.-]+\.md$|\.local-docs\/)/.test(file)) throw new Error(`Unsafe archive target: ${file}`);
  let cursor = path.resolve(directory);
  for (const part of file.split('/')) { cursor = path.join(cursor, part); if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Archive symlinks are not allowed'); }
}
function assertPrivate(directory) {
  for (const file of ['CONTINUOUS-REQUIREMENTS.md', `${local}/state.json`, '.local-docs/continuous/example.md']) {
    execFileSync('git', ['check-ignore', '--quiet', '--', file], { cwd: directory, stdio: 'pipe' });
    if (execFileSync('git', ['ls-files', '--', file], { cwd: directory, encoding: 'utf8' }).trim()) throw new Error(`Private history is tracked: ${file}`);
  }
}
function stripIndex(buffer) {
  const start = buffer.indexOf(indexStart), end = buffer.indexOf(indexEnd);
  if (start < 0 && end < 0) return buffer;
  if (start < 0 || end < start || buffer.indexOf(indexStart, start + 1) >= 0) throw new Error('Invalid history index');
  let finish = end + Buffer.byteLength(indexEnd);
  if (buffer[finish] === 13) finish++; if (buffer[finish] === 10) finish++;
  return Buffer.concat([buffer.subarray(0, start), buffer.subarray(finish)]);
}
function headings(buffer) {
  const found = []; found.ambiguous = []; let start = 0, fence = null;
  while (start < buffer.length) {
    const newline = buffer.indexOf(10, start), end = newline < 0 ? buffer.length : newline + 1;
    const line = buffer.subarray(start, end).toString('utf8').trimEnd();
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delimiter) { fence = fence === delimiter[1][0] ? null : fence || delimiter[1][0]; start = end; continue; }
    if (fence) { start = end; continue; }
    const match = /^#{2,3}\s+(20\d{2})-(\d{2})(?:-(\d{2}))?(?:\D|$)/.exec(line);
    if (match) {
      const month = `${match[1]}-${match[2]}`, day = match[3] ? `${month}-${match[3]}` : null;
      const max = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
      if (Number(match[2]) < 1 || Number(match[2]) > 12 || (day && (Number(match[3]) < 1 || Number(match[3]) > max))) throw new Error('Invalid date in continuous-history heading');
      found.push({ offset: start, month, day, key: day || month + '-00' });
    } else if (found.length && /^#{2,3}\s+/.test(line)) found.ambiguous.push(start);
    start = end;
  }
  if (fence) throw new Error('Unclosed code fence in history; retain and review the original');
  for (let i = 1; i < found.length; i++) if (found[i].key < found[i - 1].key) throw new Error('History headings are out of order; retain and review them manually');
  return found;
}
function continuousPlan(directory, now, state) {
  if (!exists(directory, 'CONTINUOUS-REQUIREMENTS.md')) return { changes: [], state: null, archived: [] };
  const before = read(directory, 'CONTINUOUS-REQUIREMENTS.md'), clean = stripIndex(before), items = headings(clean);
  if (!items.length) throw new Error('Unknown continuous-history format; no records were moved');
  const cutoff = new Date(Date.parse(today(now) + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  let firstKept = 0;
  while (firstKept < items.length && monthEnd(items[firstKept].month) < cutoff) firstKept++;
  const prefix = clean.subarray(0, items[0].offset);
  const boundary = firstKept < items.length ? items[firstKept].offset : clean.length;
  if (items.ambiguous.some(offset => offset < boundary)) throw new Error('Undated record boundary in an eligible month; retain and review the original');
  const kept = clean.subarray(boundary), archived = [], changes = [];
  let index = 0;
  while (index < firstKept) {
    const month = items[index].month, start = items[index].offset; let next = index + 1;
    while (next < firstKept && items[next].month === month) next++;
    const end = next < items.length ? items[next].offset : clean.length, payload = clean.subarray(start, end);
    if (payload.includes(Buffer.from('<!-- task: running -->'))) throw new Error('An unfinished task is marked in an eligible month; no records were moved');
    const file = `.local-docs/continuous/${month}.md`;
    if (exists(directory, file)) throw new Error(`Monthly archive already exists; review before merging: ${file}`);
    const header = Buffer.from(`# Orbit 本地持续记录：${month}\n\n仅供本机审计；正文按原始顺序和字节保存，旧相对路径以仓库根目录解释。\n\n`);
    changes.push({ file, content: Buffer.concat([header, payload]), expectedBefore: null });
    archived.push({ file, month, records: items.slice(index, next).filter(item => item.day).length, payloadOffset: header.length, payloadBytes: payload.length, payloadHash: sha256(payload), firstDate: items.slice(index, next).find(item => item.day)?.day, lastDate: items.slice(index, next).filter(item => item.day).at(-1)?.day });
    index = next;
  }
  // Reassemble the original raw stream before installing any output; no line-ending normalization.
  const reconstruction = Buffer.concat([prefix, ...changes.map((change, i) => change.content.subarray(archived[i].payloadOffset)), kept]);
  if (!reconstruction.equals(clean)) throw new Error('History reconstruction failed');
  const volumes = [...(state.continuous?.volumes || []), ...archived];
  for (const volume of volumes.filter(volume => !archived.includes(volume))) {
    if (!/^\.local-docs\/continuous\/\d{4}-\d{2}\.md$/.test(volume.file) || !Number.isSafeInteger(volume.payloadOffset) || volume.payloadOffset < 0) throw new Error('Invalid local volume metadata');
    assertTarget(directory, volume.file);
    const bytes = read(directory, volume.file).subarray(volume.payloadOffset);
    if (bytes.length !== volume.payloadBytes || sha256(bytes) !== volume.payloadHash) throw new Error(`Existing monthly archive changed: ${volume.file}`);
  }
  const links = volumes.map(volume => `- [${volume.month}](${volume.file})：${volume.firstDate} 至 ${volume.lastDate}，${volume.records} 条日期记录。`).join('\n');
  const generated = volumes.length ? Buffer.from(`${indexStart}\n历史月卷仅按需追溯；活跃文件继续末尾追加，至少保留最近 30 天，整月滚动通常保留约 30–60 天。\n${links}\n${indexEnd}\n`) : Buffer.alloc(0);
  const active = Buffer.concat([prefix, generated, kept]);
  if (!active.equals(before)) changes.push({ file: 'CONTINUOUS-REQUIREMENTS.md', content: active, expectedBefore: sha256(before) });
  return { changes, archived, state: { checkedMonth: today(now).slice(0, 7), checkedBytes: active.length, volumes } };
}
export function changelogPlan(directory, now, force = false) {
  if (!exists(directory, 'CHANGELOG.md')) return { changes: [], archivedVersions: 0 };
  const original = read(directory, 'CHANGELOG.md').toString('utf8');
  const entries = [...original.matchAll(/^## \d+\.\d+\.\d+-\d{6}\.\d{4}\b.*$/gm)];
  if (entries.length < (force ? 21 : 25)) return { changes: [], archivedVersions: 0 };
  const cut = entries[20].index, tail = original.slice(cut), active = original.slice(0, cut);
  const file = `docs/archive/changelog/CHANGELOG-${today(now).slice(0, 7)}.md`;
  const prior = exists(directory, file) ? read(directory, file).toString('utf8') : null;
  const payloadMarkers = prior ? [...prior.matchAll(/<!-- history-payload:start -->\r?\n/g)] : [];
  if (prior && payloadMarkers.length !== 1) throw new Error('Unknown changelog archive format');
  const oldPayload = prior ? prior.slice(payloadMarkers[0].index + payloadMarkers[0][0].length) : '';
  const versions = [...tail.matchAll(/^## (\d+\.\d+\.\d+(?:-\d{6}\.\d{4})?)\b/gm)].map(match => match[1]);
  for (const version of versions) if ([...oldPayload.matchAll(/^## (\d+\.\d+\.\d+(?:-\d{6}\.\d{4})?)\b/gm)].some(match => match[1] === version)) throw new Error(`Duplicate archived version: ${version}`);
  const moved = rewriteRelativeLinks(tail, 'CHANGELOG.md', file);
  if (rewriteRelativeLinks(moved, file, 'CHANGELOG.md') !== tail) throw new Error('Changelog text/link round trip failed');
  const archive = `# Orbit 更新日志归档（${today(now).slice(0, 7)} 归档卷）\n\n按归档月份分卷，记录保留迁移时原顺序；只调整相对链接，不补造日期或改写旧结论。当前版本见 [package.json](../../../package.json)，最新变更见 [CHANGELOG](../../../CHANGELOG.md)。\n\n${payloadStart}${moved}${oldPayload}`;
  const oldIndex = /<!-- changelog-archives:start -->[\s\S]*?<!-- changelog-archives:end -->\r?\n?/g;
  const archiveFiles = new Set([file]);
  for (const match of original.matchAll(/docs\/archive\/changelog\/[\w.-]+\.md/g)) archiveFiles.add(match[0]);
  const navigation = `<!-- changelog-archives:start -->\n历史版本按归档卷查询：${[...archiveFiles].sort().reverse().map(name => `[${path.posix.basename(name, '.md')}](${name})`).join('、')}。常态保留最近 20 条完整版本，阶段内最多 24 条。\n<!-- changelog-archives:end -->\n\n`;
  const cleaned = active.replace(oldIndex, '');
  const insert = /^## /m.exec(cleaned)?.index ?? cleaned.length;
  const current = (cleaned.slice(0, insert) + navigation + cleaned.slice(insert)).replace(/(?:\r?\n)+$/, '') + '\n';
  return { changes: [{ file, content: Buffer.from(archive), expectedBefore: prior ? sha256(Buffer.from(prior)) : null }, { file: 'CHANGELOG.md', content: Buffer.from(current), expectedBefore: sha256(Buffer.from(original)) }], archivedVersions: entries.length - 20 };
}
export function historyCheck(directory = root, now = new Date()) {
  assertPrivate(directory);
  const state = exists(directory, stateFile) ? JSON.parse(read(directory, stateFile)) : {};
  const bytes = exists(directory, 'CONTINUOUS-REQUIREMENTS.md') ? fs.statSync(path.join(directory, 'CONTINUOUS-REQUIREMENTS.md')).size : 0;
  const count = exists(directory, 'CHANGELOG.md') ? [...read(directory, 'CHANGELOG.md').toString('utf8').matchAll(/^## \d+\.\d+\.\d+-\d{6}\.\d{4}\b/gm)].length : 0;
  return { pendingRecovery: exists(directory, journalFile), continuous: { bytes, scanDue: !!bytes && (!state.continuous || state.continuous.checkedMonth !== today(now).slice(0, 7) || (bytes >= 1024 * 1024 && bytes >= state.continuous.checkedBytes + 65536)) }, changelog: { versions: count, archiveDue: count >= 25 } };
}
function applyChanges(directory, changes, afterInstall) {
  if (!changes.length) return;
  if (exists(directory, journalFile)) throw new Error('Pending archive transaction; use --recover before proceeding');
  const transaction = `${local}/backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  fs.mkdirSync(path.join(directory, transaction), { recursive: true });
  const entries = changes.map((change, index) => {
    assertTarget(directory, change.file);
    const before = exists(directory, change.file) ? read(directory, change.file) : null;
    if ((before ? sha256(before) : null) !== change.expectedBefore) throw new Error('Source changed while planning the archive; no outputs were installed');
    const backup = `${transaction}/${index}.original`, staged = `${transaction}/${index}.pending`;
    if (before) fs.writeFileSync(path.join(directory, backup), before, { flag: 'wx' });
    fs.writeFileSync(path.join(directory, staged), change.content, { flag: 'wx' });
    if (sha256(read(directory, staged)) !== sha256(change.content) || (before && sha256(read(directory, backup)) !== sha256(before))) throw new Error('Archive backup/staging verification failed');
    return { file: change.file, backup: before ? backup : null, staged, before: before ? sha256(before) : null, after: sha256(change.content) };
  });
  const journal = { format: 1, transaction, entries };
  fs.writeFileSync(path.join(directory, journalFile), json(journal), { flag: 'wx' }); // Also excludes simultaneous archivers.
  for (const entry of entries) if (hashFile(directory, entry.file) !== entry.before) throw new Error('Source changed before archive installation; recover and retry');
  for (const [index, entry] of entries.entries()) {
    if (hashFile(directory, entry.file) !== entry.before) throw new Error('Source changed during archive installation; recover and review');
    fs.mkdirSync(path.dirname(path.join(directory, entry.file)), { recursive: true });
    fs.renameSync(path.join(directory, entry.staged), path.join(directory, entry.file));
    if (hashFile(directory, entry.file) !== entry.after) throw new Error('Installed archive hash mismatch');
    afterInstall?.(index, entry);
  }
  fs.renameSync(path.join(directory, journalFile), path.join(directory, transaction, 'completed.json'));
}
export function recoverHistory(directory = root) {
  assertPrivate(directory);
  if (!exists(directory, journalFile)) return { recovered: false };
  const journal = JSON.parse(read(directory, journalFile));
  if (journal.format !== 1 || !Array.isArray(journal.entries) || !/^\.local-docs\/history\/backups\/[\w.-]+$/.test(journal.transaction)) throw new Error('Unknown recovery journal');
  for (const entry of journal.entries) {
    if (!entry.staged.startsWith(journal.transaction + '/') || (entry.backup && !entry.backup.startsWith(journal.transaction + '/'))) throw new Error('Invalid backup ownership in recovery journal');
    assertTarget(directory, entry.file); assertTarget(directory, entry.staged); if (entry.backup) assertTarget(directory, entry.backup);
    const current = hashFile(directory, entry.file);
    if (current !== entry.before && current !== entry.after) throw new Error(`External modification blocks recovery: ${entry.file}`);
    if (entry.backup && hashFile(directory, entry.backup) !== entry.before) throw new Error('Recovery backup changed');
  }
  for (const entry of [...journal.entries].reverse()) if (hashFile(directory, entry.file) === entry.after) {
    if (entry.backup) {
      const restore = `${entry.backup}.restore`; fs.copyFileSync(path.join(directory, entry.backup), path.join(directory, restore)); fs.renameSync(path.join(directory, restore), path.join(directory, entry.file));
    } else fs.unlinkSync(path.join(directory, entry.file));
  }
  assertTarget(directory, `${journal.transaction}/recovered.json`);
  fs.renameSync(path.join(directory, journalFile), path.join(directory, journal.transaction, 'recovered.json'));
  return { recovered: true, files: journal.entries.length };
}
export function archiveHistory(directory = root, { now = new Date(), apply = false, forceScan = false, afterInstall } = {}) {
  const check = historyCheck(directory, now);
  if (check.pendingRecovery) throw new Error('Pending archive transaction; use --recover before proceeding');
  const previousBytes = exists(directory, stateFile) ? read(directory, stateFile) : null;
  const previous = previousBytes ? JSON.parse(previousBytes) : {};
  const continuous = check.continuous.scanDue || forceScan ? continuousPlan(directory, now, previous) : { changes: [], archived: [], state: previous.continuous };
  const changelog = changelogPlan(directory, now);
  const changes = [...continuous.changes, ...changelog.changes];
  const state = { format: 1, continuous: continuous.state };
  if (JSON.stringify(state) !== JSON.stringify(previous)) changes.push({ file: stateFile, content: json(state), expectedBefore: previousBytes ? sha256(previousBytes) : null });
  const result = { apply, files: changes.map(change => change.file), continuous: continuous.archived, archivedVersions: changelog.archivedVersions };
  if (apply) applyChanges(directory, changes, afterInstall);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--check', '--apply', '--recover', '--force-scan'].includes(arg))) throw new Error('Use --check, --apply, --force-scan or --recover');
    const result = args.includes('--recover') ? recoverHistory() : args.includes('--check') ? historyCheck() : archiveHistory(root, { apply: args.includes('--apply'), forceScan: args.includes('--force-scan') });
    console.log(JSON.stringify(result, null, 2));
    if (result.pendingRecovery) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
