// סידור שטיחים לזונד – desktop shell.
// The page itself (index.html) is the same tool as the online version; this shell gives it
// real folders (rug library, output folders) and updates from GitHub.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const REPO = 'bekosh10/rugnest';
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const BUNDLED = path.join(__dirname, 'app');
const USERDATA = () => app.getPath('userData');
const UPDATED = () => path.join(USERDATA(), 'page');           // downloaded newer page lives here
const CFG_FILE = () => path.join(USERDATA(), 'config.json');
const DOCS = () => path.join(app.getPath('documents'), 'סידור שטיחים');

if (process.env.RUGNEST_USERDATA) app.setPath('userData', process.env.RUGNEST_USERDATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/* ---------- config ---------- */
function defaults() {
  return { rugDir: '/Volumes/DATA/all_rugs', outDir: path.join(DOCS(), 'קבצים'), jobsDir: path.join(DOCS(), 'עבודות') };
}
function readCfg() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')) }; } catch (e) { return defaults(); }
}
function writeCfg(c) { fs.mkdirSync(USERDATA(), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(c, null, 2)); }

/* ---------- which page to show: the newer of bundled / downloaded ---------- */
const verOf = dir => { try { return +JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || 0; } catch (e) { return 0; } };
const pageDir = () => (verOf(UPDATED()) > verOf(BUNDLED) && fs.existsSync(path.join(UPDATED(), 'index.html'))) ? UPDATED() : BUNDLED;
const currentVersion = () => Math.max(verOf(BUNDLED), fs.existsSync(path.join(UPDATED(), 'index.html')) ? verOf(UPDATED()) : 0);

/* ---------- local copies of the libraries the page loads from cdnjs (works offline) ---------- */
const LIBS = {
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': 'jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js': 'pdf-lib.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': 'pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js': 'pdf.worker.min.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

function setupProtocols() {
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.includes('..')) return new Response('no', { status: 403 });
    const base = rel.startsWith('lib/') ? BUNDLED : pageDir();
    const file = path.join(base, rel);
    try { const data = await fsp.readFile(file); return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } }); }
    catch (e) { return new Response('not found', { status: 404 }); }
  });
  protocol.handle('https', async req => {
    const lib = LIBS[req.url];
    if (lib) { const data = await fsp.readFile(path.join(BUNDLED, 'lib', lib)); return new Response(data, { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } }); }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

/* ---------- window ---------- */
let win = null, pendingOpen = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1000, minHeight: 650, title: 'סידור שטיחים לזונד',
    backgroundColor: '#f4f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL('app://rugnest/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-finish-load', () => { if (pendingOpen) { win.webContents.send('open-job', pendingOpen); pendingOpen = null; } });
  win.on('closed', () => { win = null; });
}

/* ---------- bridge ---------- */
ipcMain.handle('cfg:get', () => ({ ...readCfg(), version: currentVersion(), docs: DOCS(), platform: process.platform }));
ipcMain.handle('cfg:set', (e, patch) => { const c = { ...readCfg(), ...patch }; writeCfg(c); return c; });
ipcMain.handle('pick-folder', async (e, { title, start } = {}) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'בחירת תיקייה', defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
// every PDF under a folder (sub folders too): [{name, rel, path, size}]
ipcMain.handle('list-pdfs', async (e, dir) => {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'missing', files: [] };
  const root = path.basename(dir);
  async function walk(d, rel) {
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (err) { return; }
    for (const en of ents) {
      if (en.name.startsWith('.')) continue;
      const full = path.join(d, en.name), r = rel + '/' + en.name;
      if (en.isDirectory()) await walk(full, r);
      else if (/\.pdf$/i.test(en.name)) { let size = 0; try { size = (await fsp.stat(full)).size; } catch (err) {} out.push({ name: en.name.normalize('NFC'), rel: r.normalize('NFC'), path: full, size }); }
    }
  }
  await walk(dir, root);
  return { ok: true, files: out };
});
ipcMain.handle('read-file', async (e, p) => { const b = await fsp.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
// save an exported file into <outDir>/<job>/<name>
ipcMain.handle('save-file', async (e, { job, name, data, kind }) => {
  const c = readCfg();
  const base = kind === 'job' ? c.jobsDir : path.join(c.outDir, (job || 'rugs').replace(/[\\/:*?"<>|]/g, '-'));
  await fsp.mkdir(base, { recursive: true });
  const file = path.join(base, name.replace(/[\\/:*?"<>|]/g, '-'));
  await fsp.writeFile(file, Buffer.from(data));
  return file;
});
// job file: always ask where to save (starts in the last folder used)
ipcMain.handle('save-as', async (e, { name, data }) => {
  const c = readCfg();
  const start = c.lastJobDir && fs.existsSync(c.lastJobDir) ? c.lastJobDir : c.jobsDir;
  try { fs.mkdirSync(start, { recursive: true }); } catch (err) {}
  const r = await dialog.showSaveDialog(win, { title: 'שמירת עבודה', defaultPath: path.join(start, name.replace(/\.zip$/i, '')), filters: [{ name: 'עבודת שטיחים', extensions: ['rugjob'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (r.canceled || !r.filePath) return null;
  let file = r.filePath; if (!/\.rugjob$/i.test(file)) file += '.rugjob';
  await fsp.writeFile(file, Buffer.from(data));
  writeCfg({ ...c, lastJobDir: path.dirname(file) });
  return file;
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
    if (!/<html|<!doctype/i.test(html.slice(0, 2000)) || html.length < 50000) throw new Error('קובץ לא תקין');
    const tmp = UPDATED() + '.tmp';
    await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(path.join(tmp, 'index.html'), html); await fsp.writeFile(path.join(tmp, 'version.json'), vj);
    await fsp.rm(UPDATED(), { recursive: true, force: true }); await fsp.rename(tmp, UPDATED());
    setTimeout(() => win && win.reload(), 300);
    return { ok: true, version: +JSON.parse(vj).version };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

/* ---------- opening a job file by double click ---------- */
app.on('open-file', (e, p) => { e.preventDefault(); if (win && !win.webContents.isLoading()) win.webContents.send('open-job', p); else pendingOpen = p; });
ipcMain.handle('read-job', async (e, p) => { const b = await fsp.readFile(p); return { name: path.basename(p), data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) }; });

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'toggleDevTools', label: 'כלי מפתח' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  for (const d of [readCfg().outDir, readCfg().jobsDir]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }
  setupProtocols();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
