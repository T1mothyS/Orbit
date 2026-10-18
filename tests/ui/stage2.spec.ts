import { test, expect } from '@playwright/test';
import { fixtureToken } from './auth-fixture';
import { checkVisual } from './visual-check';

const base = 'http://127.0.0.1:4187';
test.describe.configure({ retries: 0 });
for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`stage2 C1 ${width} ${theme}: reachable help, navigation and search rows`, async ({ context, page }) => {
    const token = await fixtureToken(context, 'preview@example.invalid');
    await context.addInitScript(({ token, theme }) => { localStorage.setItem('aicalendar_token', token); localStorage.setItem('theme', theme); }, { token, theme });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.setViewportSize({ width, height });
    await page.goto(base + '/help');
    await expect(page.getByRole('heading', { name: 'Orbit 使用指南', exact: true })).toBeVisible();
    await checkVisual(page, `stage2-help-${width}-${theme}.png`, false, false);
    const frame = page.locator('.orbit-page-frame');
    await page.mouse.move(width / 2, height - 100); await page.mouse.wheel(0, 3000);
    await expect(page.getByRole('link', { name: '返回对话', exact: true })).toBeInViewport();
    await expect(page.getByRole('heading', { name: '账户与安全', exact: true })).toBeInViewport();
    expect(await frame.evaluate(el => el.scrollHeight > el.clientHeight ? el.scrollTop > 0 : true)).toBe(true);
    await page.getByRole('button', { name: '个人菜单', exact: true }).click();
    if (width < 768) {
      const sheet = page.getByRole('dialog', { name: '个人菜单', exact: true });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: '退出登录', exact: true }).scrollIntoViewIfNeeded();
      await expect(sheet.getByRole('button', { name: '退出登录', exact: true })).toBeInViewport();
      await checkVisual(page, `stage2-menu-${width}-${theme}.png`, false, false);
      await sheet.getByRole('button', { name: '关闭个人菜单', exact: true }).click();
    } else {
      const menu = page.getByRole('menu', { name: '个人菜单', exact: true });
      await expect(menu).toBeVisible();
      if (height >= 900) expect(await menu.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await checkVisual(page, `stage2-menu-${width}-${theme}.png`, false, false);
      await menu.press('Escape');
    }
    await expect(page.getByRole('button', { name: '个人菜单', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '打开全局搜索', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索事项、对话、记事、设置和报告', exact: true }).fill('合成');
    const rows = page.locator('.oui-action-row'); await expect(rows.first()).toBeVisible();
    expect(await rows.first().evaluate(el => getComputedStyle(el).textAlign)).toBe('start');
    await checkVisual(page, `stage2-search-${width}-${theme}.png`, false, false);
    await page.getByRole('button', { name: '关闭统一搜索', exact: true }).click();
    await page.goto(base + '/settings/reports');
    const field = page.getByLabel('偏好内容第1项', { exact: true }); await expect(field).toBeVisible();
    expect((await field.boundingBox())!.height).toBeLessThan(100);
    const remove = page.getByRole('button', { name: '移除偏好内容第1项', exact: true });
    expect((await remove.boundingBox())!.width).toBeGreaterThan(40);
    await checkVisual(page, `stage2-context-${width}-${theme}.png`, false, false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
