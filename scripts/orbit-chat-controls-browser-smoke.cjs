// Isolated loopback UI with synthetic accounts, mocked queue states and no external/AI calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.ORBIT_PREVIEW_URL||'http://127.0.0.1:4183';
assert.equal(new URL(base).hostname,'127.0.0.1');
const output=process.env.ORBIT_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'orbit-chat-controls-'));
const baseline=process.argv.includes('--baseline');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.ORBIT_BROWSER_CHANNEL||'msedge',headless:true}),checks=[],metrics=[],errors=[];
  let page;
  try {
    const context=await browser.newContext();
    const login=await context.request.post(base+'/api/auth/login',{data:{email:'preview@example.invalid',password:'OrbitPreview123!'}});assert.equal(login.status(),200);
    const {token}=await login.json(),auth={Authorization:'Bearer '+token};
    await context.addInitScript(t=>localStorage.setItem('aicalendar_token',t),token);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.route('**/api/orbit/providers',route=>route.fulfill({json:{providers:[{id:'workbuddy',connected:true},{id:'chatgpt',connected:true}]}}));
    await context.route('**/api/models',route=>route.fulfill({json:{models:[{id:'Luna',name:'Luna'}]}}));
    await context.route('**/api/orbit/chatgpt/models',route=>route.fulfill({json:{models:[{id:'Luna',name:'Luna'}]}}));
    await context.route('**/api/schedule-model',route=>route.fulfill({json:{model:'Luna'}}));
    page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/orbit/requests')throw new Error('UI smoke must not submit AI');});
    for(const [width,height] of [[390,844],[430,932],[768,1024],[1440,900],[3020,1826]])for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height});await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
      await page.goto(base+'/assistant');await page.getByLabel('AI 助手输入框',{exact:true}).waitFor();await page.waitForURL('**/assistant?conversation=*');
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const row=await page.evaluate(()=>{const bounds=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{left:r.left,right:r.right,height:r.height}:null;};return {controls:bounds('.orbit-composer-controls'),composer:bounds('.schedule-ai-composer'),left:bounds('[aria-label="发送方式"]'),right:bounds('[aria-label="AI 服务"]'),toolbar:bounds('.orbit-chat-toolbar')};});
      if(!baseline) {assert.equal(row.toolbar,null);assert.ok(Math.abs(row.left.left-row.composer.left)<=1);assert.ok(Math.abs(row.right.right-row.composer.right)<=1);checks.push(`controls aligned ${width} ${theme}`);}
      await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-chat-${width}-${theme}.png`)});
      const drawer=page.locator('.note-board.is-open');if(!await drawer.isVisible())await page.getByLabel('打开 AI 记事板',{exact:true}).click();await drawer.waitFor();await page.waitForTimeout(280);
      row.noteBody=await page.locator('.note-board-body').evaluate(e=>e.getBoundingClientRect().height);
      row.handleHeight=await page.locator('.note-board-drag-handle').evaluateAll(rows=>rows[0]?.getBoundingClientRect().height||0);
      metrics.push({width,height,theme,...row});if(!baseline)assert.equal(row.handleHeight,0);
      await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-notes-${width}-${theme}.png`)});
      if(await page.getByLabel('关闭记事板',{exact:true}).isVisible())await page.getByLabel('关闭记事板',{exact:true}).click();else await page.getByLabel('打开 AI 记事板',{exact:true}).click();
      if(!baseline) {
        await page.locator('summary[aria-label="个人菜单"]').click();await page.locator('.account-menu-panel > strong').click();assert.ok(await page.locator('.account-menu').evaluate(e=>e.open));assert.equal(await page.getByRole('link',{name:'使用统计',exact:true}).count(),1);
        await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();assert.equal(await page.locator('.settings-header-links').count(),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByLabel('关闭设置',{exact:true}).click();checks.push(`settings and menu ${width} ${theme}`);
      }
    }
    fs.writeFileSync(path.join(output,baseline?'baseline.json':'matrix.json'),JSON.stringify({checks,metrics,errors},null,2));if(baseline){console.log(JSON.stringify({baseline:true,views:metrics.length,output}));return;}
    const oldMetrics=JSON.parse(fs.readFileSync(path.join(output,'baseline.json'))).metrics;
    for(const row of metrics.filter(row=>row.width<=768)) {const before=oldMetrics.find(b=>b.width===row.width&&b.theme===row.theme);assert.ok(row.noteBody-before.noteBody>=23,`note body grows ${row.width}`);}checks.push('mobile note body gains 24px');
    await page.setViewportSize({width:390,height:844});await page.goto(base+'/assistant');const input=page.getByLabel('AI 助手输入框',{exact:true});await input.waitFor();await page.waitForURL('**/assistant?conversation=*');
    const cid=new URL(page.url()).searchParams.get('conversation'),clear=()=>page.locator(`[data-confirm-action="clear:${cid}"]`);
    const openHistory=async()=>{await page.getByLabel('更多功能',{exact:true}).click();await page.getByRole('button',{name:/^历史对话/}).click();};
    const create=async title=>{const r=await context.request.post(base+'/api/orbit/conversations',{headers:auth,data:{title}});assert.equal(r.status(),200);return (await r.json()).conversation.id;};
    const other=await create('两步删除测试'),failed=await create('删除失败保留测试');
    await page.waitForTimeout(2200);let deletes=0,clears=0;
    page.on('request',r=>{if(r.method()==='DELETE'){if(new URL(r.url()).pathname==='/api/ai-schedule/history')clears++;else if(new URL(r.url()).pathname.startsWith('/api/orbit/conversations/'))deletes++;}});
    await clear().click();assert.equal(await clear().getAttribute('aria-pressed'),'true');assert.equal(clears,0);
    await page.waitForTimeout(5150);assert.equal(await clear().getAttribute('aria-pressed'),'false');
    await clear().click();await input.click();assert.equal(await clear().getAttribute('aria-pressed'),'false');
    await clear().click();await page.keyboard.press('Escape');assert.equal(await clear().getAttribute('aria-pressed'),'false');checks.push('top confirmation timeout outside and Escape');
    await openHistory();const remove=page.locator(`dialog [data-confirm-action="delete:${other}"]`);await remove.click();assert.equal(await remove.getAttribute('aria-pressed'),'true');assert.equal(deletes,0);assert.ok(await page.getByRole('dialog',{name:'历史对话',exact:true}).isVisible());
    await page.getByLabel('关闭更多功能',{exact:true}).click();await openHistory();assert.equal(await remove.getAttribute('aria-pressed'),'false');
    await remove.click();const completed=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().endsWith('/'+other));await remove.click();assert.equal((await completed).status(),200);await page.getByRole('dialog',{name:'历史对话',exact:true}).waitFor({state:'hidden'});assert.equal(deletes,1);checks.push('mobile two clicks delete once and closes only after success');
    await openHistory();await context.route('**/api/orbit/conversations/'+failed,route=>route.request().method()==='DELETE'?route.fulfill({status:503,json:{error:'合成删除失败'}}):route.continue());
    const failing=page.locator(`dialog [data-confirm-action="delete:${failed}"]`);await failing.click();await failing.click();await page.waitForTimeout(150);assert.ok(await failing.isVisible());assert.equal(await failing.getAttribute('aria-pressed'),'false');
    assert.ok((await (await context.request.get(base+'/api/orbit/conversations',{headers:auth})).json()).conversations.some(c=>c.id===failed));
    await page.getByLabel('关闭更多功能',{exact:true}).click();await page.getByLabel('关闭提示',{exact:true}).click();checks.push('delete failure retains conversation');
    await clear().click();await openHistory();await page.locator(`dialog [data-confirm-action="delete:${failed}"]`).click();assert.equal(await clear().getAttribute('aria-pressed'),'false');await page.getByLabel('关闭更多功能',{exact:true}).click();checks.push('only one armed operation');
    const selected=await create('当前会话删除测试');await page.waitForTimeout(2200);await openHistory();await page.locator('dialog .orbit-conversation-select').filter({hasText:'当前会话删除测试'}).click();await page.waitForURL('**/assistant?conversation='+selected);
    const selectedClear=page.locator(`[data-confirm-action="clear:${selected}"]`);await selectedClear.click();await openHistory();await page.locator('dialog .orbit-conversation-select').filter({hasText:'Orbit'}).click();await page.waitForURL('**/assistant?conversation='+cid);assert.equal(await clear().getAttribute('aria-pressed'),'false');checks.push('switching conversations resets confirmation');
    await openHistory();await page.locator('dialog .orbit-conversation-select').filter({hasText:'当前会话删除测试'}).click();await page.waitForURL('**/assistant?conversation='+selected);await openHistory();const selectedDelete=page.locator(`dialog [data-confirm-action="delete:${selected}"]`);await selectedDelete.click();await selectedDelete.click();await page.waitForURL('**/assistant?conversation='+cid);checks.push('deleting the current conversation returns to main');
    let status='cancelled';await context.route('**/api/orbit/requests?*',route=>route.fulfill({json:{requests:[{id:'synthetic-status',text:'合成取消状态',state:status,error:status==='cancelled'?'已取消':undefined},{id:'synthetic-failed',text:'合成失败状态',state:'failed'},{id:'synthetic-interrupted',text:'合成中断状态',state:'interrupted'}]}}));
    await page.waitForTimeout(2200);assert.equal(await page.locator('.orbit-request').filter({hasText:'合成取消状态'}).count(),0);assert.equal(await page.locator('.orbit-request').count(),2);
    await page.reload();await input.waitFor();await page.locator('.orbit-request').nth(1).waitFor();assert.equal(await page.locator('.orbit-request').filter({hasText:'合成取消状态'}).count(),0);
    status='running';await page.waitForTimeout(2200);assert.equal(await clear().isDisabled(),true);
    await context.route('**/api/orbit/requests/synthetic-status/cancel',route=>{status='cancelled';return route.fulfill({json:{request:{id:'synthetic-status',state:status}}});});
    await page.locator('.orbit-request').filter({hasText:'合成取消状态'}).getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(150);assert.equal(await page.locator('.orbit-request').filter({hasText:'合成取消状态'}).count(),0);checks.push('cancelled hidden after cancel and reload; failed interrupted retained; running blocks clear');
    await context.unroute('**/api/orbit/requests?*');await page.waitForTimeout(2200);
    await input.fill('未发送文字保持不变');await context.route('**/api/ai-schedule/history?*',route=>route.request().method()==='DELETE'?route.fulfill({status:503,json:{error:'合成清空失败'}}):route.continue());
    const beforeMessages=await page.locator('.ai-message-timestamp').count();await clear().click();await clear().click();await page.getByRole('alert').filter({hasText:'合成清空失败'}).waitFor();assert.equal(await input.inputValue(),'未发送文字保持不变');assert.equal(await page.locator('.ai-message-timestamp').count(),beforeMessages);checks.push('clear failure preserves history and draft');await context.unroute('**/api/ai-schedule/history?*');
    await page.getByLabel('更多功能',{exact:true}).click();await page.getByRole('button',{name:/^图片与文件/}).click();await page.locator('input[type=file][accept^=".jpg"]').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('合成聊天附件')});await page.getByText('已就绪',{exact:true}).waitFor();
    await page.getByRole('group',{name:'发送方式',exact:true}).getByRole('button',{name:'记事',exact:true}).click();const noteInput=page.getByLabel('记事输入框',{exact:true});await noteInput.fill('未保存的图文记事草稿');
    const sharp=require(path.join(process.cwd(),'node_modules/sharp')),image=await sharp({create:{width:80,height:50,channels:3,background:'#9cbcb2'}}).png().toBuffer();
    await page.getByLabel('更多功能',{exact:true}).click();await page.getByRole('button',{name:/^插入图片/}).click();await page.locator('input[type=file][accept="image/jpeg,image/png,image/webp"]').setInputFiles({name:'draft.png',mimeType:'image/png',buffer:image});await page.locator('.schedule-ai-composer-wrap .note-images img').waitFor();await clear().waitFor({state:'visible'});
    let release,started;const reached=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
    await context.route('**/api/ai-schedule/history?*',async route=>{if(route.request().method()!=='DELETE')return route.continue();const response=await route.fetch();started();await gate;return route.fulfill({response});});
    const count=clears;await clear().click();assert.equal(clears,count);await clear().click();await reached;assert.equal(await clear().isDisabled(),true);await clear().evaluate(e=>{e.click();e.click();});release();await page.waitForFunction(key=>document.querySelectorAll('.ai-message-timestamp').length===0&&!document.querySelector(`[data-confirm-action="${key}"]`).disabled,`clear:${cid}`);
    assert.equal(clears,count+1);assert.equal(await noteInput.inputValue(),'未保存的图文记事草稿');assert.equal(await page.locator('.schedule-ai-composer-wrap .note-images img').count(),1);assert.equal(await page.locator('.orbit-draft-file').count(),0);assert.equal(new URL(page.url()).searchParams.get('conversation'),cid);checks.push('clear once preserves conversation text and note image; removes chat attachment');
    await page.reload();await input.waitFor();assert.equal(await input.inputValue(),'未保存的图文记事草稿');await page.getByRole('group',{name:'发送方式',exact:true}).getByRole('button',{name:'记事',exact:true}).click();await page.locator('.schedule-ai-composer-wrap .note-images img').waitFor();assert.equal(await page.locator('.schedule-ai-composer-wrap .note-images img').count(),1);checks.push('retained draft survives reload');
    const mainClearCount=clears;await openHistory();const mainDelete=page.locator(`dialog [data-confirm-action="delete:${cid}"]`);await mainDelete.click();assert.equal(clears,mainClearCount);await mainDelete.click();await page.getByRole('dialog',{name:'历史对话',exact:true}).waitFor({state:'hidden'});assert.equal(clears,mainClearCount+1);assert.ok((await (await context.request.get(base+'/api/orbit/conversations',{headers:auth})).json()).conversations.some(c=>c.id===cid&&c.is_main));assert.equal(await page.getByLabel('记事输入框',{exact:true}).inputValue(),'未保存的图文记事草稿');checks.push('main row clears history and retains fixed conversation and draft');
    const note=await context.request.post(base+'/api/note-items',{headers:auth,data:{content:'ippure.com，www.example.com/path?a=1；report.pdf me@example.com https://example.org/ [站内](/project?view=growth)'}});assert.equal(note.status(),201);
    await page.reload();await input.waitFor();await page.getByLabel('打开 AI 记事板',{exact:true}).click();const noteRow=page.locator('.note-board-row').filter({hasText:'ippure.com'});await noteRow.waitFor();assert.equal(await noteRow.getByRole('link',{name:'ippure.com',exact:true}).getAttribute('href'),'https://ippure.com/');assert.equal(await noteRow.locator('a').count(),4);
    await context.route('https://ippure.com/**',route=>route.fulfill({body:'synthetic external destination'}));const popup=context.waitForEvent('page');await noteRow.getByRole('link',{name:'ippure.com',exact:true}).click();await (await popup).close();assert.equal(await noteRow.locator('textarea').count(),0);checks.push('bare link opens separately without editing card');
    await page.getByLabel('关闭记事板',{exact:true}).click();await page.locator('summary[aria-label="个人菜单"]').click();await page.getByRole('link',{name:'项目成长',exact:true}).click();await page.locator('.evolution-header').waitFor();assert.equal(await page.locator('.evolution-page').getByRole('link',{name:'使用统计',exact:true}).count(),0);
    await page.locator('summary[aria-label="个人菜单"]').click();await page.getByRole('link',{name:'使用统计',exact:true}).click();await page.locator('.orbit-statistics').waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'statistics');checks.push('statistics menu and old route; growth has no statistics shortcut');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,metrics,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors,output}));
  } catch(error) {if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
  finally {await browser.close();}
})();
