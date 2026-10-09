import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { createAuditVitePlugin } = createRequire(import.meta.url)('../scripts/browser-audit-bootstrap.cjs');
const { createAuditContext } = createRequire(import.meta.url)('../scripts/browser-automation.cjs');

test('audit prelude is absent from builds and requires synthetic loopback serving', () => {
  for (const mode of ['production', 'ui-audit']) assert.equal(createAuditVitePlugin({ command: 'build', mode, synthetic: 'true', apiTarget: 'http://127.0.0.1:3000' }), undefined);
  assert.equal(createAuditVitePlugin({ command: 'serve', mode: 'development' }), undefined);
  assert.throws(() => createAuditVitePlugin({ command: 'serve', mode: 'ui-audit' }), /requires/);
  assert.throws(() => createAuditVitePlugin({ command: 'serve', mode: 'ui-audit', synthetic: 'true', apiTarget: 'https://example.invalid' }), /requires/);
  const plugin = createAuditVitePlugin({ command: 'serve', mode: 'ui-audit', synthetic: 'true', apiTarget: 'http://127.0.0.1:3000' });
  assert.throws(() => plugin.configResolved({ server: { host: '0.0.0.0' } }), /loopback/);
  const domEvents: Record<string, () => void> = {}, windowEvents: Record<string, (event: any) => void> = {};
  const buttons: any[] = [];
  const element = () => ({ style: {}, append() {}, setAttribute() {}, textContent: '', open: false });
  const sandbox: any = { location: { hostname: '127.0.0.1', pathname: '/schedule' }, console: { info() {}, error() {} }, Date,
    document: { addEventListener: (type: string, listener: () => void) => domEvents[type] = listener, createElement: (tag: string) => { const item: any = element(); if (tag === 'button') buttons.push(item); return item; }, body: { append() {} } } };
  sandbox.window = sandbox; sandbox.top = sandbox; sandbox.addEventListener = (type: string, listener: (event: any) => void) => windowEvents[type] = listener;
  const script = plugin.transformIndexHtml.handler()[0].children;
  vm.runInNewContext(script, sandbox); domEvents.DOMContentLoaded();
  const discard = '放弃本次未保存的编辑？';
  buttons.find(button => button.textContent === '测试：下次日程确认放弃').onclick();
  assert.equal(sandbox.confirm('删除所有数据？'), false); // Mismatch consumes arm without applying destructive acceptance.
  assert.equal(sandbox.confirm(discard), false);
  buttons.find(button => button.textContent === '测试：下次日程确认放弃').onclick();
  assert.equal(sandbox.confirm(discard), true);
  assert.equal(sandbox.confirm(discard), false); // One shot cannot leak into a second dialog.
  buttons.find(button => button.textContent === '测试：下次日程取消放弃').onclick();
  assert.equal(sandbox.confirm(discard), false);
  buttons.find(button => button.textContent === '测试：下次资料离开确认放弃').onclick(); sandbox.location.pathname = '/other';
  assert.equal(sandbox.confirm('资料尚未保存，离开会丢弃当前修改。是否离开？'), false);
  sandbox.location.pathname = '/settings/profile';
  buttons.find(button => button.textContent === '测试：下次资料离开确认放弃').onclick();
  sandbox.location.pathname = '/assistant'; windowEvents.popstate({});
  assert.equal(sandbox.confirm('资料尚未保存，离开会丢弃当前修改。是否离开？'), true);
  let bypassed = false; windowEvents.beforeunload({ stopImmediatePropagation() { bypassed = true; } }); assert.ok(bypassed);
  assert.equal(sandbox.alert('unexpected alert'), undefined); assert.equal(sandbox.prompt('unexpected prompt'), null);
  assert.ok(sandbox.__orbitBrowserAudit.failures.length >= 5);
  const remote: any = { location: { hostname: 'example.invalid' } }; remote.window = remote; remote.top = remote;
  vm.runInNewContext(script, remote); assert.equal(remote.__orbitBrowserAudit, undefined);
});

test('native browser helper rejects production origins and grants only explicitly requested permissions', async () => {
  let created = 0, granted: unknown;
  const context: any = new EventEmitter(); context.route = async () => {}; context.grantPermissions = async (...args: unknown[]) => granted = args;
  const browser = { async newContext() { created++; return context; } };
  await assert.rejects(createAuditContext(browser, { baseURL: 'https://example.invalid', synthetic: true }), /Loopback/);
  await assert.rejects(createAuditContext(browser, { baseURL: 'http://127.0.0.1:3000', synthetic: false }), /synthetic/);
  await assert.rejects(createAuditContext(browser, { baseURL: 'http://127.0.0.1:3000', synthetic: true, permissions: ['geolocation'] }), /permission/);
  assert.equal(created, 0);
  await createAuditContext(browser, { baseURL: 'http://127.0.0.1:3000', synthetic: true, permissions: ['clipboard-write'] });
  assert.deepEqual(granted, [['clipboard-write'], { origin: 'http://127.0.0.1:3000' }]);
});

test('native dialogs match type/message/scenario, unknowns dismiss and fail, diagnostics omit URLs queries', async () => {
  const context: any = new EventEmitter(); context.route = async () => {};
  const audit = await createAuditContext({ newContext: async () => context }, { baseURL: 'http://127.0.0.1:3000', synthetic: true });
  const page: any = new EventEmitter(); page.url = () => 'http://127.0.0.1:3000/schedule?private=not-logged'; context.emit('page', page);
  const decisions: string[] = [];
  const emit = (type: string, message: string) => page.emit('dialog', { type: () => type, message: () => message, accept: async () => decisions.push('accept'), dismiss: async () => decisions.push('dismiss') });
  await audit.dialogs(page).expectDialog({ type: 'confirm', message: 'discard?', action: 'accept' }, async () => emit('confirm', 'discard?'));
  await audit.dialogs(page).expectDialog({ type: 'confirm', message: 'discard?', action: 'dismiss' }, async () => emit('confirm', 'discard?'));
  await assert.rejects(audit.dialogs(page).expectDialog({ type: 'confirm', message: 'discard?', action: 'accept' }, async () => emit('confirm', 'unknown secret')), /not observed/);
  await assert.rejects(audit.dialogs(page).expectDialog({ type: 'confirm', message: 'discard?', action: 'accept' }, async () => {}), /not observed/);
  emit('prompt', 'unknown secret'); assert.deepEqual(decisions, ['accept', 'dismiss', 'dismiss', 'dismiss']);
  assert.throws(() => audit.assertHealthy());
  assert.ok(!JSON.stringify(audit.records).includes('unknown secret')); assert.ok(!JSON.stringify(audit.records).includes('not-logged'));
});
