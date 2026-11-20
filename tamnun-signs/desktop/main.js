// Tamnun Signs – desktop shell (Windows + Mac).
// The logic lives in index.html + core.js (updated from GitHub); this shell gives it
// file reading, folder picking and writing the export folder. Source files are never changed.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const RAW = 'https://raw.githubusercontent.com/bekosh10/rugnest/main/tamnun-signs';
const PAGE_FILES = ['index.html', 'core.js'];
const BUNDLED = path.join(__dirname, 'app');
const USERDATA = () => app.getPath('userData');
const UPDATED = () => path.join(USERDATA(), 'page');
const CFG_FILE = () => path.join(USERDATA(), 'config.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function readCfg() { try { return JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); } catch (e) { return {}; } }
function writeCfg(c) { fs.mkdirSync(USERDATA(), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(c, null, 2)); }

const verOf = dir => { try { return +JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || 0; } catch (e) { return 0; } };
const hasUpd = () => PAGE_FILES.every(f => fs.existsSync(path.join(UPDATED(), f)));
const pageDir = () => (hasUpd() && verOf(UPDATED()) > verOf(BUNDLED)) ? UPDATED() : BUNDLED;
const currentVersion = () => Math.max(verOf(BUNDLED), hasUpd() ? verOf(UPDATED()) : 0);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

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
    width: 1450, height: 920, minWidth: 1000, minHeight: 600, title: 'תמנון – שילוט',
    backgroundColor: '#f4f6f8', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL('app://tamnun/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { win = null; });
}

/* ---------- bridge ---------- */
const SHELL_VERSION = 3;   // 2 = export into sub-folders (machine / type); 3 = graphics bank in a shared (network) folder
ipcMain.handle('cfg:get', () => ({ ...readCfg(), version: currentVersion(), shellVersion: SHELL_VERSION }));
ipcMain.handle('cfg:set', (e, patch) => { const c = { ...readCfg(), ...patch }; writeCfg(c); return c; });

ipcMain.handle('pick-folder', async (e, { title, start } = {}) => {
  if (process.env.TAMNUN_TEST_DIR) return process.env.TAMNUN_TEST_DIR;
  const cfg = readCfg();
  const r = await dialog.showOpenDialog(win, { title: title || 'בחירת תיקייה', defaultPath: start || cfg.lastExport, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  writeCfg({ ...cfg, lastExport: r.filePaths[0] });
  return r.filePaths[0];
});

// all pdf / xlsx files under the dropped paths
ipcMain.handle('scan', async (e, paths) => {
  const out = [];
  async function walk(full) {
    let st; try { st = await fsp.stat(full); } catch (err) { return; }
    const name = path.basename(full);
    if (name.startsWith('.') || name.startsWith('~$')) return;
    if (st.isDirectory()) {
      let ents = []; try { ents = await fsp.readdir(full); } catch (err) { return; }
      for (const n of ents.sort()) await walk(path.join(full, n));
    } else if (/\.(pdf|xlsx)$/i.test(name)) out.push({ path: full, size: st.size });
  }
  for (const p of paths || []) await walk(p);
  return out;
});
ipcMain.handle('read-file', async (e, p) => { const b = await fsp.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });

// write the export: <parent>/<folderName>/<machine>/<file>.pdf + report
ipcMain.handle('export', async (e, { parent, folderName, files, report }) => {
  try {
    const clean = s => String(s).replace(/"/g, "''").replace(/[\\/:*?<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
    let dir = path.join(parent, clean(folderName)), n = 2;
    while (fs.existsSync(dir)) dir = path.join(parent, `${clean(folderName)} (${n++})`);
    await fsp.mkdir(dir, { recursive: true });
    for (const f of files) {
      const sub = path.join(dir, ...[].concat(f.sub).filter(Boolean).map(clean));
      await fsp.mkdir(sub, { recursive: true });
      await fsp.writeFile(path.join(sub, clean(f.name)), Buffer.from(f.data), { flag: 'wx' });
    }
    if (report) await fsp.writeFile(path.join(dir, `${clean(folderName)} - דוח.xlsx`), Buffer.from(report));
    shell.openPath(dir);
    return { ok: true, dir, count: files.length };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('reveal', (e, p) => { if (p && fs.existsSync(p)) { shell.openPath(p); return true; } return false; });

/* ---------- graphics bank in a shared folder ---------- */
// default: the same folder on the DATA drive for every computer. On Windows the drive letter is found by itself.
const BANK_REL = ['במה - לא למחוק', 'תמנון קבצי גרפיקה קבועים - לא למחוק'];
function bankCandidates() {
  const out = [];
  if (process.platform === 'darwin') out.push(path.join('/Volumes/DATA', ...BANK_REL));
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) {                 // C: … Z:
      const d = String.fromCharCode(c) + ':\\';
      out.push(path.join(d, ...BANK_REL), path.join(d, 'DATA', ...BANK_REL));
    }
  }
  return out;
}
ipcMain.handle('bank:dir', async () => {
  const cfg = readCfg();
  if (cfg.bankDir) return { dir: cfg.bankDir, ok: fs.existsSync(cfg.bankDir), chosen: true };
  for (const c of bankCandidates()) { try { if (fs.existsSync(c)) return { dir: c, ok: true, chosen: false }; } catch (e) {} }
  return { dir: process.platform === 'darwin' ? bankCandidates()[0] : '', ok: false, chosen: false, hint: BANK_REL.join(path.sep) };
});
ipcMain.handle('bank:choose', async () => {
  const cfg = readCfg();
  const r = await dialog.showOpenDialog(win, { title: 'תיקיית בנק הגרפיקות', defaultPath: cfg.bankDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  writeCfg({ ...readCfg(), bankDir: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('bank:reset', async () => { const c = readCfg(); delete c.bankDir; writeCfg(c); return true; });
const inBank = (dir, rel) => { const f = path.resolve(dir, rel); if (!f.startsWith(path.resolve(dir))) throw new Error('bad path'); return f; };
ipcMain.handle('bank:list', async (e, dir) => {
  const out = [];
  async function walk(d, rel) {
    let ents = []; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (err) { return; }
    for (const en of ents) {
      if (en.name.startsWith('.') || en.name.startsWith('~')) continue;
      const full = path.join(d, en.name), r = rel ? rel + '/' + en.name : en.name;
      if (en.isDirectory()) await walk(full, r);
      else if (/\.(pdf|json)$/i.test(en.name)) { try { const st = await fsp.stat(full); out.push({ rel: r.normalize('NFC'), size: st.size, mtime: st.mtimeMs }); } catch (err) {} }
    }
  }
  await walk(dir, '');
  return out;
});
ipcMain.handle('bank:read', async (e, { dir, rel }) => { const b = await fsp.readFile(inBank(dir, rel)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('bank:write', async (e, { dir, rel, data }) => {
  const f = inBank(dir, rel); await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + process.pid; await fsp.writeFile(tmp, Buffer.from(data)); await fsp.rename(tmp, f); return true;
});
ipcMain.handle('bank:delete', async (e, { dir, rel }) => { await fsp.rm(inBank(dir, rel), { force: true }); return true; });

/* ---------- updates ---------- */
// GitHub raw first; if it is blocked or down, the same files through jsDelivr
const MIRRORS = [RAW, 'https://cdn.jsdelivr.net/gh/bekosh10/rugnest@main/tamnun-signs'];
async function fetchOne(u) { const r = await net.fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
async function fetchText(u) {
  let last;
  for (const base of MIRRORS) {
    try { return await fetchOne(u.replace(RAW, base)); } catch (e) { last = e; }
  }
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
    const got = {};
    for (const f of PAGE_FILES) got[f] = await fetchText(`${RAW}/${f}`);
    if (!/<!doctype html/i.test(got['index.html'].slice(0, 200)) || !got['index.html'].includes('TAMNUN_APP') || !got['core.js'].includes('TamnunCore')) throw new Error('קובץ לא תקין');
    const tmp = UPDATED() + '.tmp';
    await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
    for (const f of PAGE_FILES) await fsp.writeFile(path.join(tmp, f), got[f]);
    await fsp.writeFile(path.join(tmp, 'version.json'), vj);
    await fsp.rm(UPDATED(), { recursive: true, force: true }); await fsp.rename(tmp, UPDATED());
    setTimeout(() => win && win.reload(), 300);
    return { ok: true, version: +JSON.parse(vj).version };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu', label: 'עריכה' },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'toggleDevTools', label: 'כלי מפתח' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  setupProtocol();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
