import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';
const base = 'http://127.0.0.1:4187';
// Mutating fixtures are not replayed against already changed credentials on retry.
test.describe.configure({ retries: 0 });
const policy = JSON.parse(fs.readFileSync(new URL('./visual-policy.json', import.meta.url), 'utf8')) as { accountApproved?: boolean };

async function login(context: BrowserContext, email = 'preview@example.invalid') {
  const result = await context.request.post(base + '/api/auth/login', { data: { email, password: 'OrbitPreview123!' } });
  expect(result.status()).toBe(200);
  const { token } = await result.json();
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return token as string;
}
async function account(page: Page, query = '') {
  await page.goto(base + '/settings/account' + query);
  await expect(page.getByRole('heading', { name: '账户与安全', exact: true })).toBeVisible();
}
async function password(page: Page, current = 'OrbitPreview123!', next = 'New Orbit password 123!') {
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByLabel('当前密码', { exact: true }).fill(current);
  await page.getByLabel('新密码', { exact: true }).fill(next);
  await page.getByLabel('确认新密码', { exact: true }).fill(next);
}
for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`account ${width} ${theme}: real page, forms and layout`, async ({ context, page }) => {
    await login(context); await page.setViewportSize({ width, height });
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (width >= 768) {
      await page.goto(base + '/settings');
      await expect(page).toHaveURL(base + '/settings/account');
      await expect(page.getByRole('heading', { name: '账户与安全', exact: true })).toBeVisible();
    } else await account(page);
    for (const state of ['normal', 'password']) {
      if (state === 'password') await page.getByRole('button', { name: '修改密码', exact: true }).click();
      await expect(page.getByText('preview@example.invalid', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const name = `account-${state}-${width}-${theme}.png`;
      if (policy.accountApproved) await expect(page).toHaveScreenshot(name, { fullPage: true });
      else await page.screenshot({ path: test.info().outputPath(name), fullPage: true, animations: 'disabled' });
    }
    if (width < 768) {
      for (const name of ['更新并重新登录', '取消', '退出当前登录']) {
        const button = page.getByRole('button', { name, exact: true });
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('password validation, incorrect current password and duplicate submission preserve safe state', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await context.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await login(context, 'preview-rate@example.invalid'); await account(page);
  await password(page, 'incorrect password');
  await page.getByLabel('确认新密码', { exact: true }).fill('mismatch');
  let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/auth/change-password')) writes++; });
  await page.getByRole('button', { name: '更新并重新登录' }).click();
  await expect(page.getByText('两次新密码不一致。', { exact: true })).toBeVisible(); expect(writes).toBe(0);
  await page.getByLabel('确认新密码', { exact: true }).fill('New Orbit password 123!');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/change-password', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: '更新并重新登录' }).click();
  await expect(page.getByRole('button', { name: '更新并重新登录' })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('account-password-saving-390-dark.png'), fullPage: true, animations: 'disabled' });
  await expect.poll(() => writes).toBe(1); release();
  await expect(page.getByText('当前密码不正确，请重新输入。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('当前密码', { exact: true })).toBeEmpty();
  await page.screenshot({ path: test.info().outputPath('account-password-error-390-dark.png'), fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('heading', { name: '账户与安全', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeFocused();
});

test('successful password change clears both tabs and accepts only the new password', async ({ context, page }) => {
  const token = await login(context, 'preview-security@example.invalid');
  await account(page); const other = await context.newPage(); await account(other);
  await password(page); await page.getByRole('button', { name: '更新并重新登录' }).click();
  await expect(page).toHaveURL(base + '/login');
  await expect(page.getByText('密码已更新，请使用新密码重新登录。', { exact: true })).toBeVisible();
  await expect(other.getByRole('heading', { name: '账户与安全', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('aicalendar_token'))).toBeNull();
  expect((await context.request.get(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  for (const item of [page, other]) expect(await item.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(key => /password/i.test(key)))).toBe(false);
  expect((await context.request.post(base + '/api/auth/login', { data: { email: 'preview-security@example.invalid', password: 'OrbitPreview123!' } })).status()).toBe(401);
  expect((await context.request.post(base + '/api/auth/login', { data: { email: 'preview-security@example.invalid', password: 'New Orbit password 123!' } })).status()).toBe(200);
});

test('avatar upload, failed removal, retry and cancellation are real account operations', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(context, 'preview-avatar@example.invalid'); await account(page);
  const invalidPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('上传或更换', { exact: true }).setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: invalidPng });
  await expect(page.getByText('图片无法读取，请更换图片后重试。', { exact: true })).toBeVisible();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#5977a0' } }).png().toBuffer();
  await page.getByLabel('上传或更换', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('头像已更新', { exact: true })).toBeVisible();
  await expect(page.locator('.settings-avatar-editor .oui-avatar img')).toBeVisible();
  const trigger = page.getByRole('region', { name: '账号信息', exact: true }).getByRole('button', { name: '恢复默认头像', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '恢复默认头像？', exact: true });
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.settings-avatar-editor .oui-avatar img')).toBeVisible();
  await page.route('**/api/orbit/profile/avatar', route => route.request().method() === 'DELETE' ? route.fulfill({ status: 503, json: { error: '合成头像移除失败，请重试。' } }) : route.continue());
  await trigger.click();
  await dialog.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('合成头像移除失败');
  await page.screenshot({ path: test.info().outputPath('account-avatar-error-dialog-1440-light.png'), animations: 'disabled' });
  await page.unroute('**/api/orbit/profile/avatar');
  await dialog.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.settings-avatar-editor .oui-avatar img')).toHaveCount(0);
});

test('old account deep links, mobile index and sensitive form cleanup remain navigable', async ({ context, page }) => {
  await login(context); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/assistant?settings=account-password');
  await expect(page).toHaveURL(base + '/settings/account?settings=account-password');
  await expect(page.getByLabel('当前密码', { exact: true })).toBeVisible();
  await page.getByLabel('当前密码', { exact: true }).fill('sensitive unsaved value');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '设置入口' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('account-index-390-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: '账户与安全 登录信息、头像与密码' }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByLabel('当前密码', { exact: true })).toBeEmpty();
  await page.reload(); await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeVisible();
});

test('a slow old auth response cannot restore a logged-out account', async ({ context, page }) => {
  await login(context); await account(page);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { reached = resolve; });
  await page.route('**/api/auth/me', async route => { const result = await route.fetch(); reached(); await gate; await route.fulfill({ response: result }); });
  await page.evaluate(() => dispatchEvent(new Event('focus'))); await waiting;
  await page.getByRole('button', { name: '退出当前登录', exact: true }).click();
  await page.getByRole('dialog', { name: '退出当前登录？', exact: true }).getByRole('button', { name: '退出登录', exact: true }).click();
  release(); await expect(page).toHaveURL(base + '/login');
  await expect(page.getByRole('heading', { name: '账户与安全', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('aicalendar_token'))).toBeNull();
});

test('account changes in another tab clear sensitive inputs and render the new identity', async ({ context, page }) => {
  await login(context); await account(page); await password(page);
  const other = await context.newPage(); await account(other);
  const result = await context.request.post(base + '/api/auth/login', { data: { email: 'empty@example.invalid', password: 'OrbitPreview123!' } });
  expect(result.status()).toBe(200); const { token } = await result.json();
  await other.evaluate(value => localStorage.setItem('aicalendar_token', value), token);
  await expect(page.getByText('empty@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: '修改登录密码', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByLabel('当前密码', { exact: true })).toBeEmpty();
  await expect(page.getByLabel('新密码', { exact: true })).toBeEmpty();
});

test('settings returns to its original work page with keyboard focus restored', async ({ context, page }) => {
  await login(context); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/schedule'); await page.locator('.account-menu > summary').click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('link', { name: '账户与安全 登录信息、头像与密码' }).click();
  await page.getByRole('link', { name: '返回 Orbit', exact: true }).click();
  await expect(page).toHaveURL(base + '/schedule');
  await expect(page.locator('.account-menu > summary')).toBeFocused();
  await page.goto(base + '/assistant');
  const composer = page.getByLabel('AI 助手输入框', { exact: true });
  await expect(composer).toBeVisible(); await page.waitForURL('**/assistant?conversation=*');
  await composer.fill('进入设置后仍应保留的未发送草稿');
  const origin = page.url();
  await page.locator('.account-menu > summary').click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('link', { name: '返回 Orbit', exact: true }).click();
  await expect(page).toHaveURL(origin); await expect(composer).toHaveValue('进入设置后仍应保留的未发送草稿');
});
