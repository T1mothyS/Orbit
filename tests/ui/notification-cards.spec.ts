import { test, expect } from '@playwright/test';
import { fixtureToken } from './auth-fixture';
import { settingAction } from '../../src/utils/navigation-actions';
const base = 'http://127.0.0.1:4187';
const frozenItem = { id:'schedule:connected-fixture-1', sourceType:'schedule', sourceId:'connected-fixture-1', instanceId:null, scheduleId:'connected-fixture-1', type:'event', title:'推送时保存的事项标题', startTime:'2026-11-09T09:30:00', endTime:null, dueDate:null, allDay:false, completed:false, current:{available:true, completed:false, editable:true, scheduleId:'connected-fixture-1', href:'/schedule?schedule=connected-fixture-1'} };
const recurring = { ...frozenItem, id:'reminder:synthetic', type:'reminder', title:'提前三天提醒的周期报表', startTime:'2026-11-09T02:00:00Z', dueDate:'2026-11-12', current:{...frozenItem.current, editable:false, scheduleId:null, href:'/reminders'} };
const weekly = {reportId:'synthetic-weekly', start:'2026-11-02', end:'2026-11-08', timezone:'Asia/Shanghai', completed:9,created:4,notes:7,overdue:0,backlog:2, completedItems:Array.from({length:9},(_,i)=>({id:'done-'+i,title:i===0?'一个用于检验长标题完整换行且不遮挡日期的合成工作事项'.repeat(3):'合成完成事项 '+i,date:'2026-11-07T03:59:31Z',href:null})),pendingItems:[],upcoming:[],insights:[]};
test('daily completion writes the selected schedule or cycle and preserves the frozen snapshot', async ({page,context}) => {
  const token=await fixtureToken(context,'preview-guards@example.invalid'),headers={Authorization:'Bearer '+token};
  await context.addInitScript(token=>localStorage.setItem('aicalendar_token',token),token);
  const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  const created=await context.request.post(base+'/api/schedules',{headers,data:{title:'勾选验证日程',type:'event',start_time:date+'T10:00:00',calendar_id:'personal',priority:'medium',category:'other'}});
  expect(created.ok()).toBe(true);const schedule=(await created.json()).schedule;
  const reminder=await context.request.post(base+'/api/cycle-reminders',{headers,data:{type:'generic',name:'勾选验证周期',config:{templateKey:'custom',rule:{frequency:'monthly',anchorDate:date,advancePolicy:'calendar'},reminderOffsets:[0],reminderTime:'10:00',actionGuide:'',priority:'medium'}}});
  expect(reminder.ok()).toBe(true);const task=(await reminder.json()).task,cycle=task.currentCycle;
  const items=[{...frozenItem,id:'schedule:'+schedule.id,sourceId:schedule.id,scheduleId:schedule.id,title:schedule.title,current:{...frozenItem.current,scheduleId:schedule.id}},
    {...recurring,id:'reminder:'+cycle.id,sourceType:'reminder',sourceId:task.id,instanceId:cycle.id,title:task.name,current:{...recurring.current,editable:true}}];
  await page.route('**/api/ai-schedule/history?*',async route=>{
    const current=(await (await context.request.get(base+'/api/schedules/'+schedule.id,{headers})).json()).schedule;
    const currentItems=items.map(item=>item.sourceType==='schedule'?{...item,current:{...item.current,completed:current.is_completed}}:item);
    await route.fulfill({json:{messages:[{id:'completion-card',role:'assistant',type:'text',text:'',timestamp:new Date().toISOString(),orbitMeta:{origin:'notification',dailyAction:{date,schemaVersion:1,timezone:'Asia/Shanghai',weather:{state:'unconfigured'},items:currentItems}}}],requests:[],nextBefore:null}});
  });
  await page.route('**/api/action-center/daily-action?*',route=>route.fulfill({json:{date,timezone:'Asia/Shanghai',capturedAt:new Date().toISOString(),items:[]}}));
  try {
    await page.goto(base+'/assistant');const card=page.getByRole('region',{name:'今日行动提醒',exact:true});
    await card.getByRole('button',{name:'查看今日最新',exact:true}).click();
    await card.getByRole('button',{name:'返回今日快照',exact:true}).click();
    let fail=true,calls=0;
    await page.route(`**/api/schedules/${schedule.id}/toggle`,route=>{calls++;return fail?route.fulfill({status:503,json:{error:'合成写入失败'}}):route.continue();});
    await card.getByRole('button',{name:'完成日程：勾选验证日程',exact:true}).click();
    await expect(card.getByRole('alert')).toHaveText('合成写入失败');
    expect((await (await context.request.get(base+'/api/schedules/'+schedule.id,{headers})).json()).schedule.is_completed).toBe(false);
    fail=false;await card.getByRole('button',{name:'完成日程：勾选验证日程',exact:true}).click();
    await expect(card.getByRole('button',{name:'恢复日程：勾选验证日程',exact:true})).toHaveAttribute('aria-pressed','true');
    expect((await (await context.request.get(base+'/api/schedules/'+schedule.id,{headers})).json()).schedule.is_completed).toBe(true);
    await card.getByRole('button',{name:'恢复日程：勾选验证日程',exact:true}).click();
    await expect(card.getByRole('button',{name:'完成日程：勾选验证日程',exact:true})).toHaveAttribute('aria-pressed','false');expect(calls).toBe(3);
    await card.getByRole('button',{name:'完成日程：勾选验证日程',exact:true}).click();
    await expect(card.getByRole('button',{name:'恢复日程：勾选验证日程',exact:true})).toHaveAttribute('aria-pressed','true');
    await context.request.post(base+'/api/schedules/'+schedule.id+'/toggle',{headers,data:{completed:false}});
    await card.getByRole('button',{name:'完成周期事务：勾选验证周期',exact:true}).click();
    await expect(card.getByRole('button',{name:'已完成周期事务：勾选验证周期',exact:true})).toBeDisabled();
    const tasks=(await (await context.request.get(base+'/api/cycle-reminders',{headers})).json()).tasks;
    const updated=tasks.find((item:any)=>item.id===task.id);expect(updated.currentCycle.id).not.toBe(cycle.id);expect(updated.currentCycle.status).toBe('pending');
    await expect(card.getByRole('button',{name:'完成日程：勾选验证日程',exact:true})).toHaveAttribute('aria-pressed','false');
    await expect(card).toContainText('2 项待处理'); // 推送时事实不随当前完成状态改写。
  } finally {
    await context.request.delete(base+'/api/schedules/'+schedule.id,{headers});
    await context.request.delete(base+'/api/cycle-reminders/'+task.id,{headers});
  }
});
for (const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]]) for (const theme of ['light','dark']) {
  test(`notification cards ${width} ${theme}: frozen/latest, original editor, weekly report`, async ({page,context}, testInfo) => {
    const token=await fixtureToken(context,'preview@example.invalid');
    await context.addInitScript(({token,theme})=>{localStorage.setItem('aicalendar_token',token);localStorage.setItem('theme',theme);},{token,theme});
    await page.setViewportSize({width,height});
    let failLatest=false;
    const meta={origin:'notification', dailyAction:{date:'2026-11-09',schemaVersion:1,capturedAt:'2026-11-08T23:00:00Z',timezone:'Asia/Shanghai',weather:{state:'available',place:'合成城市',description:'晴',code:1,low:2,high:13,rain:0,cached:false},items:[frozenItem,recurring]}};
    const history=[{id:'daily-card',role:'assistant',type:'text',text:'RAW_DAILY',timestamp:'2026-11-09T07:00:00',orbitMeta:meta},{id:'weekly-card',role:'assistant',type:'text',text:'RAW_WEEKLY',timestamp:'2026-11-08T20:00:00',orbitMeta:{origin:'notification',weeklyReport:weekly}}];
    history.push({id:'shortcut-card',role:'assistant',type:'text',text:'设置快捷入口',timestamp:'2026-11-09T07:00:00',orbitMeta:{actions:['settings-daily-report','settings-library','library-personal-preferences','setting-notifications-1q1t6v5'].map(id=>settingAction(id)!)} } as any);
    await page.route('**/api/ai-schedule/history?*',route=>route.fulfill({json:{messages:history,requests:[],nextBefore:null}}));
    await page.route('**/api/action-center/daily-action?*',route=>route.fulfill(failLatest?{status:503,json:{error:'今日事项读取失败'}}:{json:{date:'2026-11-09',timezone:'Asia/Shanghai',capturedAt:'2026-11-09T08:00:00Z',items:[{...frozenItem,title:'稍后新增的事项'}]}}));
    const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/assistant');
    const card=page.getByRole('region',{name:'今日行动提醒',exact:true});
    await expect(card).toContainText('推送时快照');
    await expect(card.locator('.orbit-daily-completion-ring').first()).toBeVisible();
    await expect(card.locator('.orbit-daily-completion-ring svg')).toHaveCount(2);
    await expect(card).toContainText('2026-11-12 到期');
    await expect(card.getByRole('group',{name:'提醒内容版本'})).toHaveCount(0);
    await expect(page.getByText('RAW_WEEKLY',{exact:true})).toHaveCount(0);
    await card.getByRole('button',{name:'推送时保存的事项标题',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox',{name:'日程标题',exact:true})).toHaveValue('合成事项 1');
    await expect(dialog).toContainText('编辑');
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    failLatest=true; await card.getByRole('button',{name:'查看今日最新',exact:true}).click();
    await expect(card.getByRole('alert')).toHaveText('今日事项读取失败');
    await expect(card).toContainText('推送时保存的事项标题');
    failLatest=false; await card.getByRole('button',{name:'查看今日最新',exact:true}).click();
    await expect(card).toContainText('稍后新增的事项');
    await expect(card).not.toContainText('推送时保存的事项标题');
    await card.getByRole('button',{name:'返回今日快照',exact:true}).click();
    await expect(card).toContainText('推送时保存的事项标题');
    await expect(card).not.toContainText('稍后新增的事项');
    await card.screenshot({path:testInfo.outputPath(`daily-${width}-${theme}.png`)});
    const report=page.getByRole('region',{name:'每周个人活动报告',exact:true});
    await expect(report).toContainText('11月2日 — 11月8日');
    await expect(report.locator('.orbit-weekly-day li')).toHaveCount(4);
    await report.screenshot({path:testInfo.outputPath(`weekly-${width}-${theme}.png`)});
    await report.getByRole('button',{name:'展开全部 9 项',exact:true}).click();
    await expect(report.locator('.orbit-weekly-day li')).toHaveCount(9);
    await expect(report).not.toContainText('2026-11-07T');
    await expect(report.getByRole('link',{name:'查看完整报告'})).toHaveAttribute('href','/project?view=statistics&report=synthetic-weekly');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const shortcuts=page.locator('.orbit-setting-shortcuts');
    await expect(shortcuts.getByRole('link')).toHaveCount(4);await expect(shortcuts.locator('svg')).toHaveCount(4);
    await expect(shortcuts.getByRole('link',{name:'打开日报设置',exact:true})).toHaveAttribute('href',/settings\/reports/);
    const colors=await shortcuts.getByRole('link').evaluateAll(links=>links.map(link=>getComputedStyle(link).color));expect(new Set(colors).size).toBe(4);
    await shortcuts.screenshot({path:testInfo.outputPath(`shortcuts-${width}-${theme}.png`)});
    await page.goto(base+'/settings/advanced');
    for(const label of ['打开邮箱导入','打开记录经历','打开研究与观点']) {
      const link=page.getByRole('link',{name:label,exact:true});await expect(link).toBeVisible();await expect(link).toHaveText('');await expect(link.locator('svg')).toHaveCount(1);
      expect(await link.evaluate(e=>getComputedStyle(e.closest('.oui-setting-row')!).borderTopWidth)).toBe('0px');
    }
    await expect(page.getByRole('button',{name:'打开 Tools',exact:true})).toHaveText('');
    await page.screenshot({path:testInfo.outputPath(`advanced-${width}-${theme}.png`),fullPage:true});
    await page.getByRole('link',{name:'打开邮箱导入',exact:true}).click();await expect(page).toHaveURL(/\/import$/);
    await page.goto(base+'/reminders');await expect(page.getByRole('heading',{name:'周期提醒',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'测试邮件',exact:true})).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('daily cards distinguish legacy, empty, removed and pending requests without fabricating history', async ({page,context}) => {
  const token=await fixtureToken(context,'preview@example.invalid');
  await context.addInitScript(token=>localStorage.setItem('aicalendar_token',token),token);
  await page.setViewportSize({width:390,height:844});
  const make=(id:string,action:object)=>({id,role:'assistant',type:'text',text:'',timestamp:'2026-11-09T07:00:00',orbitMeta:{origin:'notification',notification:{title:'原提醒',body:'当时保留的原始内容',triggerAt:'2026-11-08T23:00:00Z'},dailyAction:{date:'2026-11-09',timezone:'America/Los_Angeles',weather:{state:'unconfigured'},...action}}});
  const history=[make('legacy',{legacy:true}),make('empty',{schemaVersion:1,items:[]}),make('removed',{schemaVersion:1,items:[{...frozenItem,current:{available:false,completed:false,editable:false,scheduleId:null,href:null}}]})];
  await page.route('**/api/ai-schedule/history?*',route=>route.fulfill({json:{messages:history,requests:[],nextBefore:null}}));
  let release!:()=>void, latestTitle='最新的事项';
  await page.route('**/api/action-center/daily-action?*',async route=>{
    expect(new URL(route.request().url()).searchParams.get('date')).toBe('today');
    if(!release)await new Promise<void>(resolve=>release=resolve);
    await route.fulfill({json:{date:'2026-11-09',timezone:'America/Los_Angeles',capturedAt:'2026-11-09T16:00:00Z',items:[{...frozenItem,title:latestTitle}]}});
  });
  await page.goto(base+'/assistant');
  const legacy=page.locator('#orbit-message-legacy');
  await expect(legacy).toContainText('未保存完整快照');
  await legacy.getByText('原提醒文本',{exact:true}).click();
  await expect(legacy.getByText('当时保留的原始内容',{exact:true})).toBeVisible();
  await expect(page.locator('#orbit-message-empty')).toContainText('推送时没有待处理事项');
  await expect(page.locator('#orbit-message-removed').getByRole('button',{name:/^推送时保存的事项标题/})).toBeDisabled();
  await legacy.getByRole('button',{name:'查看今日最新'}).click();
  await expect(legacy.getByRole('button',{name:'查看今日最新'})).toBeDisabled();
  await expect(legacy).toContainText('未保存完整快照');
  await expect.poll(()=>!!release).toBe(true);release();
  await expect(legacy).toContainText('最新的事项');
  latestTitle='编辑后更新的事项';
  await page.evaluate(()=>window.dispatchEvent(new Event('orbit:data-change')));
  await expect(legacy).toContainText('编辑后更新的事项');
  let releaseRefresh!:()=>void, refreshSettled=false;
  await page.route('**/api/action-center/daily-action?*',async route=>{
    await new Promise<void>(resolve=>releaseRefresh=resolve);
    await route.fulfill({json:{date:'2026-11-09',timezone:'America/Los_Angeles',capturedAt:'2026-11-09T17:00:00Z',items:[{...frozenItem,title:'不应覆盖快照的晚到结果'}]}}).catch(()=>undefined);
    refreshSettled=true;
  });
  await page.evaluate(()=>window.dispatchEvent(new Event('orbit:data-change')));
  await expect.poll(()=>!!releaseRefresh).toBe(true);
  await legacy.getByRole('button',{name:'返回今日快照'}).click();
  releaseRefresh();await expect.poll(()=>refreshSettled).toBe(true);
  await expect(legacy).toContainText('未保存完整快照');
  await expect(legacy).not.toContainText('不应覆盖快照的晚到结果');
  await expect(legacy).not.toContainText('编辑后更新的事项');
});
