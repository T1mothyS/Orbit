/** Electron desktop shell for the hosted Orbit application. */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Preserve the established desktop profile across the brand rename.
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), '智能日程表'));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let rendererUrl = '';
let openTodayOnStart = false;

function widgetSync(): { group: string; executable: string } | undefined {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  try {
    const group = fs.readFileSync(path.join(process.resourcesPath, 'orbit-widget-group.txt'), 'utf8').trim();
    if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(group)) return;
    const executable = path.join(process.resourcesPath, '..', 'Helpers', 'OrbitWidgetSync');
    if (fs.existsSync(executable)) return { group, executable };
  } catch { return undefined; }
}

function widgetSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (!rendererUrl || !event.senderFrame || event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === new URL(rendererUrl).origin; }
  catch { return false; }
}

function widgetSnapshot(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  const { date, generatedAt, validUntil, remaining, completed, items } = input;
  const now = Date.now();
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof generatedAt !== 'number' || !Number.isSafeInteger(generatedAt) || Math.abs(generatedAt - now) > 300000 ||
      typeof validUntil !== 'number' || !Number.isSafeInteger(validUntil) || validUntil <= generatedAt || validUntil - generatedAt > 26 * 3600000 ||
      typeof remaining !== 'number' || !Number.isSafeInteger(remaining) || remaining < 0 ||
      typeof completed !== 'number' || !Number.isSafeInteger(completed) || completed < 0 ||
      !Array.isArray(items) || items.length > 12) return;
  return { date, generatedAt, validUntil, remaining, completed, items: items.flatMap(item =>
    item && typeof item.title === 'string' && typeof item.time === 'string' && typeof item.completed === 'boolean'
      ? [{ title: item.title.slice(0, 160), time: item.time.slice(0, 8), completed: item.completed }] : [],
  ) };
}

function runWidgetSync(command: 'write' | 'clear', input?: string): boolean {
  const sync = widgetSync();
  if (!sync) return false;
  const result = spawnSync(sync.executable, [sync.group, command], { input, stdio: ['pipe', 'ignore', 'ignore'], timeout: 2500 });
  return result.status === 0;
}

ipcMain.handle('today-widget-available', event => widgetSender(event) && !!widgetSync());
ipcMain.handle('today-widget-clear', event => widgetSender(event) && runWidgetSync('clear'));
ipcMain.handle('today-widget-write', (event, input: unknown) => {
  if (!widgetSender(event)) return false;
  const snapshot = widgetSnapshot(input);
  return !!snapshot && runWidgetSync('write', JSON.stringify(snapshot));
});

app.on('open-url', (event, url) => {
  if (url !== 'orbit-today://open' && url !== 'orbit-today://open/') return;
  event.preventDefault();
  if (!rendererUrl || !mainWindow) {
    openTodayOnStart = true;
    if (rendererUrl && app.isReady()) createWindow();
    return;
  }
  void mainWindow.loadURL(new URL('/today', rendererUrl).href);
  mainWindow.show();
  mainWindow.focus();
});

function safeHttpUrl(value: string, allowLocalHttp: boolean): URL {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('桌面端地址必须是完整 URL'); }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(allowLocalHttp && local && parsed.protocol === 'http:')) {
    throw new Error('桌面端生产地址必须使用 HTTPS');
  }
  if (parsed.username || parsed.password) throw new Error('桌面端地址不能包含账号密码');
  return parsed;
}

function resolveRendererUrl(): string {
  if (isDev) return safeHttpUrl(process.env.ELECTRON_DEV_URL || 'http://localhost:5173', true).toString();
  let bundledUrl = '';
  const bundledConfig = path.join(__dirname, 'app-url.json');
  if (fs.existsSync(bundledConfig)) {
    try { bundledUrl = String(JSON.parse(fs.readFileSync(bundledConfig, 'utf8')).appUrl || ''); }
    catch { throw new Error('安装包内的 app-url.json 已损坏'); }
  }
  const configured = process.env.ELECTRON_APP_URL || process.env.APP_URL || bundledUrl;
  if (!configured) throw new Error('缺少 ELECTRON_APP_URL，安装包无法连接 Orbit 服务');
  return safeHttpUrl(configured, false).toString();
}

function iconPath(): string | undefined {
  const candidates = isDev
    ? [path.resolve(__dirname, '../public/orbit-logo.png')]
    : [path.resolve(__dirname, 'schedule.png')];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function openExternal(url: string): void {
  try {
    const parsed = safeHttpUrl(url, isDev);
    void shell.openExternal(parsed.toString());
  } catch {
    // Ignore file:, javascript:, custom protocols, and malformed external URLs.
  }
}

function createWindow(): void {
  const icon = iconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 390,
    minHeight: 640,
    title: 'Orbit',
    ...(icon ? { icon } : {}),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const allowedOrigin = new URL(rendererUrl).origin;
  void mainWindow.loadURL(openTodayOnStart ? new URL('/today', rendererUrl).href : rendererUrl);
  openTodayOnStart = false;
  if (isDev && process.env.ELECTRON_OPEN_DEVTOOLS === 'true') mainWindow.webContents.openDevTools();

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== allowedOrigin) openExternal(url);
    } catch { /* malformed URL is denied */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === allowedOrigin) return;
    } catch { /* deny malformed navigation */ }
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.on('close', event => {
    if (quitting || process.platform === 'darwin') return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(): void {
  const icon = iconPath();
  if (!icon) return;
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 24, height: 24 }));
  tray.setToolTip('Orbit');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Orbit', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '显示主窗口', accelerator: 'CmdOrCtrl+Shift+A', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: '退出', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, ...(isDev ? [{ role: 'toggleDevTools' as const }] : []), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
}

ipcMain.on('window-minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.on('window-maximize', event => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.on('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle('show-notification', (_event, input: unknown) => {
  if (!Notification.isSupported() || !input || typeof input !== 'object') return false;
  const record = input as Record<string, unknown>;
  const title = String(record.title || '').trim().slice(0, 120);
  const body = String(record.body || '').trim().slice(0, 500);
  if (!title) return false;
  new Notification({ title, body }).show();
  return true;
});

app.whenReady().then(() => {
  try { rendererUrl = resolveRendererUrl(); }
  catch (error) {
    dialog.showErrorBox('Orbit 无法启动', error instanceof Error ? error.message : '桌面端配置不正确');
    app.quit();
    return;
  }
  createMenu();
  createWindow();
  createTray();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // The tray intentionally keeps the desktop shell alive.
});
