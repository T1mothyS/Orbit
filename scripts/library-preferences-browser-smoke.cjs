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
    const open = async () => {
      await page.goto(base + '/library/preferences');
      await page.getByLabel('职业背景', { exact: true }).waitFor();
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
    };
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.goto(base + '/library');
        await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
        await page.reload();
        await page.getByRole('link', { name: '个人资料与日报偏好', exact: true }).click();
        await page.getByLabel('职业背景', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
        await page.getByLabel('职业背景', { exact: true }).fill('合成很长的职业背景'.repeat(45));
        assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), true);
        for (const label of ['近期兴趣', '关注名单', '研究框架']) await page.locator('.context-section > summary').filter({ hasText: new RegExp(`^${label}$`) }).click();
        await page.getByLabel('核心判断', { exact: true }).fill('合成很长的核心判断'.repeat(30));
        const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('.context-page').scrollWidth, document.querySelector('.context-page').clientWidth]);
        assert.ok(widths[0] <= widths[1] + 1 && widths[2] <= widths[3] + 1, `${width} ${theme}: overflow ${widths}`);
        assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), theme === 'dark');
        await page.locator('.context-page').evaluate(element => element.scrollTop = 0);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-top.png`) });
        await page.getByLabel('核心判断', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-research.png`) });
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), '合成职业');
      }
    }
    // All five groups, add/remove, stored unknown fields and reload.
    await open();
    await page.getByLabel('职业背景', { exact: true }).fill('新职业');
    await page.getByLabel('目标阅读时长（分钟）', { exact: true }).fill('15');
    await page.locator('.context-section > summary').filter({ hasText: /^近期兴趣$/ }).click();
    await page.getByLabel('主题', { exact: true }).fill('新主题');
    await page.locator('.context-section > summary').filter({ hasText: /^关注名单$/ }).click();
    await page.getByRole('button', { name: '添加股票', exact: true }).click();
    const stock = page.locator('.context-list[aria-label="股票"] .context-item').last();
    await stock.getByLabel('名称', { exact: true }).fill('第二标的');
    await stock.getByLabel('代码', { exact: true }).fill('NEW');
    await stock.getByRole('button', { name: '建立研究框架', exact: true }).click();
    const frame = page.getByRole('region', { name: '研究框架第2项' });
    await frame.getByLabel('核心判断', { exact: true }).fill('第二框架');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('已保存，下一次 Cloud 日报读取时生效。', { exact: true }).waitFor();
    assert.equal(remote.context.profile.background.career_context, '新职业');
    assert.equal(remote.context.preferences.target_reading_time_minutes, 15);
    assert.equal(remote.context.recent_interests.topics[0].topic, '新主题');
    assert.equal(remote.context.theses['subject-1'].thesis.one_liner, '第二框架');
    assert.equal(remote.context.theses.fixture.thesis.pillars[0].id, 'original-pillar');
    await open();
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), '新职业');
    await page.locator('.context-section > summary').filter({ hasText: /^关注名单$/ }).click();
    await page.getByRole('button', { name: '移除股票第2项', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('已保存，下一次 Cloud 日报读取时生效。', { exact: true }).waitFor();
    assert.equal(remote.context.watchlist.stocks.length, 1);
    assert.ok(remote.context.theses['subject-1'], 'removing a target must preserve the framework');
    // Save failure and conflicts retain the current draft.
    for (const failure of ['save-failure', 'conflict']) {
      mode = failure; await open();
      await page.getByLabel('职业背景', { exact: true }).fill('待保存草稿');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: /草稿仍保留/ }).waitFor();
      assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), '待保存草稿');
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), failure !== 'conflict');
      await page.screenshot({ path: path.join(output, `${failure}.png`) });
    }
    mode = 'normal'; await page.goto(base + '/library');
    await page.getByRole('link', { name: '个人资料与日报偏好', exact: true }).click();
    await page.getByLabel('职业背景', { exact: true }).waitFor();
    await page.getByLabel('职业背景', { exact: true }).fill('返回前草稿');
    dialogChoice = 'dismiss';
    await page.getByRole('link', { name: '← 返回知识库' }).click();
    assert.equal(new URL(page.url()).pathname, '/library/preferences');
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), '返回前草稿');
    // Indexed browser back is guarded too; a cancelled POP restores the URL and editor.
    const cancelledPop = page.waitForEvent('dialog');
    await page.evaluate(() => history.back());
    await cancelledPop;
    await page.waitForFunction(() => location.pathname === '/library/preferences' && history.state.idx === 1);
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), '返回前草稿');
    dialogChoice = 'accept'; await page.evaluate(() => history.back());
    await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
    await page.evaluate(() => history.forward());
    await page.getByLabel('职业背景', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('职业背景', { exact: true }).inputValue(), remote.context.profile.background.career_context);
    // Both settings buttons close the dialog and open the very same editor.
    for (const section of ['daily-report', 'library']) {
      await open();
      await page.getByRole('link', { name: section === 'library' ? '知识库发布设置' : '日报接收设置', exact: true }).click();
      const row = page.locator(section === 'library' ? '#library-personal-preferences' : '#setting-daily-report-17lgo36');
      await row.getByRole('button', { name: '编辑个人资料与日报偏好' }).click();
      assert.equal(await page.locator('.settings-dialog-content').count(), 0);
      await page.getByLabel('职业背景', { exact: true }).waitFor();
    }
    mode = 'saving'; await open();
    await page.getByLabel('职业背景', { exact: true }).fill('保存状态合成草稿');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal(await page.getByLabel('职业背景', { exact: true }).isEnabled(), false);
    await page.getByText('已保存，下一次 Cloud 日报读取时生效。', { exact: true }).waitFor();
    // Loading, read failure, damaged data and empty configuration.
    mode = 'loading'; await page.goto(base + '/library/preferences');
    await page.getByText('正在读取资料…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
    await page.getByLabel('职业背景', { exact: true }).waitFor();
    mode = 'load-failure'; await page.reload(); await page.getByText('合成读取失败', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), false);
    mode = 'normal'; remote.readFailed = true; await page.reload(); await page.getByRole('alert').filter({ hasText: /读取异常/ }).waitFor();
    assert.equal(await page.getByLabel('职业背景', { exact: true }).count(), 0);
    remote = { version: 0, context: {}, createdAt: null, updatedAt: null, readFailed: false }; await open();
    await page.getByLabel('语言', { exact: true }).fill('zh-CN');
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.tagName !== 'BODY'));
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), true);
    const storedKeys = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    assert.ok(!storedKeys.some(key => /context|preferences|profile/.test(key)), 'personal draft must not be persisted in browser storage');
    assert.ok(mutations.every(path => path === '/api/daily-report/cloud-context'), `unexpected mutation: ${mutations}`);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ viewports: 4, themes: 2, checks: ['five-groups', 'add-remove', 'reload', 'unknown-fields', 'save-failure', 'conflict', 'unsaved-link', 'unsaved-back', 'two-settings-entries', 'loading', 'load-failure', 'corrupt-data', 'empty', 'keyboard', 'memory-only', 'no-other-mutations'], errors, writes: mutations.length }, null, 2));
    console.log(JSON.stringify({ result: 'PASS', output, pageErrors: errors.length, writes: mutations.length }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') });
      console.error(JSON.stringify({ output, url: page.url(), pageErrors: errors, text: (await page.locator('body').innerText()).slice(-4500) }));
    }
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
