import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

test('shared shell navigation and account menu expose selection, metadata and keyboard behavior without API calls', async ({ page }) => {
  const calls: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request.url()); });
  await page.goto('/dev/ui?demo=shell');
  await page.getByRole('button', { name: '设置示例', exact: true }).click(); await expect(page.getByRole('button', { name: '设置示例', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '打开账户示例', exact: true }).click(); await expect(page.getByText('demo@example.invalid', { exact: true })).toBeVisible(); await expect(page.getByText('Orbit 开发示例', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '打开账户示例', exact: true })).toBeFocused(); expect(calls).toEqual([]);
});
const visualPolicy = JSON.parse(fs.readFileSync(new URL('./visual-policy.json', import.meta.url), 'utf8')) as { galleryApproved: boolean };

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4196' ? route.continue() : route.abort());
});
async function open(page: Page, view = 'controls') {
  await page.goto(`/dev/ui?view=${view}`);
  await expect(page.locator('[data-ui-gallery=orbit]')).toBeVisible();
}
for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
  for (const theme of ['light', 'dark']) {
    test(`${width} ${theme}: all gallery surfaces fit and expose required states`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors: string[] = [], apiCalls: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
      for (const view of ['controls', 'surfaces', 'overlays']) {
        await open(page, view);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('h1')).toBeVisible();
        const name = `gallery-${view}-${width}-${theme}.png`;
        // Checkpoint captures are candidates. Comparison becomes blocking only after approval.
        if (visualPolicy.galleryApproved || process.env.ORBIT_UI_VISUAL === 'compare') await expect(page).toHaveScreenshot(name, { fullPage: true });
        else await page.screenshot({ path: test.info().outputPath(name), fullPage: true, animations: 'disabled' });
      }
      expect(errors).toEqual([]);
      expect(apiCalls).toEqual([]);
    });
  }
}

test('password visibility, select keyboard, checkbox and switch are operable', async ({ page }) => {
  await open(page);
  await page.getByLabel('新密码', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '显示新密码', exact: true }).click();
  await expect(page.getByLabel('新密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏新密码', exact: true }).click();
  await expect(page.getByLabel('新密码', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('combobox', { name: '提醒渠道' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: '邮件提醒', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '提醒渠道' })).toContainText('邮件提醒');
  await page.getByRole('switch', { name: '示例站内通知', exact: true }).click();
  await expect(page.getByRole('switch', { name: '示例站内通知', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('checkbox', { name: '接收示例摘要' }).click();
  await expect(page.getByRole('checkbox', { name: '接收示例摘要' })).not.toBeChecked();
});

for (const width of [390, 1440]) {
  test(`${width}: overlay focus, return, menus and tabs`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, 'overlays');
    const trigger = page.getByRole('button', { name: '打开 Dialog', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '编辑显示名称', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '关闭编辑显示名称' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.getByRole('button', { name: '打开 Sheet', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '提醒偏好', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '提醒偏好', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '打开示例菜单' }).click();
    await expect(page.getByRole('menu', { name: '示例操作' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '打开示例菜单' })).toBeFocused();
    await page.getByRole('tab', { name: '个人资料' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '阅读偏好' })).toHaveAttribute('aria-selected', 'true');
  });
}

test('reduced motion, actionable error and feedback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'surfaces');
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(page.getByText('已重新读取示例设置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭操作反馈' }).click();
  await expect(page.getByText('已重新读取示例设置', { exact: true })).toBeHidden();
  expect(await page.locator('.oui-spinner').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('essential text contrast and low-height sheet actions remain usable', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await open(page);
    const ratios = await page.evaluate(() => {
      const rgb = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (color: string) => rgb(color).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const ratio = (foreground: string, background: string) => { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      const primary = getComputedStyle(document.querySelector('.oui-button--primary')!);
      const input = document.querySelector('#gallery-password')!;
      const placeholder = getComputedStyle(input, '::placeholder');
      return { primary: ratio(primary.color, primary.backgroundColor), placeholder: ratio(placeholder.color, getComputedStyle(input).backgroundColor) };
    });
    expect(ratios.primary).toBeGreaterThanOrEqual(4.5);
    expect(ratios.placeholder).toBeGreaterThanOrEqual(4.5);
  }
  await page.setViewportSize({ width: 390, height: 480 });
  await open(page, 'overlays');
  await page.getByRole('button', { name: '打开 Sheet', exact: true }).click();
  const save = page.getByRole('dialog', { name: '提醒偏好', exact: true }).getByRole('button', { name: '保存偏好' });
  await expect(save).toBeInViewport({ ratio: 1 });
  const box = await save.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
});

test('file selection feedback stays local and text navigation uses the shared link', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url()); });
  await open(page, 'surfaces');
  await page.getByLabel('选择示例图片', { exact: true }).setInputFiles({ name: 'local-example.png', mimeType: 'image/png', buffer: Buffer.from('local fixture, never uploaded') });
  await expect(page.getByText('已选择 local-example.png；示例不会上传文件。', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回控件示例', exact: true }).click();
  await expect(page.getByRole('heading', { name: '控件与表单', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
