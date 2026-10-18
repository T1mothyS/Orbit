import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore, NotificationStore } from '../src/features/settings/state.js';
import { resolveSetting } from '../src/utils/module-settings.js';
import { helpQuestion, appendHelpQuestion } from '../src/features/help/topics.js';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const envelope = (context: Record<string, unknown>, version = 3) => ({ version, context, readFailed: false, createdAt: null, updatedAt: null });

test('Cloud owner saves one domain, preserves the other draft, unknown fields and shared latest version', async () => {
  let saved = envelope({ profile: { name: 'saved', unknown: 'keep' }, preferences: { focus: 'old' }, future: { nested: [1, 2] } });
  const bodies: any[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); assert.equal(body.expectedVersion, saved.version); saved = envelope(body.context, saved.version + 1); }
    return json({ context: saved });
  };
  const owner = new ContextStore({ Authorization: 'synthetic' }, fetcher); await owner.ensure();
  owner.change(['profile', 'name'], 'draft profile'); owner.change(['preferences', 'focus'], 'draft report');
  await owner.save('profile');
  assert.equal((bodies[0].context.preferences as any).focus, 'old'); assert.equal((saved.context.profile as any).unknown, 'keep');
  assert.equal((owner.state.draft.preferences as any).focus, 'draft report'); assert.equal(owner.dirty('profile'), false); assert.equal(owner.dirty('report'), true);
  await owner.save('report'); assert.equal(bodies[1].expectedVersion, 4); assert.equal((saved.context.profile as any).name, 'draft profile'); assert.deepEqual(saved.context.future, { nested: [1, 2] }); assert.equal(owner.dirty(), false);
});
test('409 preserves both Cloud drafts and blocks further writes until an explicit reload', async () => {
  let puts = 0;
  const owner = new ContextStore({}, async (_url, init) => init?.method === 'PUT' ? (++puts, json({ error: '版本冲突' }, 409)) : json({ context: envelope({ profile: { name: 'saved' }, preferences: { focus: 'saved' } }) }));
  await owner.ensure(); owner.change(['profile', 'name'], 'mine'); owner.change(['preferences', 'focus'], 'report mine'); await owner.save('profile'); await owner.save('report');
  assert.equal(puts, 1); assert.equal(owner.state.conflict, true); assert.equal((owner.state.draft.profile as any).name, 'mine'); assert.equal((owner.state.draft.preferences as any).focus, 'report mine');
  owner.reset('profile'); assert.equal(owner.dirty('report'), true); assert.equal(owner.state.conflict, true);
  await owner.reload(); assert.equal(owner.state.conflict, false); assert.equal(owner.dirty(), false);
});
test('canceling the only domain change is clean even when merging reorders root object keys', async () => {
  const context = { profile: { background: { career_context: 'saved' } }, preferences: { prefer: ['keep'] }, extension: { a: 1, b: 2 } };
  const owner = new ContextStore({}, async () => json({ context: envelope(context) })); await owner.ensure();
  owner.change(['profile', 'background', 'career_context'], 'draft'); assert.equal(owner.dirty(), true); owner.reset('profile');
  assert.deepEqual(owner.state.draft, context); assert.equal(owner.dirty(), false); assert.equal(owner.dirty('profile'), false);
});
test('failed Cloud reads never replace saved data and ordinary domain saves adopt clean server fields', async () => {
  let fail = false;
  const owner = new ContextStore({}, async (_url, init) => fail ? json({ error: 'unavailable' }, 503) : json({ context: envelope({ profile: { name: init?.method === 'PUT' ? 'new' : 'old' }, serverField: 'keep' }, init?.method === 'PUT' ? 4 : 3) }));
  await owner.ensure(); owner.change(['profile', 'name'], 'new'); await owner.save('profile'); assert.equal(owner.dirty(), false);
  fail = true; await owner.reload(); assert.equal(owner.state.saved?.version, 4); assert.equal((owner.state.draft.profile as any).name, 'new'); assert.match(owner.state.error, /unavailable/);
});
test('notification automatic saves keep other dirty fields and serialize PUT then GET', async () => {
  let saved: Record<string, unknown> = { reminderEmail: 'old@example.invalid', enabled: false, reportEmailEnabled: false, quietStart: '22:00' };
  const calls: string[] = [], writes: any[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push(init?.method || 'GET');
    if (init?.method === 'PUT') { const body = JSON.parse(init.body as string); writes.push(body); await new Promise(resolve => setTimeout(resolve, 5)); saved = { ...saved, ...body }; }
    return json({ preference: saved });
  };
  const owner = new NotificationStore({}, fetcher); await owner.ensure(); owner.change('reminderEmail', 'draft@example.invalid'); owner.change('quietStart', '23:00');
  await Promise.all([owner.save(['enabled'], { enabled: true }), owner.save(['reportEmailEnabled'], { reportEmailEnabled: true })]);
  assert.deepEqual(calls, ['GET', 'PUT', 'GET', 'PUT', 'GET']); assert.deepEqual(writes, [{ enabled: true }, { reportEmailEnabled: true }]);
  assert.equal(owner.state.draft.reminderEmail, 'draft@example.invalid'); assert.equal(owner.state.draft.quietStart, '23:00'); assert.equal(owner.state.saved?.reminderEmail, 'old@example.invalid');
  await owner.save(['reminderEmail']); assert.equal(owner.state.draft.quietStart, '23:00'); assert.equal(owner.dirty(), true);
});
test('edits during a notification write survive acknowledgment and readback mismatch remains dirty', async () => {
  let saved = { reminderEmail: 'old@example.invalid', enabled: false }, mismatch = false;
  const owner = new NotificationStore({}, async (_url, init) => {
    if (init?.method === 'PUT') { const payload = JSON.parse(init.body as string); owner.change('reminderEmail', 'newer@example.invalid'); if (!mismatch) saved = { ...saved, ...payload }; }
    return json({ preference: saved });
  });
  await owner.ensure(); owner.change('reminderEmail', 'first@example.invalid'); await owner.save(['reminderEmail']); assert.equal(owner.state.draft.reminderEmail, 'newer@example.invalid');
  mismatch = true; await owner.save(['enabled'], { enabled: true }); assert.match(owner.state.error, /回读/); assert.equal(owner.state.draft.enabled, true); assert.equal(owner.state.saved?.enabled, false);
  await owner.reload(); assert.equal(owner.state.draft.reminderEmail, 'newer@example.invalid'); assert.equal(owner.state.draft.enabled, true);
});
test('notification failed writes retain a retryable draft and do not block later queued operations', async () => {
  let failed = true, saved = { enabled: false, reportEmailEnabled: false };
  const owner = new NotificationStore({}, async (_url, init) => { if (init?.method === 'PUT') { if (failed) { failed = false; throw new Error('synthetic offline'); } saved = { ...saved, ...JSON.parse(init.body as string) }; } return json({ preference: saved }); });
  await owner.ensure(); await owner.save(['enabled'], { enabled: true }); assert.equal(owner.state.pending, 0); assert.equal(owner.state.draft.enabled, true); assert.match(owner.state.error, /offline/);
  await owner.save(['reportEmailEnabled'], { reportEmailEnabled: true }); assert.equal(owner.state.saved?.reportEmailEnabled, true); assert.equal(owner.state.draft.enabled, true);
});
test('settings targets reject unknown and forbidden IDs while retaining legacy sections', () => {
  assert.deepEqual(resolveSetting('library-personal-preferences'), { kind: 'known', path: '/settings/account/profile' });
  assert.deepEqual(resolveSetting('settings-notifications'), { kind: 'known', path: '/settings/notifications' });
  assert.deepEqual(resolveSetting('settings-report-personalization'), { kind: 'known', path: '/settings/reports' });
  assert.deepEqual(resolveSetting('settings-admin'), { kind: 'forbidden' });
  assert.deepEqual(resolveSetting('settings-admin', true), { kind: 'known', path: '/settings/advanced' });
  assert.deepEqual(resolveSetting('setting-account-not-a-real-id'), { kind: 'unknown' });
  assert.deepEqual(resolveSetting('android-fcm-test'), { kind: 'unknown' });
});
test('help accepts only controlled question IDs and appends without replacing an existing draft', () => {
  const question = helpQuestion('notifications')!;
  assert(question); assert.equal(helpQuestion('https://malicious.invalid'), null); assert.equal(helpQuestion('arbitrary user content'), null);
  assert.equal(appendHelpQuestion('previous text', question), 'previous text\n\n' + question);
  assert.equal(appendHelpQuestion('previous text\n\n' + question, question), 'previous text\n\n' + question);
});
