/** Dedicated test entrypoint. Never use a production data directory or credentials. */
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import express from 'express';

const directory = process.env.DATA_DIR || '';
if (!path.isAbsolute(directory) || path.basename(directory) !== 'digest-v2-shadow-data') throw new Error('An absolute dedicated digest-v2-shadow-data directory is required');
const port = Number(process.env.PORT || 3188);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) throw new Error('A dedicated test port is required');
const email = process.env.DIGEST_SHADOW_LOGIN_EMAIL;
const hash = process.env.DIGEST_SHADOW_PASSWORD_HASH;
if (!email || !hash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error('Dedicated test account configuration required');
// Reject redirected data roots before importing modules that initialize stores.
if (fs.existsSync(directory) && path.resolve(fs.realpathSync(directory)) !== path.resolve(directory)) throw new Error('Shadow data directory must not be a symlink');
process.env.DIGEST_SHADOW_ONLY = 'true';
process.env.DIGEST_V2_ENABLED = 'true';
process.env.DIGEST_PRODUCTION_CONTRACT = 'daily-digest.v1';
process.env.DIGEST_R2_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_ENV = 'production';
process.env.NODE_ENV = 'production';
// An accidental inherited mail credential must not enable delivery in this process.
delete process.env.SMTP_PASS;
delete process.env.IMAP_PASS;
// Registration is blocked; independent random bootstrap codes must never inherit production values.
process.env.ADMIN_INVITE_CODE = randomBytes(32).toString('hex');
process.env.USER_INVITE_CODE = randomBytes(32).toString('hex');
const api = await import('./application.js');
const db = await import('./db.js');
const activity = await import('./activity-store.js');
await api.initializeServer();
if (!db.getUserByEmail(email)) {
  const now = new Date().toISOString();
  db.createUser({ id: 'digest-shadow-owner', email, password_hash: hash, role: 'user', disabled: 0, created_at: now, updated_at: now });
}
const app = express();
const allowedPosts = new Set(['/mcp', '/oauth/register', '/oauth/authorize/login', '/oauth/authorize/consent', '/oauth/token', '/oauth/revoke', '/api/auth/login', '/api/auth/logout']);
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const mailAccountSetting = req.path === '/api/user-mail-account' && ['PUT', 'DELETE'].includes(req.method);
  const mailAccountTest = req.path === '/api/user-mail-account/test' && req.method === 'POST';
  const watchlistMigration = req.path === '/api/daily-report/cloud-context/shadow-watchlist' && ['PATCH', 'DELETE'].includes(req.method);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !(req.method === 'POST' && allowedPosts.has(req.path)) && !mailAccountSetting && !mailAccountTest && !watchlistMigration) return res.status(403).json({ error: 'SHADOW_ONLY' });
  next();
});
app.use(api.app);
const listener = app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'digest_shadow_listening', port, shadowOnly: true, backgroundJobs: false })));
// Snapshot expiry does not require enabling the production notification/job scheduler.
const maintenance = setInterval(() => { try { activity.expireDigestSnapshots(); } catch { console.error('DIGEST_SNAPSHOT_EXPIRY_FAILED'); } }, 60_000);
maintenance.unref();
const shutdown = () => { clearInterval(maintenance); listener.close(); listener.closeIdleConnections(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
