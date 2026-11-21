// Shulchan Kitim (שולחן קיטים) – desktop shell.
// All the layout logic lives in index.html (updated from GitHub); this shell only gives it
// a window, the computer's "Save as" dialog, and the update check.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const RAW = 'https://raw.githubusercontent.com/bekosh10/rugnest/main/shulchan-kitim';
const MIRRORS = [RAW, 'https://cdn.jsdelivr.net/gh/bekosh10/rugnest@main/shulchan-kitim'];
const BUNDLED = path.join(__dirname, 'app');
const USERDATA = () => app.getPath('userData');
const UPDATED = () => path.join(USERDATA(), 'page');
const CFG_FILE = () => path.join(USERDATA(), 'config.json');
const MARKER = 'SHULCHAN_KITIM_APP';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/* ---------- small settings file (last save folder) ---------- */
function readCfg() { try { return JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); } catch (e) { return {}; } }
function writeCfg(c) { fs.mkdirSync(USERDATA(), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(c, null, 2)); }

/* ---------- page: the newer of bundled / downloaded ---------- */
const verOf = dir => { try { return +JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || 0; } catch (e) { return 0; } };
const hasUpd = () => fs.existsSync(path.join(UPDATED(), 'index.html'));
const pageDir = () => (hasUpd() && verOf(UPDATED()) > verOf(BUNDLED)) ? UPDATED() : BUNDLED;
const currentVersion = () => Math.max(verOf(BUNDLED), hasUpd() ? verOf(UPDATED()) : 0);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function setupProtocol() {
  const serve = async rel => {
    const base = rel.startsWith('lib/') ? BUNDLED : pageDir();   // libraries always come with the install
    const file = path.join(base, rel);
    const data = await fsp.readFile(file);
    return { data, type: MIME[path.extname(file)] || 'application/octet-stream' };
  };
  const relOf = url => decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html';
  if (protocol.handle) {
    protocol.handle('app', async req => {
      const rel = relOf(req.url);
      if (rel.includes('..')) return new Response('no', { status: 403 });
      try { const f = await serve(rel); return new Response(f.data, { headers: { 'content-type': f.type } }); }
      catch (e) { return new Response('not found', { status: 404 }); }
    });
  } else {                                   // very old Electron
    protocol.registerBufferProtocol('app', async (req, cb) => {
      const rel = relOf(req.url);
      try { const f = await serve(rel); cb({ mimeType: f.type.split(';')[0], data: f.data }); } catch (e) { cb({ statusCode: 404 }); }
    });
  }
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1000, minHeight: 650, title: 'שולחן קיטים',
    backgroundColor: '#e8ebed',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL('app://shulchan-kitim/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());   // a file dropped outside the drop zone must not replace the page
  win.on('closed', () => { win = null; });
}

/* ---------- bridge ---------- */
ipcMain.handle('cfg:get', () => ({ ...readCfg(), version: currentVersion() }));
ipcMain.handle('cfg:set', (e, patch) => { const c = { ...readCfg(), ...patch }; writeCfg(c); return c; });

// "Save as" with the suggested name; remembers the folder for next time
ipcMain.handle('save-pdf', async (e, { name, data }) => {
  const cfg = readCfg();
  const start = cfg.lastDir && fs.existsSync(cfg.lastDir) ? cfg.lastDir : app.getPath('documents');
  const clean = String(name || 'kit.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  const r = await dialog.showSaveDialog(win, {
    title: 'שמירת קובץ PDF', defaultPath: path.join(start, clean),
    filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (r.canceled || !r.filePath) return null;
  let fp = r.filePath; if (!/\.pdf$/i.test(fp)) fp += '.pdf';
  await fsp.writeFile(fp, Buffer.from(data));
  writeCfg({ ...cfg, lastDir: path.dirname(fp) });
  return { path: fp };
});
ipcMain.handle('reveal', (e, p) => { if (p && fs.existsSync(p)) { shell.showItemInFolder(p); return true; } return false; });

/* ---------- updates (index.html + version.json from GitHub) ---------- */
async function fetchOne(u) {
  const r = await net.fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
async function fetchText(u) {
  let last;
  for (const base of MIRRORS) { try { return await fetchOne(u.replace(RAW, base)); } catch (e) { last = e; } }
  throw last;
}
ipcMain.handle('update:check', async () => {
  try {
    const j = JSON.parse(await fetchText(`${RAW}/version.json`));
    const cur = currentVersion();
    return { ok: true, current: cur, latest: +j.version || 0, notes: j.notes || '', available: (+j.version || 0) > cur };
  } catch (err) { return { ok: false, current: currentVersion(), error: String(err.message || err) }; }
});
ipcMain.handle('update:apply', async () => {
  try {
    const vj = await fetchText(`${RAW}/version.json`);
    const html = await fetchText(`${RAW}/index.html`);
    if (!/<!doctype html/i.test(html.slice(0, 300)) || !html.includes(MARKER)) throw new Error('קובץ לא תקין');
    const tmp = UPDATED() + '.tmp';
    await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(path.join(tmp, 'index.html'), html); await fsp.writeFile(path.join(tmp, 'version.json'), vj);
    await fsp.rm(UPDATED(), { recursive: true, force: true }); await fsp.rename(tmp, UPDATED());
    setTimeout(() => win && win.reload(), 300);
    return { ok: true, version: +JSON.parse(vj).version };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu', label: 'עריכה' },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'toggleDevTools', label: 'כלי מפתח' }, { type: 'separator' }, { role: 'resetZoom', label: 'גודל רגיל' }, { role: 'zoomIn', label: 'הגדלה' }, { role: 'zoomOut', label: 'הקטנה' }, { role: 'togglefullscreen', label: 'מסך מלא' }] },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
  ]));
  setupProtocol();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
