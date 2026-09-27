// Built-page check with synthetic authenticated API responses only.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const dist = path.resolve(__dirname, '..', 'dist');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-research-browser-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const requested = path.resolve(dist, '.' + new URL(req.url, 'http://local').pathname);
  if (!requested.startsWith(dist + path.sep)) { res.writeHead(403); return res.end(); }
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  let mode = 'populated';
  let proposalStatus = 'draft';
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-only'));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } } });
      if (url.pathname === '/api/research/runs') {
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: '合成读取失败' } });
        return route.fulfill({ json: { runs: mode === 'empty' ? [] : [{
          id: 'run-1', subjectKey: 'synthetic', subjectTitle: '很长的研究对象标题'.repeat(15),
          question: '这项公开资料有什么新变化？'.repeat(20), status: 'completed',
          resultBody: '合成研究结论。'.repeat(65), eventRevisionId: 'synthetic-revision',
          createdAt: '2026-09-27T02:00:00.000Z',
        }] } });
      }
      if (url.pathname === '/api/research/runs/run-1') return route.fulfill({ json: { context: {
        eventTitle: '合成公开事件', revisionNo: 2, evidence: [{ id: 'evidence-1',
          url: 'https://example.org/source', sourceFact: '合成来源事实。', publisherKey: '示例官方来源',
          reviewState: 'verified', publishedAt: '2026-09-26',
        }],
      } } });
      if (url.pathname === '/api/research/proposals') return route.fulfill({ json: { proposals: mode === 'empty' ? [] : [{
        id: 'proposal-1', runId: 'run-1', subjectKey: 'synthetic', body: '建议观点仅为草稿。'.repeat(45),
        baseVersionId: 'version-1', status: proposalStatus, createdAt: '2026-09-27T02:10:00.000Z',
      }] } });
      if (url.pathname === '/api/research/theses/synthetic') return route.fulfill({ json: { versions: [{
        id: 'version-1', body: '此前经用户确认的观点。', previousVersionId: null, confirmedAt: '2026-09-26T02:00:00.000Z',
      }] } });
      if (url.pathname === '/api/research/proposals/proposal-1/decision') {
        proposalStatus = JSON.parse(route.request().postData()).decision === 'confirm' ? 'confirmed' : 'rejected';
        return route.fulfill({ json: { proposal: { status: proposalStatus }, version: null } });
      }
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/research');
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
        await page.goto(base + '/research');
        await page.getByRole('heading', { name: '研究与观点' }).waitFor();
        await page.getByText('建议观点仅为草稿。', { exact: false }).first().waitFor();
        await page.getByRole('button', { name: /待确认草稿/ }).click();
        await page.getByText('此前经用户确认的观点。').waitFor();
        await page.getByRole('link', { name: '示例官方来源 · 查看来源' }).waitFor();
        assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), theme === 'dark');
        const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(widths[0] <= widths[1] + 1, `${width} ${theme} horizontal overflow: ${widths}`);
        assert.equal(await page.getByRole('button', { name: '确认观点' }).isEnabled(), true);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-review.png`), fullPage: true });
        await page.getByRole('heading', { name: '核对提案' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-decision.png`) });
        await page.getByRole('button', { name: '确认观点' }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-actions.png`) });
      }
    }
    await page.getByRole('button', { name: '确认观点' }).click();
    await page.getByRole('button', { name: /已确认/ }).waitFor();
    assert.equal(proposalStatus, 'confirmed');
    mode = 'empty';
    await page.reload();
    await page.getByText('尚无研究记录。').waitFor();
    mode = 'error';
    await page.reload();
    await page.getByRole('alert').getByText('合成读取失败').waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', viewports: 4, themes: 2, states: ['review', 'confirmed', 'empty', 'error'], output }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
