import { test, expect } from '@playwright/test';
import { fixtureToken } from './auth-fixture';
import { checkVisual } from './visual-check';
const base = 'http://127.0.0.1:4187';
test.describe.configure({ retries: 0 });
test.beforeEach(async ({ context }) => {
  const token = await fixtureToken(context, 'preview-guards@example.invalid');
  await context.addInitScript(value => localStorage.setItem('aicalendar_token', value), token);
});

for (const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]]) for (const theme of ['light','dark']) {
  test(`round3 ${width} ${theme}: shared time draft, keyboard, validation, help and independent import`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.addInitScript(value => localStorage.setItem('theme',value),theme);
    await page.setViewportSize({width,height}); const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/reminders'); await page.getByRole('button',{name:'+ 新建提醒',exact:true}).click();
    const form=page.getByRole('dialog',{name:'新建周期提醒',exact:true}), time=form.getByLabel('提醒时间',{exact:true});
    await time.fill('09:37'); await form.getByRole('button',{name:'选择提醒时间',exact:true}).click();
    const popup=form.getByRole('group',{name:'提醒时间选择',exact:true}); await expect(popup).toBeInViewport({ratio:1});
    const hour=form.getByLabel('提醒时间：小时',{exact:true}),minute=form.getByLabel('提醒时间：分钟',{exact:true});
    await expect(hour).toBeFocused(); await hour.selectOption('18'); await hour.press('Enter'); await expect(minute).toBeFocused();
    await minute.selectOption('43'); await minute.press('Enter'); await expect(popup.getByRole('button',{name:'确定',exact:true})).toBeFocused();
    await expect(time).toHaveValue('09:37'); await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0); await expect(time).toHaveValue('09:37');
    await form.getByRole('button',{name:'选择提醒时间',exact:true}).click(); await hour.selectOption('18'); await minute.selectOption('43'); await popup.getByRole('button',{name:'确定',exact:true}).click(); await expect(time).toHaveValue('18:43');
    await time.fill('29:79'); await expect(time).toHaveAttribute('aria-invalid','true'); await form.getByLabel('任务名称',{exact:true}).fill('无效时间不得提交');
    let writes=0; const listener=(request:any)=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/cycle-reminders')writes++;};page.on('request',listener);
    await form.getByRole('button',{name:'创建提醒',exact:true}).click(); expect(writes).toBe(0); await expect(form).toBeVisible();
    await time.fill('09:37'); await form.getByRole('button',{name:'选择提醒时间',exact:true}).click();
    await checkVisual(page,`round3-time-${width}-${theme}.png`,false,false); await page.keyboard.press('Escape');
    page.once('dialog',dialog=>dialog.accept()); await form.getByRole('button',{name:'取消',exact:true}).click();
    await page.goto(base+'/settings/notifications'); await page.getByRole('button',{name:'了解提醒收件邮箱',exact:true}).click();
    await expect(page.getByText('每日摘要、周期提醒和日报邮件共用此邮箱。',{exact:true})).toBeVisible(); await page.keyboard.press('Escape');
    await checkVisual(page,`round3-settings-${width}-${theme}.png`,false,false);
    await page.goto(base+'/tools'); await page.getByRole('button',{name:'个人菜单',exact:true}).click();
    await page.getByRole('menuitem',{name:'邮箱导入',exact:true}).or(page.getByRole('dialog',{name:'个人菜单',exact:true}).getByRole('button',{name:'邮箱导入',exact:true})).click();
    await expect(page).toHaveURL(base+'/import'); await expect(page.getByRole('heading',{name:'邮箱导入',exact:true})).toBeVisible();
    await expect(page.locator('.ai-assistant-topbar,.orbit-workspace,#ai-note-board')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await checkVisual(page,`round3-import-${width}-${theme}.png`,false,false);
    await page.goBack(); await expect(page).toHaveURL(base+'/tools'); await page.goForward(); await expect(page).toHaveURL(base+'/import'); await page.reload();
    await page.getByRole('link',{name:'返回今日行动中心',exact:true}).click(); await expect(page).toHaveURL(base+'/today');
    await page.goto(base+'/assistant?tool=email-import'); await expect(page).toHaveURL(base+'/import'); await page.reload(); await expect(page.getByRole('heading',{name:'邮箱导入',exact:true})).toBeVisible(); expect(errors).toEqual([]);
  });
}

test('round3 cold help question survives auto-selection, reload and never sends',async({page})=>{
  let sends=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/orbit/requests')sends++;});
  await page.goto(base+'/help');await page.getByRole('button',{name:'询问 AI：提醒与通知',exact:true}).click();
  const input=page.getByPlaceholder('发消息或安排日程…');
  await expect(input).toHaveValue('Orbit 的邮件、站内、浏览器和 Android 提醒分别在哪里配置与检查？');await expect(input).toBeFocused();
  await page.reload();await expect(input).toHaveValue('Orbit 的邮件、站内、浏览器和 Android 提醒分别在哪里配置与检查？');expect(sends).toBe(0);
});

test('round3 message branches render GFM safely and request retry stays anchored beyond the recent request window',async({page,context})=>{
  const text='# 标题\n## 层级\n\n| 名称 | 值 |\n| --- | --- |\n| **强调** | *说明* |\n\n1. 有序\n   - 嵌套\n\n```ts\nconst x = 1;\n```\n\n[事项](/today) ![不得加载](https://example.invalid/tracker) <script>window.unsafe=true</script>';
  const at=(n:number)=>new Date(Date.UTC(2026,9,19,0,n)).toISOString();
  let state='failed';const request={id:'old-failure',userMessageId:'old-user',text:'原始失败请求',state,createdAt:at(1),error:'可重试的合成失败'};
  let older=false;const messages=[{id:'old-user',role:'user',type:'text',text,timestamp:at(1)}, {id:'body',role:'assistant',type:'text',text,timestamp:at(2)}, {id:'error-body',role:'assistant',type:'error',text,timestamp:at(3)},...Array.from({length:45},(_,i)=>({id:'tail-'+i,role:'assistant',type:'text',text:'后续消息 '+i,timestamp:at(i+4)})),{id:'plan-body',role:'assistant',type:'plan',text:'待核对的正文',timestamp:at(49),plan:{id:'synthetic-plan',revision:1,state:'pending',warnings:[],operations:[{key:'synthetic-operation',type:'create',title:'结构化日程保留',startTime:'2026-10-20T09:37:00',endTime:'2026-10-20T10:00:00',allDay:false}]}}];
  let trackers=0;await context.route('https://example.invalid/**',route=>{trackers++;return route.abort();});
  await page.route('**/api/orbit/requests?*',route=>route.fulfill({json:{requests:[]}}));
  await page.route('**/api/ai-schedule/history?*',route=>{const before=new URL(route.request().url()).searchParams.has('before');if(before)older=true;return route.fulfill({json:{messages:before?[{id:'earlier',role:'assistant',type:'text',text:'更早记录',timestamp:at(0)}]:messages,requests:before?[]:[{...request,state}],start:'synthetic-start',nextBefore:older?null:'synthetic-before'}});});
  await page.route('**/api/orbit/requests/old-failure/retry',route=>{state='interrupted';return route.fulfill({json:{request:{...request,state}}});});
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/assistant');
  const failure=page.locator('.orbit-request').filter({hasText:'原始失败请求'});await expect(failure).toContainText('处理失败');
  const column=page.locator('.schedule-ai-reading-column'),scroll=column.locator('..');await scroll.evaluate(el=>el.scrollTop=0);
  await expect(page.locator('#orbit-message-old-user table')).toHaveCount(1);await expect(page.locator('#orbit-message-body table')).toHaveCount(1);await expect(page.locator('#orbit-message-error-body table')).toHaveCount(1);
  await expect(column.locator('img,script')).toHaveCount(0);await expect(column.locator('.orbit-plan')).toContainText('结构化日程保留');await expect(column.locator('.orbit-message-body .orbit-plan')).toHaveCount(0);expect(trackers).toBe(0);expect(await page.evaluate(()=>(window as any).unsafe)).toBeUndefined();
  const contrast=await page.locator('#orbit-message-old-user').evaluate(el=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance=(values:number[])=>values.map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const a=luminance(rgb(getComputedStyle(el.querySelector('time')!).color)),b=luminance(rgb(getComputedStyle(el.querySelector('.orbit-user-message')!).backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });expect(contrast).toBeGreaterThanOrEqual(4.5);
  await failure.getByRole('button',{name:'重试',exact:true}).click();await expect(failure).toContainText('已中断');
  expect(await failure.evaluate(el=>el.previousElementSibling?.id)).toBe('orbit-message-old-user');expect(await failure.evaluate(el=>el.nextElementSibling?.id)).toBe('orbit-message-body');
  const offset=await scroll.evaluate(el=>el.scrollTop);await page.waitForTimeout(2200);expect(Math.abs(await scroll.evaluate(el=>el.scrollTop)-offset)).toBeLessThan(2);
  await scroll.evaluate(el=>el.scrollTop=0);await checkVisual(page,'round3-markdown-timeline-390-light.png',false,false);
  await page.getByRole('button',{name:'加载更早记录',exact:true}).click();await expect(page.getByText('更早记录',{exact:true})).toBeVisible();await expect(failure).toBeVisible();await expect(page.getByRole('button',{name:'有新回复 · 滚动到底部',exact:true})).toHaveCount(0);
  older=false;await page.goto(base+'/assistant?message=earlier');await expect(page.getByText('更早记录',{exact:true})).toBeInViewport();
});

test('round3 settings preserve odd minutes and invalid draft cannot submit an older valid time',async({page,context})=>{
  await page.goto(base+'/settings/notifications');const enabled=page.getByRole('switch',{name:'开启每日提醒',exact:true});if(await enabled.getAttribute('aria-checked')==='false')await enabled.click();
  const input=page.getByLabel('每日提醒时间',{exact:true}),save=page.getByRole('button',{name:'保存提醒时间',exact:true});await expect(input).toBeEnabled();await input.fill('09:37');
  const response=page.waitForResponse(response=>response.request().method()==='PUT'&&new URL(response.url()).pathname==='/api/notification-preferences');await save.click();await response;
  await input.fill('25:79');await expect(save).toBeDisabled();await expect(input).toHaveValue('25:79');await input.fill('09:37');await expect(save).toBeEnabled();
  await page.reload();await expect(input).toHaveValue('09:37');
});

test('round3 standalone import resumes after login and global search has border-only mouse and keyboard focus',async({browser})=>{
  const context=await browser.newContext(),page=await context.newPage();await page.goto(base+'/import');
  await page.getByLabel('邮箱',{exact:true}).fill('preview-guards@example.invalid');await page.getByLabel('密码',{exact:true}).fill('OrbitPreview123!');await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page).toHaveURL(base+'/import');await expect(page.getByRole('heading',{name:'邮箱导入',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开全局搜索',exact:true}).click();const input=page.getByRole('textbox',{name:'搜索事项、对话、记事、设置和报告',exact:true});await expect(input).toBeFocused();
  for(const mode of ['mouse','keyboard']){if(mode==='mouse')await input.click();else {await input.press('Tab');await expect(page.getByRole('button',{name:'关闭统一搜索',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');}await expect(input).toBeFocused();expect(await input.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');expect(await input.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');}
  await context.close();
});

for (const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]]) for (const theme of ['light','dark']) {
  test(`round3 review ${width} ${theme}: help, compact filters, entries and required fields`,async({page,context})=>{
    test.setTimeout(90_000);
    await context.addInitScript(value=>localStorage.setItem('theme',value),theme);
    await page.setViewportSize({width,height}); const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/settings/ai');
    const keyHelp='仅保存到当前账号，服务器不使用全局默认 Key。在 WorkBuddy API 管理页面创建或复制 Key，然后粘贴到配置表单。';
    await expect(page.getByText(keyHelp,{exact:true})).toHaveCount(0);
    await expect(page.locator('.oui-setting-copy > p')).toHaveCount(0);
    const help=page.getByRole('button',{name:'了解个人 API Key',exact:true}); await help.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText(keyHelp,{exact:true})).toBeVisible(); await page.keyboard.press('Escape'); await expect(help).toBeFocused();
    await checkVisual(page,`round3-review-ai-${width}-${theme}.png`,false,false);
    await page.goto(base+'/settings/notifications');
    await expect(page.locator('#setting-notifications-1q1t6v5')).toHaveCount(1); await expect(page.locator('#setting-notifications-1tv1uzi')).toHaveCount(1);
    const group=page.locator('.oui-setting-row').filter({has:page.getByRole('button',{name:'了解通知渠道与免打扰',exact:true})});
    await expect(group.getByRole('switch')).toHaveCount(4); await expect(group.getByRole('button',{name:'保存通知设置',exact:true})).toBeVisible();
    await expect(group.locator('.oui-setting-row')).toHaveCount(0);
    await checkVisual(page,`round3-review-notifications-${width}-${theme}.png`,false,false);
    await page.goto(base+'/library'); await expect(page.locator('.library-page')).toHaveAttribute('aria-busy','false');
    await expect(page.getByRole('link',{name:'知识库设置',exact:true})).toHaveCount(0); await expect(page.getByRole('link',{name:'记录经历',exact:true})).toHaveCount(0);
    await expect(page.getByRole('combobox',{name:'筛选内容类型',exact:true})).toHaveCount(0);
    const trigger=page.getByRole('button',{name:'筛选与排序',exact:true}); await trigger.click();
    const popup=page.getByRole('dialog',{name:'筛选与排序',exact:true}); await expect(popup).toBeInViewport({ratio:1});
    await expect(popup.getByRole('combobox')).toHaveCount(4); await expect(popup.getByRole('button',{name:'应用',exact:true})).toHaveCount(0);
    await checkVisual(page,`round3-review-library-${width}-${theme}.png`,false,false); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await page.getByRole('button',{name:'个人菜单',exact:true}).click();
    await page.getByRole('menuitem',{name:'记录经历',exact:true}).or(page.getByRole('dialog',{name:'个人菜单',exact:true}).getByRole('button',{name:'记录经历',exact:true})).click();
    await expect(page).toHaveURL(base+'/library/experience'); await expect(page.getByRole('heading',{name:'记录经历',exact:true})).toBeVisible(); await page.reload();
    await expect(page.getByRole('heading',{name:'记录经历',exact:true})).toBeVisible(); await page.goBack();
    await page.goto(base+'/reports'); await expect(page.getByRole('link',{name:'日报设置',exact:true})).toHaveCount(0);
    await page.goto(base+'/today'); await expect(page.getByRole('button',{name:'一键发送日程',exact:true})).toHaveCount(0); await expect(page.getByRole('button',{name:'刷新',exact:true})).toHaveCount(0);
    await checkVisual(page,`round3-review-today-${width}-${theme}.png`,false,false);
    await page.goto(base+'/reminders'); await expect(page.locator('.stats-grid')).toHaveCount(0);
    await page.getByRole('button',{name:'+ 新建提醒',exact:true}).click();
    const form=page.getByRole('dialog',{name:'新建周期提醒',exact:true});
    for(const [tab,count] of [['信用卡',4],['SIM 卡',6],['生活事务',3]] as const){
      await form.getByRole('button',{name:tab,exact:true}).click(); await expect(form.locator('.oui-required-mark')).toHaveCount(count);
      expect(await form.locator('input[required]').evaluateAll(inputs=>inputs.every(input=>input.closest('label')?.querySelector('.oui-required-mark')))).toBe(true);
    }
    await checkVisual(page,`round3-review-reminder-${width}-${theme}.png`,false,false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); expect(errors).toEqual([]);
  });
}

test('round3 review notification save includes all four switches without saving another row draft',async({page,context})=>{
  const token=await fixtureToken(context,'preview-guards@example.invalid'),headers={Authorization:`Bearer ${token}`};
  const before=(await (await context.request.get(base+'/api/notification-preferences',{headers})).json()).preference;
  await page.goto(base+'/settings/notifications'); await page.getByLabel('提醒收件邮箱',{exact:true}).fill('unsaved-row@example.invalid');
  const expected:Record<string,boolean>={};
  for(const [label,key] of [['邮件通知','emailEnabled'],['站内通知','inAppEnabled'],['浏览器前台通知','browserEnabled']] as const){
    const control=page.getByRole('switch',{name:label,exact:true}); expected[key]=await control.getAttribute('aria-checked')!=='true'; await control.click();
  }
  const quiet=page.getByRole('switch',{name:'免打扰时段',exact:true}); if(await quiet.getAttribute('aria-checked')!=='true')await quiet.click();
  await page.getByLabel('免打扰开始时间',{exact:true}).fill('23:37'); await page.getByLabel('免打扰结束时间',{exact:true}).fill('07:13');
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/notification-preferences');
  await page.getByRole('button',{name:'保存通知设置',exact:true}).click(); expect((await response).ok()).toBe(true);
  const after=(await (await context.request.get(base+'/api/notification-preferences',{headers})).json()).preference;
  expect(after).toMatchObject({...expected,quietHoursEnabled:true,quietStart:'23:37',quietEnd:'07:13',reminderEmail:before.reminderEmail});
  await expect(page.getByLabel('提醒收件邮箱',{exact:true})).toHaveValue('unsaved-row@example.invalid');
});

test('round3 review filters apply immediately, retain saved sort on failure, reset and return focus',async({page})=>{
  let sort='created_desc',reject=false; const queries:string[]=[];
  await page.route('**/api/library/preferences',async route=>{
    if(route.request().method()==='PUT') {if(reject)return route.fulfill({status:503,json:{error:'合成保存失败'}}); sort=route.request().postDataJSON().sort;}
    return route.fulfill({json:{preference:{sort}}});
  });
  await page.route(/\/api\/library\?/,route=>{queries.push(route.request().url());return route.fulfill({json:{items:[],total:0}});});
  await page.goto(base+'/library'); const trigger=page.getByRole('button',{name:'筛选与排序',exact:true}); await trigger.click();
  const popup=page.getByRole('dialog',{name:'筛选与排序',exact:true}); await popup.getByRole('combobox',{name:'筛选内容形态',exact:true}).click(); await page.getByRole('option',{name:'知识碎片',exact:true}).click();
  await expect.poll(()=>queries.some(url=>url.includes('kind=fragment'))).toBe(true);
  reject=true; await popup.getByRole('combobox',{name:'知识库排序',exact:true}).click(); await page.getByRole('option',{name:'名称正序',exact:true}).click();
  await expect(popup.getByRole('alert')).toContainText('合成保存失败'); await expect(popup.getByRole('combobox',{name:'知识库排序',exact:true})).not.toHaveText('名称正序');
  reject=false; await popup.getByRole('button',{name:'重置',exact:true}).click(); await expect.poll(()=>queries.some(url=>url.includes('kind=all'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('round3 review plan outcomes describe operations and notification controls share icon actions',async({page,context})=>{
  await context.addInitScript(()=>localStorage.setItem('theme','dark'));
  const at=new Date().toISOString(),op=(type:string)=>({key:type,type,title:'合成计划项',startTime:'2026-10-20T09:00:00',endTime:'2026-10-20T10:00:00'});
  const cases=[['create',['create'],'已创建'],['recurring',['create_recurring'],'已创建'],['update',['update'],'已更新'],['delete',['delete'],'已删除'],['mixed',['create','update'],'已执行']] as const;
  const messages:any[]=[{id:'draft',role:'assistant',type:'plan',text:'请确认',timestamp:at,plan:{id:'draft',state:'pending',operations:[op('create')],warnings:[]}},...cases.map(([id,types])=>({id,role:'assistant',type:'plan',text:'执行结果',timestamp:at,plan:{id,state:'completed',operations:types.map(op),warnings:[]}})),{id:'partial',role:'assistant',type:'plan',text:'部分结果',timestamp:at,plan:{id:'partial',state:'partially_completed',operations:[op('create')],warnings:[]}}, {id:'notice',role:'assistant',type:'text',text:'合成通知',timestamp:at,orbitMeta:{origin:'notification',notificationId:'synthetic-notice',state:'sent',actionable:true,href:'/today'}},{id:'proactive',role:'assistant',type:'text',text:'主动提醒',timestamp:at,orbitMeta:{origin:'proactive',eventId:'synthetic-event',state:'sent'}}];
  await page.route('**/api/ai-schedule/history?*',route=>route.fulfill({json:{messages,requests:[],nextBefore:null}}));
  await page.route('**/api/orbit/requests?*',route=>route.fulfill({json:{requests:[]}}));
  const actions:string[]=[]; await page.route('**/api/orbit/notifications/synthetic-notice/*',route=>{actions.push(new URL(route.request().url()).pathname.split('/').pop()!);return route.fulfill({json:{ok:true}});});
  await page.goto(base+'/assistant');
  for(const [id,,label] of cases) {await expect(page.locator(`#orbit-message-${id} .orbit-outcome`)).toHaveText(`✓ ${label}`); await expect(page.locator(`#orbit-message-${id} .orbit-plan`)).toContainText('执行计划 · '+label);}
  await expect(page.locator('#orbit-message-partial .orbit-outcome')).toContainText('部分操作已执行');
  const edit=page.getByRole('button',{name:'编辑计划项 合成计划项',exact:true}); await edit.scrollIntoViewIfNeeded(); await expect(edit).toHaveClass(/oui-button--quiet/);
  expect(await edit.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await checkVisual(page,'round3-review-plan-dark.png',false,false);
  const card=page.locator('#orbit-message-notice .orbit-notification-actions'); await card.scrollIntoViewIfNeeded();
  for(const label of ['查看原对象','就此继续聊','完成事项','延后 15 分钟','明天 09:00 再提醒']) {
    const control=card.getByRole(label==='查看原对象'?'link':'button',{name:label,exact:true}); await expect(control).toBeVisible(); await expect(control).toHaveText('');
    await control.hover(); await expect(page.getByRole('tooltip')).toContainText(label); await page.keyboard.press('Escape');
  }
  const continueChat=card.getByRole('button',{name:'就此继续聊',exact:true}); await continueChat.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(continueChat).toBeFocused(); await expect(page.getByRole('tooltip')).toHaveText('就此继续聊'); await expect(continueChat).toHaveAttribute('aria-describedby',await page.getByRole('tooltip').getAttribute('id') || ''); await page.keyboard.press('Escape');
  for(const label of ['完成事项','延后 15 分钟','明天 09:00 再提醒'])await card.getByRole('button',{name:label,exact:true}).click();
  expect(actions).toEqual(['complete','snooze','tomorrow']); await expect(page.locator('#orbit-message-proactive').getByRole('button',{name:'明天 09:00 再提醒',exact:true})).toBeVisible();
  await checkVisual(page,'round3-review-notification-dark.png',false,false);
});
