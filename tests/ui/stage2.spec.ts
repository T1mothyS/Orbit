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


for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`stage2 C2 ${width} ${theme}: catalogue, reading, growth and report workspace`, async ({ context, page }) => {
    const token = await fixtureToken(context, 'preview@example.invalid');
    await context.addInitScript(({ token, theme }) => { localStorage.setItem('aicalendar_token', token); localStorage.setItem('theme', theme); }, { token, theme });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.setViewportSize({ width, height });
    const capture = async (name: string) => { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkVisual(page, `stage2-${name}-${width}-${theme}.png`, false, false); };
    await page.goto(base + '/library');
    await expect(page.locator('.library-card').first()).toBeVisible(); await expect(page.locator('.library-page')).toHaveAttribute('aria-busy', 'false');
    const heights = await page.locator('.library-card h2').evaluateAll(nodes => nodes.map(el => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) })));
    expect(heights.every(item => item.height <= 3 * item.line + 2)).toBe(true); await capture('library');
    if (width < 768) {
      await page.getByRole('button', { name: /^筛选/ }).click();
      const sheet = page.getByRole('dialog', { name: '知识库筛选', exact: true });
      await sheet.getByRole('combobox', { name: '筛选内容形态', exact: true }).click(); await page.getByRole('option', { name: '知识碎片', exact: true }).click();
      await capture('library-filter'); await sheet.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.locator('.library-card.article').first()).toBeVisible();
      await page.getByRole('button', { name: /^筛选/ }).click();
      await sheet.getByRole('combobox', { name: '筛选内容形态', exact: true }).click(); await page.getByRole('option', { name: '知识碎片', exact: true }).click();
      await sheet.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('.library-card.article')).toHaveCount(0);
    }
    await page.locator('.library-card-open').first().click(); await expect(page.locator('.library-document')).toBeVisible(); await capture('library-reader');
    await page.getByRole('button', { name: /返回知识库/, exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator('.library-card').first()).toBeVisible(); if (width < 768) await expect(page.locator('.library-card.article')).toHaveCount(0);
    await page.goto(base + '/reports'); await expect(page.locator('.daily-report-featured')).toBeVisible(); await capture('reports');
    await page.locator('.daily-report-featured-open').click(); await expect(page.locator('.daily-report-reader-markdown')).toBeVisible(); await capture('report-reader');
    await page.goto(base + '/project'); await expect(page.locator('.evolution-detail h2')).toBeVisible(); await capture('growth');
    await page.locator('#evolution-milestone').selectOption('retrieval'); await expect(page).toHaveURL(/milestone=retrieval/);
    await page.getByRole('button', { name: '架构演化', exact: true }).click(); await expect(page.locator('.evolution-node-list')).toBeVisible(); await capture('architecture');
    await page.locator('.evolution-node-list button').first().click(); await expect(page.locator('.evolution-node-detail h3')).toBeVisible();
    await page.goto(base + '/project?view=statistics'); await expect(page.getByRole('heading', { name: '执行趋势', exact: true })).toBeVisible(); await capture('statistics');
    const filters = page.locator('.activity-filter-controls'); await expect(filters).not.toHaveAttribute('open', '');
    await filters.locator('summary').click(); await page.getByRole('combobox', { name: '事项', exact: true }).click();
    const response = page.waitForResponse(response => response.url().includes('/api/orbit/statistics?') && response.url().includes('taskType=todo'));
    await page.getByRole('option', { name: '待办', exact: true }).click(); await response;
    await expect(page.getByRole('combobox', { name: '事项', exact: true })).toHaveText('待办');
    await page.getByRole('group', { name: '报告周期', exact: true }).getByRole('button', { name: '自定义', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请选择开始与结束时间；结束时刻不包含在范围内。');
    await capture('statistics-filters');
    await page.goto(base + '/library/experience'); await expect(page.getByRole('heading', { name: '记录经历', exact: true })).toBeVisible(); await capture('experience');
    await page.goto(base + '/research'); await expect(page.getByRole('heading', { name: '研究与观点', exact: true })).toBeVisible(); await capture('research-empty');
  });
}


for (const width of [390, 1440]) test(`stage2 C2 research ${width}: evidence before confirmation, failure and cancellation`, async ({ context, page }) => {
  const token = await fixtureToken(context, 'preview@example.invalid');
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  let failure = true, decisions = 0;
  const run = { id: 'synthetic-run', subjectKey: 'synthetic-subject', subjectTitle: '合成研究主题', question: '需要核对哪些证据？', status: 'completed', resultBody: '这是合成研究结果。'.repeat(40), eventRevisionId: 'synthetic-revision', createdAt: '2026-10-18T06:00:00Z' };
  const proposal = { id: 'synthetic-proposal', runId: run.id, subjectKey: run.subjectKey, body: '合成观点草稿，需要用户确认。', baseVersionId: null, status: 'draft', createdAt: run.createdAt };
  await page.route('**/api/research/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/decision')) { decisions++; return route.fulfill({ json: {} }); }
    if (path.includes('/theses/')) return route.fulfill(failure ? { status: 503, json: { error: '合成观点历史读取失败' } } : { json: { versions: [] } });
    if (path.endsWith('/runs')) return route.fulfill({ json: { runs: [run] } });
    if (path.endsWith('/proposals')) return route.fulfill({ json: { proposals: [proposal] } });
    return route.fulfill({ json: { context: { eventTitle: '合成事件证据', revisionNo: 1, evidence: [{ id: 'evidence', url: null, sourceFact: '待核对的事实', publisherKey: '合成来源', reviewState: 'unverified', publishedAt: null }] } } });
  });
  await page.setViewportSize({ width, height: 900 }); await page.goto(base + '/research');
  await page.getByRole('button', { name: '合成研究主题 待确认草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('合成观点历史读取失败');
  await expect(page.getByRole('button', { name: '确认观点', exact: true })).toBeDisabled();
  failure = false; await page.getByRole('button', { name: '合成研究主题 待确认草稿', exact: true }).click();
  await page.getByRole('button', { name: '合成研究主题 待确认草稿', exact: true }).click();
  await expect(page.getByText('合成事件证据 · 第 1 版', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认观点', exact: true })).toBeEnabled();
  await checkVisual(page, `stage2-research-review-${width}.png`, false, false);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '确认观点', exact: true }).click(); expect(decisions).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('stage2 C2 compact filters remain reachable in a low-height viewport', async ({ context, page }) => {
  const token = await fixtureToken(context, 'preview@example.invalid');
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
  await page.setViewportSize({ width: 430, height: 520 }); await page.goto(base + '/library');
  const trigger = page.getByRole('button', { name: /^筛选/ }); await trigger.click();
  const sheet = page.getByRole('dialog', { name: '知识库筛选', exact: true });
  await expect(sheet.getByRole('button', { name: '应用', exact: true })).toBeInViewport({ ratio: 1 });
  const sort = sheet.getByRole('combobox', { name: '知识库排序', exact: true }); await sort.click();
  await expect(page.getByRole('option', { name: '名称正序', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await sheet.getByRole('button', { name: '取消', exact: true }).click();
  await expect(trigger).toBeFocused();
});
