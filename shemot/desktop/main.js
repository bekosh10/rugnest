// שינוי שמות – desktop shell.
// All the renaming logic lives in index.html (updated from GitHub); this shell gives it
// folders, file copying and saving. The original files are never changed – only copied.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const RAW = 'https://raw.githubusercontent.com/bekosh10/rugnest/main/shemot';
const BUNDLED = path.join(__dirname, 'app');
const USERDATA = () => app.getPath('userData');
const UPDATED = () => path.join(USERDATA(), 'page');
const CFG_FILE = () => path.join(USERDATA(), 'config.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/* ---------- config (settings + mapping, written by the page) ---------- */
function readCfg() { try { return JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); } catch (e) { return {}; } }
function writeCfg(c) { fs.mkdirSync(USERDATA(), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(c, null, 2)); }

/* ---------- page: the newer of bundled / downloaded ---------- */
const verOf = dir => { try { return +JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || 0; } catch (e) { return 0; } };
const hasUpd = () => fs.existsSync(path.join(UPDATED(), 'index.html'));
const pageDir = () => (hasUpd() && verOf(UPDATED()) > verOf(BUNDLED)) ? UPDATED() : BUNDLED;
const currentVersion = () => Math.max(verOf(BUNDLED), hasUpd() ? verOf(UPDATED()) : 0);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function setupProtocol() {
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.includes('..')) return new Response('no', { status: 403 });
    const base = rel.startsWith('lib/') ? BUNDLED : pageDir();
    const file = path.join(base, rel);
    try { const data = await fsp.readFile(file); return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } }); }
    catch (e) { return new Response('not found', { status: 404 }); }
  });
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 950, minHeight: 600, title: 'שינוי שמות',
    backgroundColor: '#f4f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL('app://shemot/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // dropping a folder outside the drop zone must not navigate away
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { win = null; });
}

const SKIP = /^(\.|~\$)|\.(command|app|sh|zip|xlsx|xls|csv|txt|gfn|json)$/i;

/* ---------- bridge ---------- */
ipcMain.handle('cfg:get', () => ({ ...readCfg(), version: currentVersion() }));
ipcMain.handle('cfg:set', (e, patch) => { const c = { ...readCfg(), ...patch }; writeCfg(c); return c; });

ipcMain.handle('pick-folder', async (e, { title, start } = {}) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'בחירת תיקייה', defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// all files under the given paths. rel starts with the dropped folder's own name.
ipcMain.handle('scan', async (e, paths) => {
  const out = [];
  async function walk(full, rel) {
    let st; try { st = await fsp.stat(full); } catch (err) { return; }
    const name = path.basename(full);
    if (st.isDirectory()) {
      if (name.startsWith('.') || /\.app$/i.test(name)) return;
      let ents = []; try { ents = await fsp.readdir(full); } catch (err) { return; }
      ents.sort((a, b) => a.localeCompare(b, 'he'));
      for (const n of ents) await walk(path.join(full, n), rel ? rel + '/' + n : n);
    } else if (!SKIP.test(name)) {
      out.push({ path: full, rel: rel.normalize('NFC'), size: st.size });
    }
  }
  for (const p of paths || []) await walk(p, path.basename(p));
  return out;
});

// copy everything flat into a NEW folder <parent>/<folderName> (adds (2), (3)… if it exists)
ipcMain.handle('export', async (e, { parent, folderName, items, xlsx }) => {
  try {
    const clean = s => s.replace(/[\\/:*?"<>|]/g, '-').trim();
    let dir = path.join(parent, clean(folderName)), n = 2;
    while (fs.existsSync(dir)) dir = path.join(parent, `${clean(folderName)} (${n++})`);
    await fsp.mkdir(dir, { recursive: true });
    for (const it of items) await fsp.copyFile(it.src, path.join(dir, clean(it.name)), fs.constants.COPYFILE_EXCL);
    let xlsxPath = null;
    if (xlsx) { xlsxPath = dir + '.xlsx'; await fsp.writeFile(xlsxPath, Buffer.from(xlsx)); }
    shell.openPath(dir);
    return { ok: true, dir, xlsxPath, count: items.length };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

ipcMain.handle('save-dialog', async (e, { name, data, title, ext, extName, start }) => {
  const r = await dialog.showSaveDialog(win, { title: title || 'שמירה', defaultPath: start ? path.join(start, name) : name, filters: [{ name: extName || ext, extensions: [ext] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('open-text', async (e, { title, ext }) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'פתיחה', filters: [{ name: ext, extensions: [ext] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fsp.readFile(r.filePaths[0], 'utf8');
});
ipcMain.handle('reveal', (e, p) => { if (p && fs.existsSync(p)) { if (fs.statSync(p).isDirectory()) shell.openPath(p); else shell.showItemInFolder(p); return true; } return false; });

/* ---------- updates ---------- */
async function fetchText(u) { const r = await net.fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
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
    if (!/<!doctype html/i.test(html.slice(0, 200)) || !html.includes('SHEMOT_APP')) throw new Error('קובץ לא תקין');
    const tmp = UPDATED() + '.tmp';
    await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(path.join(tmp, 'index.html'), html); await fsp.writeFile(path.join(tmp, 'version.json'), vj);
    await fsp.rm(UPDATED(), { recursive: true, force: true }); await fsp.rename(tmp, UPDATED());
    setTimeout(() => win && win.reload(), 300);
    return { ok: true, version: +JSON.parse(vj).version };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'toggleDevTools', label: 'כלי מפתח' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  setupProtocol();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
