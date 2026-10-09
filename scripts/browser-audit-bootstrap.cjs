// Self-contained browser prelude. Never imported by the application or a production build.
function installAuditPrelude() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || window !== window.top || window.__orbitBrowserAudit) return;
  const messages = {
    schedule: '放弃本次未保存的编辑？',
    profile: '资料尚未保存，离开会丢弃当前修改。是否离开？',
    recurring: '有未保存的修改，确定放弃吗？',
  };
  const records = [], failures = [];
  let armed, status;
  const record = entry => {
    records.push({ at: Date.now(), path: location.pathname, ...entry });
    if (records.length > 200) records.shift();
    if (entry.unexpected) { failures.push(entry); if (failures.length > 100) failures.shift(); }
    if (status) status.textContent = `${records.length} 条记录；${failures.length} 项异常；${armed ? '已预设一次应答' : '默认拒绝未预设确认'}`;
    console.info('[orbit-browser-audit]', JSON.stringify(entry));
  };
  const respond = (type, message) => {
    const text = String(message ?? '');
    const key = Object.keys(messages).find(key => messages[key] === text);
    const expected = type === 'confirm' && armed && armed.key === key &&
      (armed.path === location.pathname || key === 'profile' && armed.popPath === location.pathname) && armed.until >= Date.now();
    const accepted = !!(expected && armed.accept);
    armed = undefined; // Every dialog consumes the one-shot expectation, including mismatches.
    record({ type, message: key ? text : '[unexpected message omitted]', decision: accepted ? 'accept' : 'dismiss', unexpected: !expected });
    return accepted;
  };
  window.confirm = message => respond('confirm', message);
  window.alert = message => { respond('alert', message); };
  window.prompt = message => { respond('prompt', message); return null; };
  // Registered before React: prevent native unload UI only in this explicit synthetic preview.
  window.addEventListener('beforeunload', event => {
    armed = undefined;
    event.stopImmediatePropagation();
    record({ type: 'beforeunload', decision: 'bypass', unexpected: false });
  }, true);
  // Browser POP changes location before the app's dirty guard runs. Capture only
  // that destination for an already armed profile scenario; other arms expire.
  window.addEventListener('popstate', () => { if (armed?.key === 'profile') armed.popPath = location.pathname; else armed = undefined; }, true);
  window.addEventListener('error', event => record({ type: 'pageerror', message: String(event.message).slice(0, 300), unexpected: true }));
  window.addEventListener('unhandledrejection', () => record({ type: 'pageerror', message: 'unhandled rejection (detail omitted)', unexpected: true }));
  const originalError = console.error;
  console.error = (...args) => { record({ type: 'console-error', message: 'see browser console; arguments omitted', unexpected: true }); originalError.apply(console, args); };
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    try {
      const response = await originalFetch.apply(window, args);
      if (!response.ok) record({ type: 'http-error', status: response.status, unexpected: true });
      return response;
    } catch (error) {
      if (error?.name !== 'AbortError') record({ type: 'requestfailed', message: 'fetch failed (URL and body omitted)', unexpected: true });
      throw error;
    }
  };
  window.__orbitBrowserAudit = { mode: 'synthetic-ui-audit', records, failures };
  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('details');
    panel.id = 'orbit-browser-audit-controls';
    panel.style.cssText = 'position:fixed;bottom:0;left:0;max-width:100%;box-sizing:border-box;z-index:10000;background:#fafafa;color:#171717;border:1px solid #666;padding:4px;font:12px/1.5 system-ui';
    const summary = document.createElement('summary'); summary.textContent = 'UI 自动化（仅合成预览）'; panel.append(summary);
    const choices = document.createElement('div'); choices.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;max-width:360px';
    for (const [key, label] of [['schedule', '日程'], ['profile', '资料离开'], ['recurring', '周期编辑']]) for (const accept of [false, true]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = `测试：下次${label}${accept ? '确认放弃' : '取消放弃'}`;
      button.style.cssText = 'min-height:44px;color:inherit;background:white;border:1px solid #666';
      button.onclick = () => { armed = { key, accept, path: location.pathname, until: Date.now() + 300000 }; panel.open = false; record({ type: 'armed', scenario: key, decision: accept ? 'accept' : 'dismiss', unexpected: false }); };
      choices.append(button);
    }
    status = document.createElement('p'); status.style.margin = '4px 0'; status.setAttribute('role', 'status');
    panel.append(choices, status); document.body.append(panel); record({ type: 'ready', unexpected: false });
  }, { once: true });
}

function createAuditVitePlugin({ command, mode, synthetic, apiTarget }) {
  if (command !== 'serve' || mode !== 'ui-audit') return undefined;
  const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (synthetic !== 'true' || !apiTarget || !loopback(new URL(apiTarget).hostname)) throw new Error('ui-audit requires ORBIT_UI_AUDIT_SYNTHETIC=true and a loopback API_PROXY_TARGET with isolated synthetic data.');
  return {
    name: 'orbit-synthetic-browser-audit',
    apply: 'serve',
    configResolved(config) {
      if (!loopback(config.server.host)) throw new Error('ui-audit must bind a loopback host.');
    },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'script', children: `(${installAuditPrelude.toString()})();`, injectTo: 'head-prepend' }],
    },
  };
}
module.exports = { installAuditPrelude, createAuditVitePlugin };
