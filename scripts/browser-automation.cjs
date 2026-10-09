// Optional, externally supplied Playwright. Attach before navigation; no production browser/profile changes.
const assert = require('node:assert/strict');
async function createAuditContext(browser, { baseURL, synthetic, permissions = [], ...options }) {
  const origin = new URL(baseURL).origin;
  assert.equal(synthetic, true, 'Only an explicitly synthetic test context is allowed');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Loopback origin required');
  const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-write']);
  for (const permission of permissions) assert.ok(allowed.has(permission), `Unsupported test permission: ${permission}`);
  const context = await browser.newContext(options);
  if (permissions.length) await context.grantPermissions(permissions, { origin });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const records = [], failures = [], controllers = new WeakMap();
  const safeURL = value => { try { return new URL(value).pathname; } catch { return '[invalid URL]'; } };
  const record = entry => { records.push(entry); if (records.length > 500) records.shift(); };
  const attach = page => {
    let expected;
    const controller = {
      async expectDialog(spec, action) {
        assert.ok(!expected, 'A dialog expectation is already pending');
        assert.ok(['accept', 'dismiss'].includes(spec.action));
        const next = { ...spec, seen: false, done: undefined }; expected = next;
        try { await action(); if (next.done) await next.done; assert.equal(next.seen, true, `Expected ${spec.type} dialog was not observed`); }
        finally { if (expected === next) expected = undefined; }
      },
    };
    controllers.set(page, controller);
    page.on('dialog', dialog => {
      const next = expected; expected = undefined;
      const matches = !!next && next.type === dialog.type() && (next.message === undefined || next.message === dialog.message());
      const entry = { type: 'dialog', dialogType: dialog.type(), path: safeURL(page.url()), message: matches ? dialog.message() : '[unexpected message omitted]', decision: matches ? next.action : 'dismiss', unexpected: !matches };
      record(entry);
      if (!matches) failures.push(entry);
      if (next) next.seen = matches;
      const done = (matches && next.action === 'accept' ? dialog.accept() : dialog.dismiss()).catch(() => { const failure = { type: 'dialog-handler-failed' }; failures.push(failure); record(failure); });
      if (next) next.done = done;
    });
    page.on('console', message => {
      if (message.type() === 'info' && message.text().startsWith('[orbit-browser-audit] ')) {
        const entry = { type: 'audit-prelude', ...JSON.parse(message.text().slice('[orbit-browser-audit] '.length)) };
        record(entry); if (entry.unexpected) failures.push(entry);
      }
      if (message.type() === 'error') { const entry = { type: 'console-error', path: safeURL(page.url()), message: message.text().slice(0, 300) }; record(entry); failures.push(entry); }
    });
    page.on('pageerror', error => { const entry = { type: 'pageerror', message: error.message.slice(0, 300) }; record(entry); failures.push(entry); });
    page.on('requestfailed', request => record({ type: 'requestfailed', path: safeURL(request.url()), error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) record({ type: 'http-error', path: safeURL(response.url()), status: response.status() }); });
  };
  context.on('page', attach);
  return { context, records, failures, dialogs: page => controllers.get(page), assertHealthy: () => assert.deepEqual(failures, []) };
}
module.exports = { createAuditContext };
