import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import initSqlJs from 'sql.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-connected-migration-'));
process.env.DATA_DIR=root;
const SQL=await initSqlJs();
const legacy=new SQL.Database();
legacy.run('CREATE TABLE synthetic_legacy_marker (value TEXT)');
legacy.run("INSERT INTO synthetic_legacy_marker VALUES ('preserve-me')");
const bytes=Buffer.from(legacy.export());
for(const name of ['chat.db','schedule.db','reminder.db','activity.db'])fs.writeFileSync(path.join(root,name),bytes);
const connection=await import('./database/connection.js');

test('additive report migration freezes every existing store before schema writes and does not repeat on restart',async()=>{
  await connection.initDb();
  const snapshots=fs.readdirSync(path.join(root,'migration-backups')).filter(name=>name.startsWith('connected-report-'));
  assert.equal(snapshots.length,1);
  for(const name of ['chat.db','schedule.db','reminder.db','activity.db'])assert.deepEqual(fs.readFileSync(path.join(root,'migration-backups',snapshots[0],name)),bytes);
  assert.ok(connection.queryOne("SELECT name FROM sqlite_master WHERE name='orbit_activity_reports'"));
  const imageSnapshots = fs.readdirSync(path.join(root, 'migration-backups')).filter(name => name.startsWith('note-images-'));
  assert.equal(imageSnapshots.length, 1);
  for (const name of ['chat.db', 'schedule.db', 'reminder.db', 'activity.db']) assert.deepEqual(fs.readFileSync(path.join(root, 'migration-backups', imageSnapshots[0], name)), bytes);
  assert.ok(connection.queryOne("SELECT name FROM sqlite_master WHERE name='note_images'"));
  assert.ok(connection.queryOne("SELECT name FROM sqlite_master WHERE name='note_item_images'"));
  assert.equal(connection.queryOne<{value:string}>('SELECT value FROM synthetic_legacy_marker')?.value,'preserve-me');
  await connection.initDb();
  assert.equal(fs.readdirSync(path.join(root,'migration-backups')).filter(name=>name.startsWith('connected-report-')).length,1);
  assert.equal(fs.readdirSync(path.join(root, 'migration-backups')).filter(name => name.startsWith('note-images-')).length, 1);
});
