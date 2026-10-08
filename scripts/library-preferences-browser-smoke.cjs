// Built UI and synthetic account/API only. No real database, token or network calls.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-context-browser-'));
const dist = path.resolve(__dirname, '../dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const requested = path.resolve(dist, '.' + new URL(req.url, 'http://local').pathname);
  if (!requested.startsWith(dist + path.sep)) { res.writeHead(403); return res.end(); }
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
function fixture() {
  return { profile: { identity: { language: 'zh-CN', timezone: 'Asia/Shanghai' }, background: { education: ['合成背景'], career_context: '合成职业' }, professional_interests: ['合成兴趣'], research_projects: [{ name: '合成项目', status: 'active', topics: ['主题'] }], information_preferences: { answer_style: ['解释因果'], finance_analysis: [], technology_preferences: [] } },
    preferences: { prefer: ['保留证据'], avoid: ['凑数'], target_reading_time_minutes: 10, evidence_policy: ['来源核验'] },
    recent_interests: { topics: [{ topic: '合成近期主题', priority: 'high', recency: '近期', keywords: ['合成'] }] },
    watchlist: { sectors: [{ name: '合成行业', priority: 'high', focus: ['公开证据'] }], stocks: [{ name: '合成标的', symbol: 'TEST', priority: 'high', sectors: ['行业'], thesis_file: 'theses/fixture.yaml', extension: '保留的标的字段' }], companies: [] },
    theses: { fixture: { name: '合成标的', symbol: 'TEST', status: 'active', priority: 'high', thesis: { one_liner: '合成判断', pillars: [{ id: 'original-pillar', title: '支柱', questions: ['核查问题'], extension: ['保留'] }], valuation_framework: { preferred_methods: ['合成方法'], key_variables: ['变量'], avoid: [] }, disconfirming_evidence: ['合成反证'] }, monitor: { earnings: ['合成指标'], industry: [], narrative: [] } } },
    unshown: { privateFixture: '保留的顶层字段' } };
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], mutations = [];
  let remote = { version: 7, context: fixture(), createdAt: null, updatedAt: '2026-10-07T00:00:00Z', readFailed: false };
  let mode = 'normal', dialogChoice = 'accept';
  let page;
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-only'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const method = route.request().method();
      if (method !== 'GET') mutations.push(url.pathname);
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'synthetic', email: 'synthetic@example.invalid', role: 'user' } } });
      if (url.pathname === '/api/daily-report/cloud-context') {
        if (mode === 'load-failure' && method === 'GET') return route.fulfill({ status: 503, json: { error: '合成读取失败' } });
        if (mode === 'loading' && method === 'GET') await new Promise(resolve => setTimeout(resolve, 700));
        if (method === 'PUT') {
          if (mode === 'saving') await new Promise(resolve => setTimeout(resolve, 700));
          if (mode === 'save-failure') return route.fulfill({ status: 500, json: { error: '合成保存失败，当前草稿仍保留' } });
          if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: '资料已在其他页面更新，当前草稿仍保留', code: 'CONTEXT_VERSION_CONFLICT' } });
          const body = JSON.parse(route.request().postData());
          assert.equal(body.expectedVersion, remote.version);
          assert.deepEqual(body.context.unshown, remote.context.unshown);
          remote = { ...remote, context: body.context, version: remote.version + 1 };
        }
        return route.fulfill({ json: { context: remote } });
      }
      if (url.pathname === '/api/library/preferences') return route.fulfill({ json: { preference: { sort: 'created_desc' } } });
      if (url.pathname === '/api/library') return route.fulfill({ json: { items: [], total: 0 } });
      if (url.pathname.endsWith('library-token') || url.pathname.endsWith('daily-report-token')) return route.fulfill({ json: { status: { exists: false, active: false } } });
      if (url.pathname === '/api/daily-report/delivery-policy') return route.fulfill({ json: { sources: ['cloud'], updatedAt: null } });
      if (url.pathname === '/api/ai-linkage-guides') return route.fulfill({ json: { version: 'synthetic', title: '合成接入指南', items: [], rules: [], examples: [] } });
      return route.fulfill({ status: 404, json: { error: '合成账号未启用此功能' } });
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /^(TypeError|ReferenceError|Error:)/.test(message.text())) errors.push(message.text()); });
    page.on('dialog', dialog => dialogChoice === 'accept' ? dialog.accept() : dialog.dismiss());
    const open = async (scope = 'profile') => {
      await page.goto(base + (scope === 'profile' ? '/settings/profile' : '/reports/settings'));
      await page.getByLabel(scope === 'profile' ? '职业背景' : '目标阅读时长（分钟）', {exact:true}).waitFor();
    };
    const overflow = async label => {
      const sizes=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);
      assert.ok(sizes[0]<=sizes[1]+1,label+': '+sizes);
    };
    for(const [width,height] of [[390,844],[430,932],[768,1024],[1440,900]])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height});await open();
      await page.evaluate(theme=>localStorage.setItem('theme',theme),theme);await page.reload();
      await page.getByLabel('职业背景',{exact:true}).fill('长职业背景'.repeat(80));
      assert.equal(await page.getByLabel('目标阅读时长（分钟）',{exact:true}).count(),0);
      await overflow('profile '+width+' '+theme);
      await page.screenshot({path:path.join(output,width+'-'+theme+'-profile.png')});
      await page.getByRole('button',{name:'取消',exact:true}).click();await open('report');
      assert.equal(await page.getByLabel('职业背景',{exact:true}).count(),0);
      await page.getByLabel('目标阅读时长（分钟）',{exact:true}).fill('15');
      for(const label of ['近期兴趣','关注名单','研究框架'])await page.locator('.context-section > summary').filter({hasText:new RegExp('^'+label+'$')}).click();
      await page.getByLabel('核心判断',{exact:true}).fill('长研究框架'.repeat(80));await overflow('report '+width+' '+theme);
      await page.screenshot({path:path.join(output,width+'-'+theme+'-report.png')});
      if(width<1100){
        await page.getByRole('tab',{name:'功能设置',exact:true}).click();await page.locator('#setting-daily-report-16vp9eg').waitFor({state:'visible'});
        await overflow('functions '+width+' '+theme);await page.getByRole('tab',{name:'个性化',exact:true}).click();
        assert.equal(await page.getByLabel('目标阅读时长（分钟）',{exact:true}).inputValue(),'15');
      }
      await page.getByRole('button',{name:'取消',exact:true}).click();
    }
    await open();await page.getByLabel('职业背景',{exact:true}).fill('新职业');await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByText('已保存，下一次 Cloud 日报读取时生效。',{exact:true}).waitFor();
    assert.equal(remote.context.preferences.target_reading_time_minutes,10);
    await open('report');await page.getByLabel('目标阅读时长（分钟）',{exact:true}).fill('15');
    await page.locator('.context-section > summary').filter({hasText:/^关注名单$/}).click();
    await page.getByRole('button',{name:'添加股票',exact:true}).click();
    const stock=page.locator('.context-list[aria-label="股票"] .context-item').last();
    await stock.getByLabel('名称',{exact:true}).fill('第二标的');await stock.getByLabel('代码',{exact:true}).fill('NEW');
    await stock.getByRole('button',{name:'建立研究框架',exact:true}).click();
    await page.getByRole('region',{name:'研究框架第2项'}).getByLabel('核心判断',{exact:true}).fill('第二框架');
    await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('已保存，下一次 Cloud 日报读取时生效。',{exact:true}).waitFor();
    assert.equal(remote.context.profile.background.career_context,'新职业');assert.ok(remote.context.theses['subject-1']);
    assert.equal(remote.context.theses.fixture.thesis.pillars[0].id,'original-pillar');
    await open('report');await page.locator('.context-section > summary').filter({hasText:/^关注名单$/}).click();
    await page.getByRole('button',{name:'移除股票第2项',exact:true}).click();await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByText('已保存，下一次 Cloud 日报读取时生效。',{exact:true}).waitFor();assert.ok(remote.context.theses['subject-1']);
    for(const failure of ['save-failure','conflict']){
      mode=failure;await open();await page.getByLabel('职业背景',{exact:true}).fill('待保存草稿');
      await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('alert').filter({hasText:/草稿仍保留/}).waitFor();
      assert.equal(await page.getByLabel('职业背景',{exact:true}).inputValue(),'待保存草稿');
      assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),failure!=='conflict');
    }
    mode='normal';await open();await page.getByLabel('职业背景',{exact:true}).fill('返回前草稿');dialogChoice='dismiss';
    await page.getByRole('link',{name:'← 返回对话'}).click();assert.equal(new URL(page.url()).pathname,'/settings/profile');
    dialogChoice='accept';await page.getByRole('link',{name:'← 返回对话'}).click();
    for(const [id,destination] of [['library-full-export','/library/settings'],['setting-library-16152wn','/library/settings'],['setting-daily-report-16vp9eg','/reports/settings'],['setting-daily-report-17lgo36','/reports/settings'],['setting-notifications-1ov9hhr','/reports/settings']]){
      await page.goto(base+'/library/preferences?settings='+id);await page.locator('#'+id).waitFor({state:'visible'});
      assert.equal(new URL(page.url()).pathname,destination);assert.equal(await page.locator('.settings-dialog-content').count(),0);
      assert.equal(await page.title(),destination==='/library/settings'?'Orbit - 知识库设置':'Orbit - 日报设置');
    }
    await page.goto(base+'/library/preferences?settings=library-personal-preferences');await page.getByRole('heading',{name:'个人资料',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/settings/profile');assert.equal(await page.title(),'Orbit - 个人资料');
    mode='loading';await page.goto(base+'/settings/profile');await page.getByText('正在读取资料…',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),false);
    await page.getByLabel('职业背景',{exact:true}).waitFor();mode='load-failure';await page.reload();
    await page.getByText('合成读取失败',{exact:true}).waitFor();
    mode='normal';remote.context={};await page.reload();await page.getByLabel('职业背景',{exact:true}).waitFor();
    await page.getByLabel('职业背景',{exact:true}).fill('空资料中的草稿');
    const keys=await page.evaluate(()=>Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    assert.ok(!keys.some(key=>/context|preferences|profile/.test(key)));assert.ok(mutations.every(p=>p==='/api/daily-report/cloud-context'));assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({viewports:4,themes:2,checks:['scoped-fields','columns-tabs','preserve-other-groups','unknown-fields','framework-add-remove','save-failure','conflict','unsaved-link','legacy-links','loading','load-failure','empty','memory-only','no-side-effects'],errors,writes:mutations.length},null,2));
    console.log(JSON.stringify({result:'PASS',output,pageErrors:errors.length,writes:mutations.length}));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') });
      console.error(JSON.stringify({ output, url: page.url(), pageErrors: errors, text: (await page.locator('body').innerText()).slice(-4500) }));
    }
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
