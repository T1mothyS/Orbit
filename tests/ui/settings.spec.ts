import { test, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import { fixtureToken } from './auth-fixture';
import { checkVisual } from './visual-check';
const base = 'http://127.0.0.1:4187';
const visualPolicy = JSON.parse(fs.readFileSync(new URL('./visual-policy.json', import.meta.url), 'utf8')) as { settingsApproved?: boolean };
test.describe.configure({ retries: 0 });
async function login(context: BrowserContext, actor = 'preview-settings') {
  const token = await fixtureToken(context, actor + '@example.invalid');
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { Authorization: `Bearer ${token}` };
}
const categories = [['notifications', '通知与提醒'], ['ai', 'AI 与模型'], ['reports', '日报'], ['library', '知识库'], ['integrations', '同步与集成'], ['data', '数据与备份'], ['advanced', '高级']] as const;
for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`settings ${width} ${theme}: all categories use real pages and responsive controls`, async ({ context, page }) => {
    // Visual fixtures own their saved state; parallel functional cases mutate other accounts.
    await login(context);
    await page.setViewportSize({ width, height }); await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const capture = (name: string) => checkVisual(page, name, !!visualPolicy.settingsApproved);
    await page.goto(base + '/settings/account');
    const topbar = page.locator('.settings-workspace-topbar'), back = page.getByRole('link', { name: '返回今日行动中心', exact: true });
    await expect(back).toBeVisible(); await expect(back).toHaveText('');
    const backBox = (await back.boundingBox())!;
    expect(backBox.y).toBeLessThan((await page.getByRole('heading',{level:1}).boundingBox())!.y);
    await expect(page.locator('.settings-workspace-main').getByRole('combobox', { name: '搜索设置', exact: true })).toHaveCount(0);
    if (width < 768) {
      const trigger = topbar.getByRole('button', { name: '搜索设置', exact: true });
      await expect(trigger).toBeVisible(); await expect(topbar.getByRole('combobox', { name: '搜索设置', exact: true })).toHaveCount(0);
      expect(backBox.height).toBeGreaterThanOrEqual(44); expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    } else await expect(topbar.getByRole('combobox', { name: '搜索设置', exact: true })).toBeVisible();
    for (const [category, title] of categories) {
      if (width < 768) { await page.getByRole('link', { name: '设置', exact: true }).filter({ visible: true }).click(); await page.getByRole('navigation', { name: '设置入口' }).getByRole('link', { name: new RegExp('^' + title) }).click(); }
      else await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: title, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible(); await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.product-nav, .orbit-product-nav').count()).toBe(0);
      const invalidControls = await page.locator('input, button, [role=switch], [role=combobox]').evaluateAll(elements => elements.filter(element => element.getClientRects().length && getComputedStyle(element).fontSize === '0px').length);
      expect(invalidControls).toBe(0);
      await capture(`settings-${category}-${width}-${theme}.png`);
      if (category === 'notifications') await checkVisual(page, `settings-header-${width}-${theme}.png`, !!visualPolicy.settingsApproved, false);
      if (category === 'reports') {
        await page.getByRole('tab', { name: '接收与邮件', exact: true }).click(); await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: '生成令牌', exact: true })).toBeEnabled();
        await expect(page.getByRole('switch', { name: '接收并转发本地日报', exact: true })).toBeEnabled();
        await expect(page.getByRole('switch', { name: '日报邮件', exact: true })).toBeEnabled();
        await expect(page.getByRole('switch', { name: '启用日报读取', exact: true })).toBeEnabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await capture(`settings-reports-functional-${width}-${theme}.png`);
      }
    }
    await page.goto(base + '/help'); await expect(page.getByRole('heading', { level: 1, name: 'Orbit 使用指南', exact: true })).toBeVisible(); await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(`help-${width}-${theme}.png`);
    expect(errors).toEqual([]);
  });
}
test('Cloud domains share one version, preserve cross-page drafts and stop on a 409', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const headers = await login(context, 'preview-context');
  const seed = { profile: { background: { career_context: 'saved profile' }, extension: { keep: true } }, preferences: { target_reading_time_minutes: 12 }, future: { keep: ['unknown'] } };
  expect((await context.request.put(base + '/api/daily-report/cloud-context', { headers, data: { context: seed, expectedVersion: 0 } })).status()).toBe(200);
  await page.goto(base + '/settings/account/profile'); await page.getByLabel('职业背景', { exact: true }).fill('draft profile');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '日报', exact: true }).click();
  await page.getByLabel('目标阅读时长（分钟）', { exact: true }).fill('18');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存，下一次 Cloud 日报读取时生效。', { exact: true }).filter({visible:true})).toBeVisible();
  let saved = (await (await context.request.get(base + '/api/daily-report/cloud-context', { headers })).json()).context;
  expect(saved.context.profile.background.career_context).toBe('saved profile'); expect(saved.context.preferences.target_reading_time_minutes).toBe(18); expect(saved.context.future).toEqual(seed.future);
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '账户与安全', exact: true }).click(); await page.getByRole('tab', { name: '个人资料', exact: true }).click();
  await expect(page.getByLabel('职业背景', { exact: true })).toHaveValue('draft profile'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  saved = (await (await context.request.get(base + '/api/daily-report/cloud-context', { headers })).json()).context; expect(saved.version).toBe(3); expect(saved.context.profile.extension.keep).toBe(true);
  await page.getByLabel('职业背景', { exact: true }).fill('conflicting draft');
  await context.request.put(base + '/api/daily-report/cloud-context', { headers, data: { context: { ...saved.context, future: { keep: ['external update'] } }, expectedVersion: saved.version } });
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByRole('button', { name: '重新加载并核对' })).toBeVisible();
  await expect(page.getByLabel('职业背景', { exact: true })).toHaveValue('conflicting draft'); await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('settings-conflict-1440-light.png'), fullPage: true });
});
for (const width of [390, 1440]) test(`header search ${width}: keyboard, empty results, deep link focus and return stay usable`, async ({ context, page }) => {
  await login(context); await page.setViewportSize({ width, height: 900 });
  await context.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto(base + '/library/settings');
  const topbar = page.locator('.settings-workspace-topbar'), trigger = topbar.getByRole('button', { name: '搜索设置', exact: true }), input = topbar.getByRole('combobox', { name: '搜索设置', exact: true });
  if (width < 768) { await trigger.click(); await expect(input).toBeFocused(); }
  await input.fill('没有这个设置的合成关键词'); await expect(page.getByRole('status').filter({ hasText: '没有匹配的设置项' })).toBeVisible();
  await input.fill('备份密码'); await expect(page.getByRole('listbox', { name: '设置搜索结果', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkVisual(page, `settings-header-search-${width}-dark.png`, !!visualPolicy.settingsApproved, false);
  await input.press('Escape');
  if (width < 768) { await expect(trigger).toBeFocused(); await expect(input).toHaveCount(0); await trigger.click(); }
  else { await expect(input).toBeFocused(); await expect(page.getByRole('listbox', { name: '设置搜索结果', exact: true })).toHaveCount(0); }
  await input.clear(); await input.fill('备份密码'); await input.press('Enter'); await expect(page).toHaveURL(/\/settings\/data\?settings=/);
  const id = new URL(page.url()).searchParams.get('settings')!;
  await expect(page.locator(`[id="${id}"]`)).toBeFocused();
  if (width < 768) await expect(input).toHaveCount(0);
  await page.getByRole('link', { name: '返回今日行动中心', exact: true }).click(); await expect(page).toHaveURL(base + '/today');
});
test('report email automatic save preserves notification drafts and the shared saved address', async ({ context, page }) => {
  const headers = await login(context, 'preview-notifications');
  await page.goto(base + '/settings/notifications'); await page.getByLabel('提醒收件邮箱', { exact: true }).fill('draft@example.invalid');
  await page.getByRole('switch', { name: '免打扰时段', exact: true }).click(); await page.getByLabel('免打扰开始时间', {exact:true}).fill('23:00');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '日报', exact: true }).click();
  await page.getByRole('tab',{name:'接收与邮件',exact:true}).click(); await page.getByRole('switch', { name: '日报邮件', exact: true }).click(); await expect(page.getByRole('region',{name:'日报邮件',exact:true}).getByText('设置已保存并回读确认。', { exact: true })).toBeVisible();
  let preference = (await (await context.request.get(base + '/api/notification-preferences', { headers })).json()).preference;
  expect(preference.reminderEmail).not.toBe('draft@example.invalid'); expect(preference.reportEmailEnabled).toBe(true);
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '通知与提醒', exact: true }).click();
  await expect(page.getByLabel('提醒收件邮箱', { exact: true })).toHaveValue('draft@example.invalid'); await expect(page.getByLabel('免打扰开始时间', {exact:true})).toHaveValue('23:00');
  await page.getByRole('button', { name: '保存邮箱', exact: true }).click(); await expect(page.getByRole('button', { name: '保存邮箱', exact: true })).toBeEnabled();
  preference = (await (await context.request.get(base + '/api/notification-preferences', { headers })).json()).preference;
  expect(preference.reminderEmail).toBe('draft@example.invalid'); expect(preference.reportEmailEnabled).toBe(true); expect(preference.quietStart).not.toBe('23:00');
  await expect(page.getByLabel('免打扰开始时间', {exact:true})).toHaveValue('23:00');
});
test('legacy URLs, global setting search, unknown targets and forbidden targets stay explicit', async ({ context, page }) => {
  await login(context);
  for (const [legacy, canonical] of [['/reports/settings', '/settings/reports'], ['/library/settings', '/settings/library'], ['/settings/profile', '/settings/account/profile'], ['/library/preferences', '/settings/reports'], ['/assistant?settings=setting-ai-1l45kwl', '/settings/ai?settings=setting-ai-1l45kwl']]) {
    await page.goto(base + legacy); await expect(page).toHaveURL(base + canonical);
    if (legacy === '/reports/settings' || legacy === '/library/settings') await expect(page.getByRole('link', { name: '返回今日行动中心', exact: true })).toHaveAttribute('href', '/today');
  }
  await page.goto(base + '/library/settings');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '账户与安全', exact: true }).click();
  await page.getByRole('tab', { name: '个人资料', exact: true }).click();
  await expect(page.getByRole('link', { name: '返回今日行动中心', exact: true })).toHaveAttribute('href', '/today');
  await page.goto(base + '/reports/settings?settings=settings-report-personalization');
  await expect(page).toHaveURL(base + '/settings/reports?settings=settings-report-personalization');
  await expect(page.getByRole('tab', { name: '个性化', exact: true })).toHaveAttribute('aria-selected', 'true');
  const search = page.getByRole('combobox', { name: '搜索设置', exact: true }); await search.fill('备份密码'); await search.press('Enter'); await expect(page).toHaveURL(/\/settings\/data\?settings=/);
  await page.goto(base + '/settings?settings=not-a-real-setting'); await expect(page.getByText('设置项不存在', { exact: true })).toBeVisible();
  await page.goto(base + '/settings/advanced?settings=settings-admin'); await expect(page.getByText('无权访问此设置项', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '打开管理面板' })).toHaveCount(0);
});
test('leaving Settings protects ordinary drafts; returning to an AI category clears its secret input', async ({ context, page }) => {
  await login(context, 'preview-guards'); await page.goto(base + '/settings/account/profile'); await page.getByLabel('职业背景', { exact: true }).fill('unsaved profile');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: '返回今日行动中心', exact: true }).click(); await expect(page).toHaveURL(base + '/settings/account/profile');
  await expect(page.getByLabel('职业背景', { exact: true })).toHaveValue('unsaved profile');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: 'AI 与模型', exact: true }).click();
  await page.getByRole('button', { name: '配置 API Key', exact: true }).click(); await page.getByLabel('API Key（必填）', { exact: true }).fill('synthetic-secret-input-only');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '账户与安全', exact: true }).click(); await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: 'AI 与模型', exact: true }).click();
  await expect(page.getByLabel('API Key（必填）', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('synthetic-secret-input-only'))).toBe(false);
});
test('help only appends a controlled question to the existing conversation and never sends it', async ({ context, page }) => {
  await login(context); await page.goto(base + '/assistant'); const input = page.getByLabel('AI 助手输入框', { exact: true }); await input.fill('existing draft'); await expect(page).toHaveURL(/conversation=/);
  let sends = 0; page.on('request', request => { if (request.method() === 'POST' && /\/api\/(?:ai-chat|orbit\/requests|orbit\/conversations\/[^/]+\/requests)$/.test(request.url())) sends++; });
  await page.getByRole('button', { name: '个人菜单', exact: true }).click(); await page.getByRole('menuitem', { name: '使用指南', exact: true }).or(page.getByRole('dialog', {name:'个人菜单',exact:true}).getByRole('button', { name: '使用指南', exact: true })).click();
  await page.getByRole('button', { name: '询问 AI：提醒与通知', exact: true }).click();
  await expect(input).toHaveValue(/^existing draft\n\nOrbit 的邮件/); expect(sends).toBe(0); await page.reload(); await expect(input).toHaveValue(/^existing draft\n\nOrbit 的邮件/); expect(sends).toBe(0);
});
test('report tabs retain ordinary mail drafts and clear the authorization code on tab exit', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(context, 'preview-guards'); await page.goto(base + '/settings/reports');
  await page.getByRole('tab', { name: '接收与邮件', exact: true }).click();
  await page.getByLabel('QQ 邮箱账号', { exact: true }).fill('synthetic-draft@qq.com');
  await page.getByLabel('客户端授权码', { exact: true }).fill('synthetic-code-only');
  await page.getByRole('tab', { name: '个性化', exact: true }).click(); await page.getByRole('tab', { name: '接收与邮件', exact: true }).click();
  await expect(page.getByLabel('QQ 邮箱账号', { exact: true })).toHaveValue('synthetic-draft@qq.com');
  await expect(page.getByLabel('客户端授权码', { exact: true })).toHaveValue('');
  await page.screenshot({ path: test.info().outputPath('settings-reports-draft-1440-light.png'), fullPage: true });
});
test('a different account never inherits the previous Settings workspace drafts', async ({ context, page }) => {
  await login(context, 'preview-guards'); await page.goto(base + '/settings/account/profile');
  await page.getByLabel('职业背景', { exact: true }).fill('account private draft');
  const other = await context.newPage(); await other.goto(base + '/settings/account');
  const token = await fixtureToken(context, 'preview-settings@example.invalid');
  await other.evaluate(value => localStorage.setItem('aicalendar_token', value), token);
  await expect(page.getByLabel('职业背景', { exact: true })).toHaveValue('');
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('link', { name: '账户与安全', exact: true }).click();
  await expect(page.getByText('preview-settings@example.invalid', { exact: true })).toBeVisible();
});
test('opening help before login resumes help after a real login', async ({ context, page }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(base + '/help');
  await page.getByPlaceholder('请输入邮箱地址').fill('preview-settings@example.invalid'); await page.getByPlaceholder('请输入密码', { exact: true }).fill('OrbitPreview123!');
  await page.locator('form').getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(base + '/help'); await expect(page.getByRole('heading', { level: 1, name: 'Orbit 使用指南', exact: true })).toBeVisible();
});
