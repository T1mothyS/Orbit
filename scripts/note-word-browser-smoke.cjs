// Actual Windows Chromium clipboard -> a new hidden Word document. Synthetic loopback only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.ORBIT_PREVIEW_URL||'http://127.0.0.1:4183';
assert.equal(new URL(base).hostname,'127.0.0.1');
const output=process.env.ORBIT_UI_QA_DIR;assert.ok(output);
(async()=>{const browser=await chromium.launch({channel:process.env.ORBIT_BROWSER_CHANNEL||'msedge',headless:false,args:['--window-position=-32000,-32000']});
  try {const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});const login=await context.request.post(base+'/api/auth/login',{data:{email:'preview@example.invalid',password:'OrbitPreview123!'}});assert.equal(login.status(),200);const {token}=await login.json();
    const notes=(await(await context.request.get(base+'/api/note-items',{headers:{Authorization:'Bearer '+token}})).json()).items;const source=notes.find(note=>note.images.length===2);assert.ok(source,'run the mobile browser smoke first');
    const created=await context.request.post(base+'/api/note-items',{headers:{Authorization:'Bearer '+token},data:{content:'图文第一段\n\n图文第二段',imageIds:source.images.map(image=>image.id)}});assert.equal(created.status(),201);const card=(await created.json()).items[0];
    await context.addInitScript(t=>localStorage.setItem('aicalendar_token',t),token);await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage();await page.goto(base+'/assistant?note='+card.id);const row=page.locator('#orbit-note-'+card.id);await row.waitFor();await row.getByRole('button',{name:/复制记事/}).click();await row.locator('button[title="已复制"]').waitFor();
    const html=await page.evaluate(async()=>{const items=await navigator.clipboard.read();return(await items[0].getType('text/html')).text();});fs.writeFileSync(path.join(output,'clipboard.html'),html);
    const result=JSON.parse(execFileSync('pwsh',['-NoProfile','-STA','-File',path.resolve('scripts/note-word-clipboard-smoke.ps1'),'-HtmlPath',path.join(output,'clipboard.html')],{encoding:'utf8',windowsHide:true,timeout:45000}).trim());assert.equal(result.status,'PASSED',JSON.stringify(result));fs.writeFileSync(path.join(output,'word-'+(process.env.ORBIT_BROWSER_CHANNEL||'msedge')+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
