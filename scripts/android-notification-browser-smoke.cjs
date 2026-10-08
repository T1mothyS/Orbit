// Synthetic loopback preview only: no Firebase, real notifications or production writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.ORBIT_PREVIEW_URL||'http://127.0.0.1:4183';
assert.equal(new URL(base).hostname,'127.0.0.1');
const output=process.env.ORBIT_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'orbit-android-ui-'));
fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
  try {
    const context=await browser.newContext();
    const login=await context.request.post(base+'/api/auth/login',{data:{email:'preview@example.invalid',password:'OrbitPreview123!'}});assert.equal(login.status(),200);const {token}=await login.json();
    assert.equal((await context.request.put(base+'/api/android-push/preferences',{headers:{Authorization:'Bearer '+token},data:{enabled:false}})).status(),200);
    await context.addInitScript(token=>{
      localStorage.setItem('aicalendar_token',token);
      const state={version:'synthetic',developerTools:false,installationId:'11111111-1111-4111-8111-111111111111',installationKey:'synthetic-installation-proof-1111111111111',fid:null,notificationPermission:false,exactAlarmPermission:false,fcmConfigured:false,fcmState:'未配置',binding:null,pendingLocal:null,localResult:'尚未安排本地测试',fcmResult:'未记录',pendingNotification:null,pendingRevocations:0};
      window.__androidState=state;window.__androidCalls=JSON.parse(sessionStorage.getItem('synthetic-android-calls')||'[]');
      window.OrbitNative={postMessage(raw){const request=JSON.parse(raw);window.__androidCalls.push(request.method);sessionStorage.setItem('synthetic-android-calls',JSON.stringify(window.__androidCalls));
        const params=request.params||{};let error;
        if(request.method==='binding')state.binding={accountId:params.accountId,id:params.id,generation:params.generation};
        if(request.method==='permission')state.notificationPermission=true;
        if(request.method==='exactPermission')state.exactAlarmPermission=true;
        if(request.method==='scheduleLocal'){if(!state.notificationPermission)error='请先授权系统通知';else if(params.exact&&!state.exactAlarmPermission)error='请先开启闹钟和提醒';else{state.pendingLocal={dueAt:Date.now()+60000,exact:params.exact};state.localResult='合成测试已安排';}}
        if(request.method==='cancelLocal'){state.pendingLocal=null;state.localResult='本地测试已取消';}
        if(request.method==='logout'){state.pendingLocal=null;state.binding=null;}
        if(request.method==='consumeNotification')state.pendingNotification=null;
        queueMicrotask(()=>window.OrbitNative.onmessage?.({data:JSON.stringify({id:request.id,error,result:state})}));
      }};
    },token);
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.route('**/api/orbit/providers',route=>route.fulfill({json:{providers:[]}}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const open=async()=>{await page.goto(base+'/assistant?settings=android-push-enabled');await page.getByLabel('Android 手机提醒设置',{exact:true}).waitFor();};
    for(const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height});await page.addInitScript(t=>localStorage.setItem('theme',t),theme);await open();
      const area=page.getByLabel('Android 手机提醒设置',{exact:true});await area.getByText('客户端未配置',{exact:false}).waitFor();
      assert.equal(await area.getByRole('button',{name:'一分钟后本地提醒',exact:true}).count(),0);
      assert.equal(await area.getByRole('button',{name:'发送 FCM 测试',exact:true}).count(),0);
      assert.equal(await area.getByText('尚未发起服务端测试',{exact:false}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      const oversized=await area.locator('*').evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width>innerWidth+1).map(e=>e.tagName));assert.deepEqual(oversized,[]);
      await area.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`settings-${width}-${theme}.png`)});checks.push(`permissions/missing config/layout ${width} ${theme}`);
    }
    const area=page.getByLabel('Android 手机提醒设置',{exact:true});
    await page.evaluate(()=>{window.__androidState.developerTools=true;window.dispatchEvent(new Event('focus'));});
    await area.getByRole('button',{name:'一分钟后本地提醒',exact:true}).waitFor();
    assert.equal(await area.getByRole('button',{name:'一分钟后本地提醒',exact:true}).isDisabled(),true);
    await area.getByRole('button',{name:'授权系统通知',exact:true}).click();
    await area.getByRole('button',{name:'非精确测试（可能延迟）',exact:true}).click();await area.getByText('合成测试已安排',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>window.__androidState.pendingLocal.exact),false);
    await area.getByRole('button',{name:'取消本地测试',exact:true}).click();assert.equal(await page.evaluate(()=>window.__androidState.pendingLocal),null);
    await area.getByRole('button',{name:'开启闹钟和提醒',exact:true}).click();
    await area.getByRole('button',{name:'一分钟后本地提醒',exact:true}).click();assert.equal(await page.evaluate(()=>window.__androidState.pendingLocal.exact),true);
    await area.getByRole('button',{name:'一分钟后本地提醒',exact:true}).click();assert.equal(await page.evaluate(()=>window.__androidCalls.filter(x=>x==='scheduleLocal').length),3);
    checks.push('permission denied does not block settings; inexact/replace/cancel/exact bridge methods');
    const toggle=area.getByRole('switch',{name:'Android 手机提醒',exact:true});await toggle.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Android 手机提醒"]').getAttribute('aria-checked')==='true');
    const stored=await (await context.request.get(base+'/api/android-push',{headers:{Authorization:'Bearer '+token}})).json();assert.equal(stored.enabled,true);checks.push('independent push preference persists via real isolated API');
    // Simulate configured Firebase without sending externally. Registration still goes through the real isolated API.
    await page.evaluate(()=>{Object.assign(window.__androidState,{fcmConfigured:true,fid:'c'.repeat(22),fcmState:'已注册（合成）'});});
    await context.route('**/api/android-push',async route=>{const r=await route.fetch(),d=await r.json();await route.fulfill({json:{...d,configured:true}});});
    await context.route('**/api/android-push/devices/*/test',route=>route.fulfill({json:{id:'synthetic-test',status:'sent'}}));
    await area.getByRole('button',{name:'刷新注册状态',exact:true}).click();await area.getByRole('button',{name:'发送 FCM 测试',exact:true}).click();
    await area.getByText('FCM：服务端已接受，等待真机观察',{exact:false}).waitFor();checks.push('FCM accepted explicitly distinguished from device arrival');
    await page.getByLabel('关闭设置',{exact:true}).click();await page.getByLabel('AI 助手输入框',{exact:true}).waitFor();
    await page.locator('summary[aria-label="个人菜单"]').click();await page.getByRole('button',{name:'退出登录',exact:true}).click();
    await page.waitForFunction(()=>window.__androidCalls.includes('logout'));assert.equal(await page.evaluate(()=>window.__androidState.pendingLocal),null);checks.push('logout invokes native cleanup');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,errors,kind:'synthetic-web-bridge-only'},null,2));console.log(JSON.stringify({output,checks:checks.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
