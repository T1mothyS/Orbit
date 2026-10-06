// Loopback synthetic preview only. Uses the deployed bundle without real AI, SMTP or user data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.ORBIT_PREVIEW_URL||'http://127.0.0.1:4187';
assert.equal(new URL(base).hostname,'127.0.0.1');
const output=process.env.ORBIT_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'orbit-reader-plan-'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],metrics=[],errors=[];
  try {
    const context=await browser.newContext();
    const response=await context.request.post(base+'/api/auth/login',{data:{email:'preview@example.invalid',password:'OrbitPreview123!'}});
    assert.equal(response.status(),200);const {token}=await response.json();
    await context.addInitScript(t=>localStorage.setItem('aicalendar_token',t),token);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.route('**/api/orbit/requests',route=>route.request().method()==='POST'?route.abort():route.continue());
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    for(const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]])for(const theme of ['light','dark']) {
      console.log(`Checking reader/settings ${width} ${theme}`);
      await page.setViewportSize({width,height});await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
      await page.goto(base+'/library/mobile-library-1');await page.locator('.library-markdown h2').first().waitFor();
      await page.waitForTimeout(350);
      if(width<=768) {
        await page.locator('.library-detail-page').evaluate(e=>{e.scrollTop=600;});await page.waitForTimeout(100);
        const geometry=await page.evaluate(()=>{const root=document.querySelector('.library-detail-page'),toc=document.querySelector('.library-toc'),r=root.getBoundingClientRect(),t=toc.getBoundingClientRect();return {gap:t.top-r.top,left:t.left-r.left,right:t.right-r.right,background:getComputedStyle(toc).backgroundColor};});
        assert.ok(Math.abs(geometry.gap)<=1,JSON.stringify(geometry));assert.ok(Math.abs(geometry.left)<=1);assert.ok(Math.abs(geometry.right)<=1);assert.notEqual(geometry.background,'rgba(0, 0, 0, 0)');metrics.push({width,theme,...geometry});
        await page.getByRole('button',{name:'第 6 节',exact:true}).click();
        await page.waitForFunction(()=>{const root=document.querySelector('.library-detail-page'),toc=document.querySelector('.library-toc'),h=[...document.querySelectorAll('.library-markdown h2')].find(e=>e.textContent==='第 6 节');const offset=h.getBoundingClientRect().top-root.getBoundingClientRect().top-toc.getBoundingClientRect().height;return offset>=-1&&offset<=8;},{},{timeout:5000});
        const position=await page.evaluate(()=>{const root=document.querySelector('.library-detail-page'),toc=document.querySelector('.library-toc'),h=[...document.querySelectorAll('.library-markdown h2')].find(e=>e.textContent==='第 6 节');return h.getBoundingClientRect().top-root.getBoundingClientRect().top-toc.getBoundingClientRect().height;});
        assert.ok(position>=-1&&position<=8,`heading offset ${position}`);
      }
      await page.screenshot({path:path.join(output,`reader-${width}-${theme}.png`)});
      if(width<=640){const back=page.locator('.library-toc .library-reader-back');assert.equal((await back.innerText()).trim(),'');assert.equal(await back.evaluate(e=>e.getBoundingClientRect().width),44);await back.click();await page.waitForURL('**/library');}
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      checks.push(`reader ${width} ${theme}`);
      await page.goto(base+'/assistant');await page.getByLabel('AI 助手输入框',{exact:true}).waitFor();
      await page.locator('summary[aria-label="个人菜单"]').click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-scroll').waitFor();
      // The dialog scales during its opening transition; viewport rectangles are then not scroll pixels.
      await page.waitForFunction(()=>document.querySelector('.settings-dialog')?.getAnimations({subtree:true}).every(a=>a.playState!=='running'||!Number.isFinite(a.effect?.getComputedTiming().endTime)),{},{timeout:5000});
      await page.waitForTimeout(100);
      if(width>640) {
        for(const id of ['caldav','library','data','account']) {
          await page.locator('.settings-scroll').evaluate((root,id)=>{const target=root.querySelector('#settings-'+id);root.scrollTop+=target.getBoundingClientRect().top-root.getBoundingClientRect().top-parseFloat(getComputedStyle(root).scrollPaddingTop);},id);
          await page.waitForTimeout(150);
          const current=await page.locator('.settings-nav [aria-current="true"]').innerText();
          assert.equal(current,{caldav:'荣耀日历',library:'知识库',data:'数据',account:'账户'}[id],JSON.stringify(await page.locator('.settings-scroll').evaluate(root=>({scrollTop:root.scrollTop,padding:getComputedStyle(root).scrollPaddingTop,top:root.getBoundingClientRect().top,sections:[...root.querySelectorAll('.setting-section')].map(e=>({id:e.id,top:e.getBoundingClientRect().top}))}))));
        }
        await page.locator('.settings-scroll').evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.waitForTimeout(150);
        const last=page.locator('.settings-nav [aria-current="true"]');assert.equal(await last.innerText(),'管理');
        assert.ok(await last.evaluate(e=>{const r=e.getBoundingClientRect(),n=e.parentElement.getBoundingClientRect();return r.top>=n.top-1&&r.bottom<=n.bottom+1;}));
        await page.getByRole('button',{name:'AI',exact:true}).click();await page.waitForTimeout(150);assert.equal(await page.locator('.settings-nav [aria-current="true"]').innerText(),'AI');
      }
      await page.getByLabel('关闭设置',{exact:true}).click();checks.push(`settings ${width} ${theme}`);
    }
    await page.setViewportSize({width:390,height:844});await page.goto(base+'/assistant');
    const middle=page.getByLabel('删除待创建条目 合成待办乙',{exact:true});await middle.waitFor();
    let deletes=0;page.on('request',r=>{if(r.method()==='DELETE'&&r.url().includes('/operations/'))deletes++;});
    await middle.click();await page.waitForFunction(()=>document.querySelector('.orbit-plan')?.textContent.includes('· 2 项 · 版本 2'));
    assert.equal(deletes,1);await page.reload();await page.getByLabel('删除待创建条目 合成待办丙',{exact:true}).waitFor();assert.equal(await middle.count(),0);
    await page.getByLabel('编辑计划项 合成待办丙',{exact:true}).click();await page.getByLabel('标题',{exact:true}).fill('合成待办丙已编辑');await page.getByRole('button',{name:'保存这项',exact:true}).click();
    await page.getByLabel('删除待创建条目 合成待办丙已编辑',{exact:true}).waitFor();checks.push('remove, reload and edit correctly reindexed draft');
    await page.getByLabel('删除待创建条目 合成待办甲',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.orbit-plan')?.textContent.includes('· 1 项'));
    await page.getByLabel('删除待创建条目 合成待办丙已编辑',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.orbit-plan')?.textContent.includes('已取消执行计划 · 0 项'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('.orbit-plan')?.textContent.includes('已取消执行计划 · 0 项'));assert.equal(await page.getByRole('button',{name:'确认并执行',exact:true}).count(),0);checks.push('last removal remains cancelled after reload');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'reader-plan-results.json'),JSON.stringify({checks,metrics,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors,output}));
  } catch(error) {console.error(error);throw error;} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
