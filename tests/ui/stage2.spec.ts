import { test, expect, type Locator, type Page } from '@playwright/test';
import { fixtureToken } from './auth-fixture';
import { checkVisual } from './visual-check';

const base = 'http://127.0.0.1:4187';
test.describe.configure({ retries: 0 });

async function selectReminderOption(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByRole('combobox', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeInViewport({ ratio: 1 });
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`round3 reminder demo ${width} ${theme}: core fields fit and expanded settings scroll safely`, async ({ context, page }) => {
    test.setTimeout(60_000);
    const token = await fixtureToken(context, 'preview-guards@example.invalid');
    await context.addInitScript(({ token, theme }) => { localStorage.setItem('aicalendar_token', token); localStorage.setItem('theme', theme); }, { token, theme });
    await page.setViewportSize({ width, height }); await page.goto(base + '/reminders');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const trigger = page.getByRole('button', { name: '+ 新建提醒', exact: true }); await trigger.click();
    const dialog = page.getByRole('dialog', { name: '新建周期提醒', exact: true });
    const body = dialog.locator('.reminder-setup-body');
    await expect(dialog.getByLabel('任务名称', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'SIM 卡', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('button', { name: '生活事务', exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await expect(dialog.getByRole('button', { name: '信用卡', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const type of ['信用卡', 'SIM 卡', '生活事务']) {
      await dialog.getByRole('button', { name: type, exact: true }).click();
      await dialog.getByLabel('任务名称', { exact: true }).fill(type + '布局演示');
      if (type === 'SIM 卡') {
        await dialog.getByLabel('运营商', { exact: true }).fill('合成运营商');
        await dialog.getByLabel('号码（建议脱敏）', { exact: true }).fill('138****1234');
      }
      for (const frequency of type === '生活事务' ? ['once', 'monthly', 'yearly', 'interval'] : ['']) {
        if (frequency) await selectReminderOption(page, dialog, '周期类型', ({ once: '单次', monthly: '每月', yearly: '每年', interval: '固定间隔' } as Record<string, string>)[frequency]);
        expect(await body.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
        await expect(dialog.getByRole('button', { name: '创建提醒', exact: true })).toBeInViewport({ ratio: 1 });
        expect(await dialog.evaluate(element => {
          const top = element.querySelector('.modal-head')!.getBoundingClientRect().bottom;
          const bottom = element.querySelector('.modal-foot')!.getBoundingClientRect().top;
          return Array.from(element.querySelectorAll('input, select, [role="combobox"]')).filter(field => field.getClientRects().length && field.getAttribute('aria-hidden') !== 'true' && !field.closest('details:not([open])')).every(field => {
            const rect = field.getBoundingClientRect();
            return rect.top >= top && rect.bottom <= bottom && rect.left >= 0 && rect.right <= innerWidth;
          });
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await checkVisual(page, `round3-recurring-${type}-${width}-${theme}.png`, false, false);
    }
    const cyclePicker = dialog.getByRole('combobox', { name: '周期类型', exact: true });
    await cyclePicker.click(); await expect(page.getByRole('listbox')).toBeVisible(); await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0); await expect(dialog).toBeVisible(); await expect(cyclePicker).toBeFocused();
    await dialog.locator('.reminder-setup-more > summary').click();
    await dialog.getByLabel('提前提醒天数', { exact: true }).fill('30,7,0');
    await selectReminderOption(page, dialog, '优先级', '高');
    await dialog.locator('.reminder-setup-more > summary').click();
    await expect(dialog.locator('.reminder-setup-more > summary')).toContainText('30,7,0');
    await page.setViewportSize({ width, height: 420 });
    await dialog.locator('.reminder-setup-more > summary').click();
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(dialog.getByRole('button', { name: '关闭周期提醒编辑', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: '创建提醒', exact: true })).toBeInViewport({ ratio: 1 });
    await dialog.getByLabel('优先级', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('combobox', { name: '优先级', exact: true })).toContainText('高');
    page.once('dialog', native => native.dismiss()); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog.getByLabel('提前提醒天数', { exact: true })).toHaveValue('30,7,0');
    page.once('dialog', native => native.accept()); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); expect(errors).toEqual([]);
  });
}

for (const [type, label] of [['credit_card', '信用卡'], ['sim', 'SIM 卡'], ['generic', '生活事务']]) {
  test(`round3 reminder demo ${type}: real create and edit preserve folded configuration`, async ({ context, page }) => {
    const token = await fixtureToken(context, 'preview-guards@example.invalid'), headers = { Authorization: `Bearer ${token}` };
    await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/reminders');
    await page.getByRole('button', { name: '+ 新建提醒', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '新建周期提醒', exact: true });
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.getByLabel('任务名称', { exact: true }).fill('合成折叠保留 ' + type);
    await dialog.getByLabel('提醒时间', { exact: true }).fill('09:37');
    if (type === 'sim') {
      await dialog.getByLabel('运营商', { exact: true }).fill('合成运营商');
      await dialog.getByLabel('号码（建议脱敏）', { exact: true }).fill('138****9876');
    }
    if (type === 'generic') {
      await selectReminderOption(page, dialog, '周期类型', '固定间隔');
      await dialog.getByLabel('本期到期日', { exact: true }).fill('2030-01-15');
      await dialog.getByLabel('间隔', { exact: true }).fill('2');
      await selectReminderOption(page, dialog, '下一周期依据', '按实际完成日');
    }
    await dialog.locator('.reminder-setup-more > summary').click();
    await dialog.getByLabel('提前提醒天数', { exact: true }).fill('3,0');
    await selectReminderOption(page, dialog, '优先级', '高');
    if (type === 'sim') await dialog.getByLabel('国家/地区', { exact: true }).fill('合成地区');
    if (type !== 'credit_card') await dialog.getByLabel('建议操作', { exact: true }).fill('保留原有操作说明');
    if (type === 'generic') await selectReminderOption(page, dialog, '事务模板', '保险');
    await dialog.locator('.reminder-setup-more > summary').click();
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/cycle-reminders');
    await dialog.getByRole('button', { name: '创建提醒', exact: true }).click();
    const response = await created; expect(response.ok()).toBe(true); const { task } = await response.json();
    try {
      expect(task.type).toBe(type); expect(task.config.reminderTime).toBe('09:37'); expect(task.config.reminderOffsets).toEqual([3, 0]); expect(task.config.priority).toBe('high');
      await expect(dialog).toHaveCount(0); await page.goto(base + '/reminders?edit=' + encodeURIComponent(task.id));
      dialog = page.getByRole('dialog', { name: '编辑周期提醒', exact: true });
      await expect(dialog.locator('.reminder-setup-more')).not.toHaveAttribute('open');
      await expect(dialog.getByLabel('提醒时间', { exact: true })).toHaveValue('09:37');
      await dialog.getByLabel('任务名称', { exact: true }).fill('编辑后保留配置 ' + type);
      const patched = page.waitForResponse(item => item.request().method() === 'PATCH' && new URL(item.url()).pathname === '/api/cycle-reminders/' + task.id);
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click(); const updated = await patched; expect(updated.ok()).toBe(true);
      expect((await updated.json()).task.config).toEqual(task.config); await expect(dialog).toHaveCount(0);
    } finally { await context.request.delete(base + '/api/cycle-reminders/' + task.id, { headers }); }
  });
}

test('round3 reminder demo validation, failed save and pending save retain the form', async ({ context, page }) => {
  const token = await fixtureToken(context, 'preview-guards@example.invalid'), headers = { Authorization: `Bearer ${token}` };
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
  await page.goto(base + '/reminders'); await page.getByRole('button', { name: '+ 新建提醒', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建周期提醒', exact: true }); let calls = 0, release!: () => void, taskId = '';
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/cycle-reminders', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++; if (calls === 1) return route.fulfill({ status: 503, json: { error: '合成保存失败，请重试' } });
    await pending; const response = await route.fetch(); taskId = (await response.json()).task.id; await route.fulfill({ response });
  });
  try {
    const submit = dialog.getByRole('button', { name: '创建提醒', exact: true }); await submit.click(); expect(calls).toBe(0);
    await dialog.getByLabel('任务名称', { exact: true }).fill('合成失败保留'); await dialog.getByLabel('每月账单日', { exact: true }).fill('32');
    await submit.click(); expect(calls).toBe(0); await expect(dialog.getByLabel('每月账单日', { exact: true })).toBeFocused();
    await dialog.getByLabel('每月账单日', { exact: true }).fill('22'); await submit.click();
    await expect(dialog.getByRole('alert')).toContainText('合成保存失败'); await expect(dialog.getByLabel('任务名称', { exact: true })).toHaveValue('合成失败保留');
    await submit.click(); await expect(dialog.getByRole('button', { name: '保存中…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '关闭周期提醒编辑', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'SIM 卡', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); expect(calls).toBe(2);
    release(); await expect(dialog).toHaveCount(0);
  } finally { release(); if (taskId) await context.request.delete(base + '/api/cycle-reminders/' + taskId, { headers }); }
});

for (const [width,height] of [[430,520],[705,402]]) test(`stage2 C5 time picker fits ${width}x${height} without clipping or writing a draft`, async ({context,page})=>{
  const token=await fixtureToken(context,'preview-guards@example.invalid');await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);await page.setViewportSize({width,height});await page.goto(base+'/schedule');await page.getByRole('button',{name:'添加日程',exact:true}).click();
  const form=page.getByRole('dialog',{name:'新增日程',exact:true}),trigger=form.locator('.oui-time').first().getByRole('button').first();await trigger.scrollIntoViewIfNeeded();await trigger.click();
  const panel=form.getByRole('group',{name:'开始时间选择',exact:true});await expect(panel).toBeInViewport({ratio:1});await expect(form.getByLabel('开始时间：小时',{exact:true})).toBeFocused();await expect(panel.getByRole('button',{name:'确定',exact:true})).toBeInViewport({ratio:1});
  await checkVisual(page,`stage2-time-picker-${width}x${height}.png`,false,false);await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();await expect(form).toBeVisible();await page.getByRole('button',{name:'关闭日程编辑',exact:true}).click();
});

for (const width of [390,1440]) test(`stage2 C4 five standalone tools ${width}: keyboard, persistence, import/export and isolated scrolling`, async ({context,page}) => {
  test.setTimeout(60_000);
  const token=await fixtureToken(context,'preview@example.invalid');await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);
  await page.setViewportSize({width,height:width===390?844:900});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await checkVisual(page,`stage2-tool-${name}-${width}.png`,false,false);};
  await page.goto(base+'/tools/poker-tracker/');const card=page.getByRole('button',{name:'黑桃A',exact:true});await expect(card).toHaveAttribute('aria-pressed','false');await card.focus();await page.keyboard.press('Space');await expect(card).toHaveAttribute('aria-pressed','true');await expect(card).toBeFocused();await expect(page.locator('#progressCount')).toHaveText('1');
  const state=await page.evaluate(()=>localStorage.getItem('poker-tracker-v2'));const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toMatch(/\.json$/);const stream=await file.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(JSON.parse(state!));
  await page.reload();await expect(card).toHaveAttribute('aria-pressed','true');await capture('poker');
  const batch=page.getByRole('button',{name:'批量识别',exact:true});await batch.click();await expect(page.getByRole('dialog',{name:'批量识别导入',exact:true})).toBeVisible();await expect(page.getByLabel('批量牌面文字',{exact:true})).toBeFocused();await page.setViewportSize({width,height:520});await page.getByRole('button',{name:'关闭批量识别',exact:true}).scrollIntoViewIfNeeded();await checkVisual(page,`stage2-tool-poker-batch-${width}.png`,false,false);await page.keyboard.press('Escape');await expect(batch).toBeFocused();
  page.once('dialog',dialog=>dialog.accept());await page.locator('#importInput').setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(state!)});await expect(page.locator('#progressCount')).toHaveText('1');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('poker-tracker-v2')!))).toEqual(JSON.parse(state!));
  await page.setViewportSize({width,height:width===390?844:900});await page.goto(base+'/tools/pelican-bicycle/');const toggle=page.locator('#toggle');await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await page.locator('#speed').fill('1.5');await expect(page.locator('#rate')).toHaveText('1.5×');await capture('pelican');
  await page.goto(base+'/tools/evolution-slider/');await expect(page.locator('#strength')).toBeEnabled();await page.locator('#strength').focus();await page.keyboard.press('End');await expect(page.locator('#score')).toHaveText('+15.00');await expect(page.locator('[data-stage="5"]')).toHaveAttribute('aria-pressed','true');await page.locator('.reset').click();await expect(page.locator('#score')).toHaveText('−15.00');await capture('evolution');
  await page.goto(base+'/tools/codex-usage-dashboard-v3-1/');await expect(page.locator('#statusBadge')).toHaveText('DEMO');await expect(page.locator('#sumEntries')).not.toHaveText('—');await page.locator('[data-r="7"]').click();await expect(page.locator('[data-r="7"]')).toHaveClass(/active/);await page.locator('#statMetric').selectOption('outputTokens');await capture('usage');
  await page.goto(base+'/tools/alipay-growth-planner/');await expect(page.locator('#chart svg.main-svg').first()).toBeVisible({timeout:20_000});await expect(page.locator('#mMonthly')).not.toBeEmpty();await page.locator('#wealthAum').fill('30000');await page.getByRole('button',{name:'重新计算',exact:true}).click();await expect(page.locator('#statusBadge')).toContainText('30,000');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'保存参数',exact:true}).click();await page.reload();await expect(page.locator('#wealthAum')).toHaveValue('30000');await capture('alipay');
  const table=page.getByRole('region',{name:'成长值断点明细，可横向滚动',exact:true});await expect(table).toBeVisible();if(width===390)expect(await table.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
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
    await expect(page.locator('.orbit-help-page footer')).toBeInViewport();
    await expect(page.getByRole('link',{name:'返回今日行动中心',exact:true})).toHaveAttribute('href','/today');
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

test('stage2 C4 admin failures, rollback, confirmation cancellation and manual log filters', async ({context,page}) => {
  const token=await fixtureToken(context,'preview@example.invalid');
  await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);
  await page.setViewportSize({width:430,height:520});await page.goto(base+'/today');
  await page.getByRole('button',{name:'个人菜单',exact:true}).click();await page.getByRole('dialog',{name:'个人菜单',exact:true}).getByRole('button',{name:'管理面板',exact:true}).click();
  const admin=page.getByRole('dialog',{name:'管理面板',exact:true});
  await admin.getByRole('button',{name:'管理账户 empty@example.invalid',exact:true}).filter({visible:true}).click();
  const account=page.getByRole('dialog',{name:'empty@example.invalid · 账户管理',exact:true}),sharing=account.getByRole('switch',{name:'共享管理员 API',exact:true});
  let failSharing=true,sharingWrites=0,dangerWrites=0;
  await page.route('**/api/admin/users/preview-empty/api-share',route=>{sharingWrites++;return route.fulfill(failSharing?{status:503,json:{error:'合成共享更新失败'}}:{json:{enabled:true,adminApiAvailable:true}});});
  await page.route('**/api/admin/users/preview-empty',route=>{if(route.request().method()==='DELETE')dangerWrites++;return route.continue();});
  await page.route('**/api/admin/users/preview-empty/clear-data',route=>{dangerWrites++;return route.continue();});
  await sharing.click();await expect(account.getByRole('alert')).toContainText('合成共享更新失败');await expect(sharing).not.toBeChecked();
  failSharing=false;await sharing.click();await expect(sharing).toBeChecked();expect(sharingWrites).toBe(2);
  await account.locator('summary').click();for(const name of ['清空数据','删除用户']){page.once('dialog',dialog=>dialog.dismiss());await account.getByRole('button',{name,exact:true}).click();}expect(dangerWrites).toBe(0);
  await expect(account.getByRole('button',{name:'完成',exact:true})).toBeInViewport({ratio:1});await account.getByRole('button',{name:'完成',exact:true}).click();
  let failLogs=false,clears=0;const requests:string[]=[];
  await page.route('**/api/logs?**',route=>{requests.push(route.request().url());return route.fulfill(failLogs?{status:503,json:{error:'合成日志读取失败'}}:{json:{logs:[{timestamp:'2026-10-18T06:00:00Z',level:'info',category:'admin',message:'应保留的合成日志'}],total:1,max:2000}});});
  await page.route('**/api/logs',route=>{if(route.request().method()==='DELETE'){clears++;return route.fulfill({status:503,json:{error:'合成清空失败'}});}return route.continue();});
  await admin.getByRole('tab',{name:'调试日志',exact:true}).click();await expect(admin.getByText('应保留的合成日志',{exact:true})).toBeVisible();
  await admin.getByRole('switch',{name:'自动刷新日志',exact:true}).click();
  await admin.getByRole('combobox',{name:'日志级别筛选',exact:true}).click();await page.getByRole('option',{name:'错误',exact:true}).click();await expect.poll(()=>requests.some(url=>url.includes('level=error'))).toBe(true);
  failLogs=true;await admin.getByRole('button',{name:'刷新',exact:true}).click();await expect(admin.getByRole('alert')).toContainText('合成日志读取失败');await expect(admin.getByText('应保留的合成日志',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await admin.getByRole('button',{name:'清空',exact:true}).click();await expect(admin.getByRole('alert')).toContainText('合成清空失败');await expect(admin.getByText('应保留的合成日志',{exact:true})).toBeVisible();expect(clears).toBe(1);
  failLogs=false;await admin.getByRole('button',{name:'重试读取',exact:true}).click();await expect(admin.getByRole('alert')).toHaveCount(0);
});

test('stage2 C4 real login retry retains the protected tool destination; register errors never send mail', async ({context,page}) => {
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/login?next=%2Ftools%2Fpoker-tracker%2F');
  await page.getByLabel('邮箱',{exact:true}).fill('empty@example.invalid');await page.getByLabel('密码',{exact:true}).fill('incorrect password');await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('form [tabindex="-1"]')).toBeFocused();
  await page.getByLabel('密码',{exact:true}).fill('OrbitPreview123!');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(base+'/tools/poker-tracker/');await expect(page.locator('#cardGrid button')).toHaveCount(54);
  await page.evaluate(()=>localStorage.removeItem('aicalendar_token'));await context.clearCookies();await page.goto(base+'/login');await page.getByRole('tab',{name:'注册',exact:true}).click();
  let sends=0;await page.route('**/api/auth/send-register-code',route=>{sends++;return route.fulfill({status:503,json:{error:'合成发送失败'}});});
  await page.getByRole('button',{name:'获取验证码',exact:true}).click();await expect(page.getByRole('alert')).toContainText('请先填写邮箱、密码和邀请码');expect(sends).toBe(0);
});


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
    await page.getByRole('button', { name: '筛选与排序', exact: true }).click();
    const libraryFilters = page.getByRole('dialog', { name: '筛选与排序', exact: true });
    await libraryFilters.getByRole('combobox', { name: '筛选内容形态', exact: true }).click(); await page.getByRole('option', { name: '知识碎片', exact: true }).click();
    await expect(page.locator('.library-card.article')).toHaveCount(0); await capture('library-filter');
    await page.keyboard.press('Escape'); await expect(libraryFilters).toHaveCount(0);
    await page.locator('.library-card-open').first().click(); await expect(page.locator('.library-document')).toBeVisible(); await capture('library-reader');
    await page.getByRole('button', { name: /返回知识库/, exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator('.library-card').first()).toBeVisible(); await expect(page.locator('.library-card.article')).toHaveCount(0);
    await page.goto(base + '/reports'); await expect(page.locator('.daily-report-featured')).toBeVisible(); await capture('reports');
    await page.locator('.daily-report-featured-open').click(); await expect(page.locator('.daily-report-reader-markdown')).toBeVisible(); await capture('report-reader');
    await page.goto(base + '/project'); await expect(page.locator('.evolution-detail h2')).toBeVisible(); await capture('growth');
    await page.locator('#evolution-milestone').selectOption('retrieval'); await expect(page).toHaveURL(/milestone=retrieval/);
    await page.locator('#evolution-architecture').scrollIntoViewIfNeeded(); await expect(page.locator('.evolution-node-list')).toBeVisible(); await capture('architecture');
    await page.locator('.evolution-node-list button').first().click(); await expect(page.locator('.evolution-node-detail h3')).toBeVisible();
    await page.goto(base + '/project?view=statistics'); await expect(page.getByRole('heading', { name: '执行趋势', exact: true })).toBeVisible(); await capture('statistics');
    await expect(page.locator('.activity-filter-controls,.activity-date')).toHaveCount(0);
    await page.getByRole('group', { name: '报告周期', exact: true }).getByRole('button', { name: '自定义', exact: true }).click();
    await expect(page.getByRole('button',{name:'应用',exact:true})).toBeEnabled();
    await expect(page.locator('.activity-range-popover')).toBeInViewport({ratio:1});
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await expect(page.getByRole('heading',{name:'执行趋势',exact:true})).toBeVisible();
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
  const trigger = page.getByRole('button', { name: '筛选与排序', exact: true }); await trigger.click();
  const sheet = page.getByRole('dialog', { name: '筛选与排序', exact: true });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await sheet.getByRole('button', { name: '重置', exact: true }).scrollIntoViewIfNeeded();
  await expect(sheet.getByRole('button', { name: '重置', exact: true })).toBeInViewport({ ratio: 1 });
  const sort = sheet.getByRole('combobox', { name: '知识库排序', exact: true }); await sort.click();
  await expect(page.getByRole('option', { name: '名称正序', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});


for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
  test(`stage2 C3 ${width} ${theme}: task actions, secondary menus and nested editor`, async ({ context, page }) => {
    const token = await fixtureToken(context, 'preview@example.invalid');
    await context.addInitScript(({token, theme}) => { localStorage.setItem('aicalendar_token', token); localStorage.setItem('theme', theme); }, {token, theme});
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.setViewportSize({width, height}); await page.goto(base + '/today');
    const first = page.locator('.action-row--task').first(); await expect(first).toBeVisible();
    expect(await first.locator('button button').count()).toBe(0); expect(await first.getByRole('button').count()).toBe(3);
    await checkVisual(page, `stage2-today-${width}-${theme}.png`, false, false);
    const menu = first.getByRole('button', {name: /打开 .* 的更多操作/}); await menu.click();
    await expect(page.getByRole('menuitem', {name:'编辑', exact:true})).toBeVisible();
    await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
    const trigger = page.getByRole('button', {name:'查看全部挂起待办', exact:true}); await trigger.click();
    const drawer = page.getByRole('dialog', {name:'无固定期限待办', exact:true});
    await expect(drawer.locator('article').first()).toBeVisible();
    await checkVisual(page, `stage2-unscheduled-${width}-${theme}.png`, false, false);
    await drawer.locator('.oui-action-row').first().click(); await expect(drawer.locator('.unscheduled-details')).toBeVisible();
    await drawer.getByRole('combobox', {name:'状态',exact:true}).click(); await page.getByRole('option', {name:/^已完成/}).click();
    await expect(drawer.locator('article').first()).toBeVisible();
    await drawer.locator('article').first().getByRole('button', {name:/更多操作：/}).click();
    await page.getByRole('menuitem', {name:'编辑',exact:true}).click();
    await expect(page.getByLabel('日程标题', {exact:true})).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', {name:'关闭日程编辑',exact:true}).click();
    await expect(page.getByLabel('日程标题', {exact:true})).toHaveCount(0); await expect(drawer).toBeVisible();
    await drawer.getByRole('button', {name:'关闭',exact:true}).click(); await expect(trigger).toBeFocused();
    await page.goto(base + '/reminders'); await page.getByRole('button', {name:'+ 新建提醒',exact:true}).click();
    await expect(page.getByRole('dialog', {name:'新建周期提醒',exact:true})).toBeVisible();
    await checkVisual(page, `stage2-recurring-form-${width}-${theme}.png`, false, false);
    await page.getByRole('button', {name:'关闭周期提醒编辑',exact:true}).click();
    await page.goto(base + '/assistant'); await expect(page.getByLabel('AI 助手输入框',{exact:true})).toBeVisible();
    await checkVisual(page, `stage2-chat-${width}-${theme}.png`, false, false);
    await page.getByRole('button',{name:'打开 AI 记事板',exact:true}).click(); await expect(page.locator('#orbit-note-connected-note')).toBeVisible();
    await checkVisual(page, `stage2-notes-${width}-${theme}.png`, false, false); if(width<1100) await page.getByRole('button',{name:'关闭记事板',exact:true}).click(); else await page.getByRole('button',{name:'打开 AI 记事板',exact:true}).click();
    await page.getByRole('button',{name:'个人菜单',exact:true}).click();
    await page.getByRole('menuitem',{name:'邮箱导入',exact:true}).or(page.getByRole('dialog',{name:'个人菜单',exact:true}).getByRole('button',{name:'邮箱导入',exact:true})).click();
    await expect(page.getByRole('heading',{name:'邮箱导入',exact:true})).toBeVisible(); await checkVisual(page, `stage2-email-${width}-${theme}.png`, false, false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test('stage2 C3 completion errors retain a task, retry/reopen and deletion cancellation are real isolated operations', async ({context, page}) => {
  const token = await fixtureToken(context, 'preview-guards@example.invalid'), headers = {Authorization:`Bearer ${token}`};
  await context.addInitScript(value => localStorage.setItem('aicalendar_token',value), token);
  const title = 'C3 完成与重开合成待办';
  const created = await context.request.post(base + '/api/schedules', {headers, data:{title,type:'todo',is_unscheduled:true,start_time:'2020-01-01T09:00:00',calendar_id:'personal',priority:'medium',category:'other'}});
  expect(created.ok()).toBe(true); const id = (await created.json()).schedule.id;
  await page.setViewportSize({width:430,height:520}); await page.goto(base + '/today');
  await page.getByRole('button',{name:'查看全部挂起待办',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'无固定期限待办',exact:true});
  await expect(drawer.getByRole('button',{name:'关闭',exact:true})).toBeInViewport({ratio:1});
  let failure=true, writes=0;
  await page.route(`**/api/schedules/${id}/toggle`, route => {writes++;return failure?route.fulfill({status:503,json:{error:'合成更新失败'}}):route.continue();});
  const complete=drawer.getByRole('button',{name:'标记完成：'+title,exact:true}); await complete.click();
  await expect(drawer.getByRole('alert')).toContainText('合成更新失败'); await expect(complete).toBeVisible();
  failure=false; await complete.click(); const reopen=drawer.getByRole('button',{name:'设为未完成：'+title,exact:true}); await expect(reopen).toBeVisible();
  await reopen.click(); await expect(complete).toBeVisible(); expect(writes).toBe(3);
  await drawer.getByRole('button',{name:'更多操作：'+title,exact:true}).click(); page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('menuitem',{name:'删除',exact:true}).click();
  expect((await context.request.get(base + '/api/schedules/'+id,{headers})).ok()).toBe(true);
  await drawer.getByRole('button',{name:'关闭',exact:true}).click();
  await context.request.delete(base + '/api/schedules/'+id,{headers});
});

test('stage2 C3 recurring long form keeps drafts and close protection at low height', async ({context,page}) => {
  const token=await fixtureToken(context,'preview@example.invalid');await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);
  await page.setViewportSize({width:430,height:520});await page.goto(base+'/reminders');await page.getByRole('button',{name:'+ 新建提醒',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建周期提醒',exact:true});await dialog.getByLabel('任务名称',{exact:true}).fill('保留的长表单草稿');
  await dialog.getByRole('button',{name:'生活事务',exact:true}).click();
  const submit=dialog.getByRole('button',{name:'创建提醒',exact:true});await submit.scrollIntoViewIfNeeded();await expect(submit).toBeInViewport({ratio:1});
  page.once('dialog',native=>native.dismiss());await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog.getByLabel('任务名称',{exact:true})).toHaveValue('保留的长表单草稿');
  page.once('dialog',native=>native.accept());await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toHaveCount(0);
});


test('stage2 C3 configured email keeps guidance optional and a failed confirmation preserves the draft', async ({context,page}) => {
  const token=await fixtureToken(context,'preview@example.invalid');await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);
  const draft={kind:'schedule',title:'合成邮箱草稿',dueDate:'2026-10-20',dueTime:'09:00',templateKey:'custom',recurrence:{frequency:'once',interval:1,unit:'day',advancePolicy:'calendar'},reminderOffsets:[1],actionGuide:'核对后处理',notes:'',confidence:{},warnings:[]};
  await page.route('**/api/email-import/settings',route=>route.fulfill({json:{setting:{enabled:true,importToken:'synthetic-layout-only'},imapConfigured:true}}));
  await page.route('**/api/ai/imports?*',route=>route.fulfill({json:{imports:[{id:'synthetic-email',status:'draft',draft,expiresAt:'2026-10-19T00:00:00Z'}]}}));
  let attempts=0,failure=true;
  await page.route('**/api/ai/imports/synthetic-email/confirm',route=>{attempts++;expect(route.request().postDataJSON().draft.title).toBe('核对后的合成标题');return route.fulfill(failure?{status:503,json:{error:'合成确认失败'}}:{json:{success:true}});});
  await page.setViewportSize({width:430,height:932});await page.goto(base+'/assistant?tool=email-import');
  await expect(page.getByText('IMAP 已配置',{exact:true})).toBeVisible();await expect(page.locator('.ai-import-tutorial')).not.toHaveAttribute('open','');
  await page.locator('.ai-import-tutorial > summary').click();await expect(page.getByText('打开下方的邮箱导入开关。',{exact:true})).toBeVisible();await page.locator('.ai-import-tutorial > summary').click();
  await page.getByRole('button',{name:/^合成邮箱草稿/}).click();await page.getByLabel('标题',{exact:true}).fill('核对后的合成标题');expect(attempts).toBe(0);
  await checkVisual(page,'stage2-email-configured-draft-430-light.png',false,false);
  await page.getByRole('button',{name:'确认并创建',exact:true}).click();await expect(page.getByRole('alert')).toContainText('合成确认失败');await expect(page.getByLabel('标题',{exact:true})).toHaveValue('核对后的合成标题');
  failure=false;await page.getByRole('button',{name:'确认并创建',exact:true}).click();await expect(page.getByText('待办日程已创建',{exact:true})).toBeVisible();expect(attempts).toBe(2);
});


for (const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]]) for (const theme of ['light','dark']) {
  test(`stage2 C4 ${width} ${theme}: authentication, calendar views, administration and tools`, async ({context,page}) => {
    await context.addInitScript(value=>localStorage.setItem('theme',value),theme);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await checkVisual(page,`stage2-${name}-${width}-${theme}.png`,false,false);};
    await page.goto(base+'/login');await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    await expect.poll(()=>page.locator('form button[type=submit]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(theme==='dark'?'rgb(52, 79, 120)':'rgb(37, 99, 235)');await capture('login');
    await page.getByRole('tab',{name:'注册',exact:true}).click();await expect(page.getByLabel('确认密码',{exact:true})).toBeVisible();await capture('register');
    await page.getByRole('button',{name:'完成注册',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'完成注册',exact:true})).toBeInViewport({ratio:1});
    const token=await fixtureToken(context,'preview@example.invalid');await context.addInitScript(value=>localStorage.setItem('aicalendar_token',value),token);
    await page.goto(base+'/schedule');await expect(page.getByRole('group',{name:'日历视图',exact:true})).toBeVisible();
    for(const [label,key] of [['日程','agenda'],['日','day'],['周','week'],['月','month']]){const button=page.getByRole('button',{name:`切换到${label}视图`,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('.calendar-content-'+key)).toBeVisible();await capture('calendar-'+key);}
    await page.getByRole('button',{name:'切换到日程视图',exact:true}).click();const card=page.locator('.agenda-view [data-schedule-id]').first();await expect(card).toBeVisible();await card.focus();await page.keyboard.press('Shift+F10');
    const menu=page.getByRole('menu',{name:/的日程操作$/});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem').first()).toBeFocused();await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'删除日程',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(card).toBeFocused();
    await page.getByRole('button',{name:'添加日程',exact:true}).click();await expect(page.getByLabel('日程标题',{exact:true})).toBeVisible();await capture('calendar-form');await page.getByRole('button',{name:'关闭日程编辑',exact:true}).click();
    await page.getByRole('button',{name:'个人菜单',exact:true}).click();await page.getByRole('menuitem',{name:'管理面板',exact:true}).or(page.getByRole('dialog',{name:'个人菜单',exact:true}).getByRole('button',{name:'管理面板',exact:true})).click();
    const admin=page.getByRole('dialog',{name:'管理面板',exact:true}),manage=admin.getByRole('button',{name:'管理账户 preview@example.invalid',exact:true}).filter({visible:true});await expect(manage).toBeEnabled();await capture('admin-users');
    await manage.click();const detail=page.getByRole('dialog',{name:'preview@example.invalid · 账户管理',exact:true});await expect(detail.getByRole('combobox',{name:'账户角色',exact:true})).toBeDisabled();await detail.locator('summary').click();await expect(detail.getByRole('button',{name:'删除用户',exact:true})).toBeDisabled();await capture('admin-account');await detail.getByRole('button',{name:'完成',exact:true}).click();await expect(manage).toBeFocused();
    await admin.getByRole('tab',{name:'邀请码',exact:true}).click();await expect(admin.getByRole('heading',{name:'邀请码管理',exact:true})).toBeVisible();await capture('admin-invites');
    await admin.getByRole('tab',{name:'调试日志',exact:true}).click();await expect(admin.getByRole('combobox',{name:'日志级别筛选',exact:true})).toBeVisible();await expect(admin.getByText('正在读取日志…',{exact:true})).toHaveCount(0);await capture('admin-logs');await page.getByRole('button',{name:'关闭管理面板',exact:true}).click();
    await page.goto(base+'/tools');await expect(page.locator('[data-tool-slug]')).toHaveCount(5);await capture('tools');expect(errors).toEqual([]);
  });
}
