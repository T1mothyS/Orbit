// Real isolated API required. Optional Playwright is supplied externally, like existing smoke scripts.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createAuditContext } = require('./browser-automation.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
assert.equal(process.env.ORBIT_UI_AUDIT_SYNTHETIC, 'true', 'Explicit synthetic preview required');
const normalBase = process.env.ORBIT_PREVIEW_URL, automatedBase = process.env.ORBIT_AUDIT_URL;
assert.ok(normalBase && automatedBase, 'Supply normal and ui-audit preview origins');
const output = process.env.ORBIT_UI_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-native-dialog-'));
fs.mkdirSync(output, { recursive: true });
const checks = [], telemetry = [];
const savedProfile = `合成已保存正常资料 ${Date.now()}`;
const scheduleMessage = '放弃本次未保存的编辑？', profileMessage = '资料尚未保存，离开会丢弃当前修改。是否离开？';
async function login(audit, base) {
  const response = await audit.context.request.post(base + '/api/auth/login', { data: { email: process.env.ORBIT_UI_QA_EMAIL || 'preview@example.invalid', password: process.env.ORBIT_UI_QA_PASSWORD || 'OrbitPreview123!' } });
  assert.equal(response.status(), 200); const { token } = await response.json();
  // Give the disposable account an actual image so missing-avatar fallback 404s do not
  // contaminate console diagnostics for the dialog scenarios.
  const headers = { Authorization: `Bearer ${token}` };
  const profile = await audit.context.request.get(base + '/api/orbit/profile', { headers });
  if (!(await profile.json()).avatarId) {
    const png = await require('sharp')({ create: { width: 8, height: 8, channels: 3, background: '#5a7399' } }).png().toBuffer();
    const avatar = await audit.context.request.post(base + '/api/orbit/profile/avatar', { headers, data: { mimeType: 'image/png', base64: png.toString('base64') } });
    assert.equal(avatar.status(), 200);
  }
  await audit.context.addInitScript(({ token, origin }) => { if (location.origin === origin) localStorage.setItem('aicalendar_token', token); }, { token, origin: new URL(base).origin });
}
async function arm(page, name) {
  await page.locator('#orbit-browser-audit-controls > summary').click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function newSchedule(page) { await page.getByRole('button', { name: '添加日程', exact: true }).click(); await page.getByLabel('日程标题', { exact: true }).waitFor(); }
// Chromium can leave reload waiting for a load event after beforeunload is dismissed.
// Used only with an explicit dismiss expectation; the caller also checks the retained draft.
async function abortedReload(page) { try { await page.reload({ timeout: 3000 }); } catch (error) { if (error.name !== 'TimeoutError' && !String(error).includes('ERR_ABORTED')) throw error; } }
(async () => {
  const browser = await chromium.launch({ channel: process.env.ORBIT_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const native = await createAuditContext(browser, { baseURL: normalBase, synthetic: true, viewport: { width: 390, height: 844 } });
    telemetry.push({ mode: 'native', records: native.records });
    await login(native, normalBase);
    await native.context.addInitScript(() => {
      const add = window.addEventListener, remove = window.removeEventListener, listeners = new Set();
      window.addEventListener = function (type, listener, options) { if (type === 'beforeunload') listeners.add(listener); return add.call(this, type, listener, options); };
      window.removeEventListener = function (type, listener, options) { if (type === 'beforeunload') listeners.delete(listener); return remove.call(this, type, listener, options); };
      // Vite also observes unload for its websocket; count only handlers that request a confirmation.
      window.__auditUnloadCount = () => [...listeners].filter(listener => String(listener).includes('returnValue')).length;
    });
    const page = await native.context.newPage(); page.setDefaultTimeout(6000);
    await page.goto(normalBase + '/schedule');
    assert.equal(await page.locator('#orbit-browser-audit-controls').count(), 0);
    await newSchedule(page); await page.getByLabel('关闭日程编辑', { exact: true }).click(); assert.equal(native.records.filter(r => r.type === 'dialog').length, 0);
    await newSchedule(page); await page.getByLabel('日程标题', { exact: true }).fill('合成原生确认验证');
    await native.dialogs(page).expectDialog({ type: 'confirm', message: scheduleMessage, action: 'dismiss' }, () => page.getByLabel('关闭日程编辑', { exact: true }).click());
    assert.equal(await page.getByLabel('日程标题', { exact: true }).inputValue(), '合成原生确认验证');
    await native.dialogs(page).expectDialog({ type: 'confirm', message: scheduleMessage, action: 'accept' }, () => page.getByLabel('关闭日程编辑', { exact: true }).click());
    assert.equal(await page.getByRole('dialog', { name: '新增日程', exact: true }).count(), 0); checks.push('normal: clean close no dialog; native confirm dismiss preserves / accept discards');
    await page.goto(normalBase + '/settings/profile'); await page.getByLabel('职业背景', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__auditUnloadCount()), 0);
    const original = await page.getByLabel('职业背景', { exact: true }).inputValue();
    await page.getByLabel('职业背景', { exact: true }).fill(original + '合成正常模式未保存修改');
    await page.waitForFunction(() => window.__auditUnloadCount() === 1);
    await native.dialogs(page).expectDialog({ type: 'confirm', message: profileMessage, action: 'dismiss' }, () => page.getByRole('link', { name: /返回对话/ }).click());
    assert.ok(page.url().endsWith('/settings/profile'));
    await native.dialogs(page).expectDialog({ type: 'beforeunload', action: 'dismiss' }, () => abortedReload(page));
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), original + '合成正常模式未保存修改');
    await page.getByRole('button', { name: '取消', exact: true }).click(); await page.waitForFunction(() => window.__auditUnloadCount() === 0);
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), original);
    await page.getByLabel('职业背景', { exact: true }).fill(savedProfile); await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => window.__auditUnloadCount() === 0);
    const dialogsBefore = native.records.filter(r => r.type === 'dialog').length;
    await page.reload(); await page.getByLabel('职业背景', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), savedProfile);
    assert.equal(native.records.filter(r => r.type === 'dialog').length, dialogsBefore);
    await page.getByRole('link', { name: /返回对话/ }).click(); checks.push('normal: unload 0 clean / 1 dirty / 0 revert-save; dirty refresh refused; saved refresh-return clean');
    await page.screenshot({ path: path.join(output, 'normal-after-save.png') });
    await page.close(); native.assertHealthy(); await native.context.close();

    const auto = await createAuditContext(browser, { baseURL: automatedBase, synthetic: true }); telemetry.push({ mode: 'automated-native-events', records: auto.records }); await login(auto, automatedBase);
    const automated = await auto.context.newPage(); automated.setDefaultTimeout(6000);
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      await automated.setViewportSize({ width, height }); await automated.goto(automatedBase + '/schedule');
      await automated.locator('#orbit-browser-audit-controls').waitFor();
      if (width < 900) {
        await automated.getByLabel('打开日历侧栏', { exact: true }).click();
        await automated.getByLabel('关闭日历侧栏', { exact: true }).press('Escape');
        await automated.getByLabel('打开日历侧栏', { exact: true }).waitFor({ state: 'visible' });
      }
      await arm(automated, '测试：下次日程取消放弃'); await newSchedule(automated);
      await automated.getByLabel('日程标题', { exact: true }).fill(`合成自动化时间 ${width}`);
      await automated.getByRole('button', { name: /^开始\s*09:00$/ }).click();
      await automated.getByLabel('开始时间：小时', { exact: true }).press('ArrowDown');
      await automated.getByLabel('开始时间：小时', { exact: true }).press('Enter');
      await automated.getByLabel('开始时间：分钟', { exact: true }).press('ArrowDown');
      await automated.getByLabel('开始时间：分钟', { exact: true }).press('Space');
      await automated.locator('.smart-time-panel').getByRole('button', { name: '确定', exact: true }).press('Enter');
      assert.ok(await automated.getByRole('button', { name: /^开始\s*10:01$/ }).evaluate(el => el === document.activeElement));
      await automated.getByLabel('关闭日程编辑', { exact: true }).click(); assert.equal(await automated.getByRole('dialog', { name: '新增日程', exact: true }).count(), 1);
      await automated.getByRole('dialog', { name: '新增日程', exact: true }).getByRole('button', { name: '添加日程', exact: true }).click();
      await automated.getByRole('dialog', { name: '新增日程', exact: true }).waitFor({ state: 'detached' });
      await arm(automated, '测试：下次日程确认放弃'); await newSchedule(automated); await automated.getByLabel('日程标题', { exact: true }).fill('合成放弃验证');
      await automated.getByLabel('关闭日程编辑', { exact: true }).click(); assert.equal(await automated.getByRole('dialog', { name: '新增日程', exact: true }).count(), 0);
      assert.deepEqual(await automated.evaluate(() => window.__orbitBrowserAudit.failures), []);
      telemetry.push({ mode: 'prelude-schedule', width, records: await automated.evaluate(() => window.__orbitBrowserAudit.records) });
      await automated.locator('.account-menu > summary').click(); await automated.getByRole('button', { name: '设置', exact: true }).click(); await automated.getByLabel('关闭设置', { exact: true }).press('Escape');
      await automated.waitForFunction(() => document.activeElement?.matches('.account-menu > summary'));
      await automated.goto(automatedBase + '/settings/profile'); await automated.getByLabel('职业背景', { exact: true }).waitFor();
      await arm(automated, '测试：下次资料离开取消放弃'); await automated.getByLabel('职业背景', { exact: true }).fill(`合成资料修改 ${width}`); await automated.getByRole('link', { name: /返回对话/ }).click(); assert.ok(automated.url().endsWith('/settings/profile'));
      await arm(automated, '测试：下次资料离开确认放弃'); await automated.getByRole('link', { name: /返回对话/ }).click(); await automated.waitForURL('**/assistant');
      await automated.locator('.account-menu > summary').click(); await automated.getByRole('link', { name: '个人资料', exact: true }).click();
      await automated.getByLabel('职业背景', { exact: true }).waitFor();
      await arm(automated, '测试：下次资料离开取消放弃'); await automated.getByLabel('职业背景', { exact: true }).fill(`合成浏览器返回 ${width}`);
      await automated.goBack(); await automated.waitForURL('**/settings/profile');
      assert.equal(await automated.getByLabel('职业背景', { exact: true }).inputValue(), `合成浏览器返回 ${width}`);
      await arm(automated, '测试：下次资料离开确认放弃'); await automated.goBack(); await automated.waitForURL('**/assistant');
      assert.deepEqual(await automated.evaluate(() => window.__orbitBrowserAudit.failures), []);
      telemetry.push({ mode: 'prelude-profile', width, records: await automated.evaluate(() => window.__orbitBrowserAudit.records) });
      await automated.goto(automatedBase + '/settings/profile'); await automated.getByLabel('职业背景', { exact: true }).waitFor(); await automated.getByLabel('职业背景', { exact: true }).fill('合成刷新丢弃'); await automated.reload(); await automated.getByLabel('职业背景', { exact: true }).waitFor();
      assert.equal(await automated.getByLabel('职业背景', { exact: true }).inputValue(), savedProfile);
      assert.equal(await automated.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await automated.screenshot({ path: path.join(output, `automated-${width}.png`) });
      checks.push(`automated ${width}: time keyboard, confirm cancel/save/discard, settings Escape-focus, dirty return cancel/accept, dirty refresh, navigation/overflow`);
    }
    await automated.getByLabel('职业背景', { exact: true }).fill('合成关闭页面未保存');
    await Promise.all([automated.waitForEvent('close'), automated.close({ runBeforeUnload: true })]); await auto.context.close();
    assert.ok(auto.records.some(record => record.type === 'beforeunload' && record.decision === 'bypass'));
    assert.equal(auto.records.filter(record => record.type === 'dialog').length, 0); auto.assertHealthy();
    fs.writeFileSync(path.join(output, 'dialog-smoke.json'), JSON.stringify({ checks, telemetry }, null, 2)); console.log('PASS:', checks.length, 'groups; automatic native dialogs 0. Evidence:', output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); fs.writeFileSync(path.join(output, 'dialog-smoke-failed.json'), JSON.stringify({ checks, telemetry }, null, 2)); process.exitCode = 1; });
