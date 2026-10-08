// Uses only orbit-ui-preview.ts synthetic accounts and loopback APIs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.ORBIT_PREVIEW_URL||'http://127.0.0.1:4183';assert.equal(new URL(base).hostname,'127.0.0.1');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-product-ui-'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
try{
  const context=await browser.newContext();
  const response=await context.request.post(base+'/api/auth/login',{data:{email:'preview@example.invalid',password:'OrbitPreview123!'}});assert.equal(response.status(),200);const {token}=await response.json();
  await context.addInitScript(token=>localStorage.setItem('aicalendar_token',token),token);
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.route('**/api/orbit/providers',route=>route.fulfill({json:{providers:[]}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const card=page.locator('#orbit-message-synthetic-product-help');
  for(const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height});await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
    await page.goto(base+'/assistant');await card.waitFor();await card.scrollIntoViewIfNeeded();
    assert.equal(await card.locator('.orbit-setting-card').count(),4);assert.equal(await card.getByText('不应执行的入口').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.reload();await card.waitFor();assert.equal(await card.locator('.orbit-setting-card').count(),4);
    await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`actions-${width}-${theme}.png`)});
    for(const [label,target] of [['打开日报设置','/reports/settings'],['打开知识库设置','/library/settings'],['打开个人资料','/settings/profile'],['打开通知设置','/assistant']]){
      await card.getByRole('link',{name:label+' →',exact:true}).click();await page.waitForURL(url=>url.pathname===target&&url.searchParams.has('settings'));
      if(label==='打开通知设置'){await page.getByLabel('关闭设置',{exact:true}).waitFor();await page.getByLabel('关闭设置',{exact:true}).click();}
      else{await page.getByRole('heading',{level:1}).first().waitFor();}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await page.goto(base+'/assistant');await card.waitFor();
    }
    checks.push(`actions/refresh/old settingRefs/navigation/layout ${width} ${theme}`);
  }
  const help=await context.request.get(base+'/api/orbit/product-help?q='+encodeURIComponent('日报关注行业'),{headers:{Authorization:'Bearer '+token}});assert.equal(help.status(),200);const body=await help.json();assert.equal(body.domain,'product');assert(body.matches.length);checks.push('real product-help API returns version-bound document chunks');
  const raw=await context.request.get(base+'/.product-help.json');assert(!(await raw.text()).includes('formatVersion'));checks.push('raw product index is outside the public web root');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,errors,kind:'synthetic-web-navigation-only'},null,2));console.log(JSON.stringify({output,checks:checks.length,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
