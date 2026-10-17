// Disposable subprocess only. The parent provides a fresh temporary DATA_DIR.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';
const mode = process.argv[3], directory = process.argv[2];
const modes = new Set(['verify', 'before-database', 'after-database', 'after-commit', 'rollback-failure', 'commit-blocked']);
if (!directory || !modes.has(mode) || !path.basename(directory).startsWith('orbit-password-')
  || !fs.realpathSync(directory).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
  throw new Error('Password crash fixture requires its dedicated existing temporary directory and an explicit mode.');
Object.assign(process.env, { DATA_DIR: process.argv[2], NODE_ENV: 'test', APP_ENV: 'development' });
const db = await import('./db.js');
const { changeAccountPassword } = await import('./account-security.js');
const { getUserCredentials } = await import('./database/queries/accounts.js');
const { createAuth } = await import('./auth.js');
const { blockPersistenceUntilRestart } = await import('./persistence.js');
await db.initDb();
const oldPassword = 'Crash original 123!', newPassword = 'Crash replacement 123!';
const id = 'crash-user', stamp = new Date().toISOString();
if (!db.getUserById(id)) {
  if (mode === 'verify') throw new Error('Crash fixture user is missing; verification must not seed replacement evidence.');
  db.createUser({ id, email: 'crash@example.invalid', role: 'user', disabled: 0, password_hash: await bcrypt.hash(oldPassword, 4), auth_version: 0, created_at: stamp, updated_at: stamp });
}
const auth = createAuth({ secret: 'synthetic-crash-token', getUserById: db.getUserById });
const oldToken = auth.signUserToken({ id, email: 'crash@example.invalid', role: 'user', auth_version: 0 });
if (mode === 'verify') {
  const record = getUserCredentials(id)!;
  let oldTokenValid = false;
  auth.authenticate({ headers: { authorization: `Bearer ${oldToken}` } } as any, { status() { return this; }, json() {} } as any, () => { oldTokenValid = true; });
  console.log(JSON.stringify({ oldWorks: await bcrypt.compare(oldPassword, record.password_hash), newWorks: await bcrypt.compare(newPassword, record.password_hash), version: record.auth_version, oldTokenValid }));
} else {
  const rename = fs.renameSync, unlink = fs.unlinkSync;
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    if (mode === 'rollback-failure' && String(to) === path.join(process.argv[2], 'chat.db')) throw new Error('synthetic persistent disk failure');
    if (mode === 'before-database' && String(to) === path.join(process.argv[2], 'chat.db')) process.exit(73);
    rename(from, to);
    if (mode === 'after-database' && String(to) === path.join(process.argv[2], 'chat.db')) process.exit(73);
  }) as typeof fs.renameSync;
  fs.unlinkSync = ((file: fs.PathLike) => {
    unlink(file);
    if (mode === 'after-commit' && String(file).endsWith('.persistence-undo.json')) process.exit(73);
    if (mode === 'commit-blocked' && String(file).endsWith('.persistence-undo.json')) blockPersistenceUntilRestart();
  }) as typeof fs.unlinkSync;
  try { await changeAccountPassword(id, 0, oldPassword, newPassword); }
  catch {
    if (mode !== 'rollback-failure' && mode !== 'commit-blocked') throw new Error('Unexpected fixture failure');
    let blocked = false; try { db.getUserById(id); } catch { blocked = true; }
    const journal = fs.existsSync(path.join(process.argv[2], '.persistence-undo.json'));
    if (!blocked || journal !== (mode === 'rollback-failure')) throw new Error('Recovery journal must match the commit boundary');
    process.exit(73);
  }
}
