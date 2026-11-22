// מערכת לפריימלסים – desktop shell (Mac).
// The whole app is one HTML file (index.html, updated from GitHub); this shell gives it
// folder picking, saving files, reading job files and updates. Source PDFs are never changed.
const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const RAW = 'https://raw.githubusercontent.com/bekosh10/rugnest/main/frameless';
const MIRRORS = [RAW, 'https://cdn.jsdelivr.net/gh/bekosh10/rugnest@main/frameless'];
const BUNDLED = path.join(__dirname, 'app');
const UPDATED = () => path.join(app.getPath('userData'), 'page');
const LAST_SAVE = () => path.join(app.getPath('userData'), 'last-save-dir');

const verOf = dir => { try { return +JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || 0; } catch (e) { return 0; } };
const hasUpd = () => fs.existsSync(path.join(UPDATED(), 'index.html'));
const pageDir = () => (hasUpd() && verOf(UPDATED()) > verOf(BUNDLED)) ? UPDATED() : BUNDLED;
const currentVersion = () => Math.max(verOf(BUNDLED), hasUpd() ? verOf(UPDATED()) : 0);

/* ---------- opening a .pdfjob by double-click ---------- */
let win = null, pendingOpen = [];
const isJob = p => /\.pdfjob$/i.test(p || '');
function sendOpen(paths) {
  paths = paths.filter(isJob);
  if (!paths.length) return;
  if (win && win.webContents && !win.webContents.isLoading()) paths.forEach(p => win.webContents.send('open-file', p));
  else pendingOpen.push(...paths);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
}
app.on('open-file', (e, p) => { e.preventDefault(); sendOpen([p]); });
ipcMain.handle('pending-open', () => { const p = pendingOpen; pendingOpen = []; return p; });

function createWindow() {
  win = new BrowserWindow({
    width: 1420, height: 960, minWidth: 900, minHeight: 600, title: 'מערכת לפריימלסים',
    backgroundColor: '#f4f5f7',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.loadFile(path.join(pageDir(), 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // a PDF dropped outside the drop zone must not replace the app
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') || !url.endsWith('index.html')) e.preventDefault(); });
}

/* ---------- files ---------- */
const safeName = n => String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 200) || 'ללא שם';
ipcMain.handle('pick-folder', async (e, def) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'בחירת תיקייה לשמירת הקבצים', buttonLabel: 'שמירה כאן',
    defaultPath: def && fs.existsSync(def) ? def : app.getPath('desktop'), properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('write-file', async (e, dir, name, data) => {
  const p = path.join(dir, safeName(name));
  await fsp.writeFile(p, Buffer.from(data));
  return p;
});
ipcMain.handle('save-dialog', async (e, name, ext) => {
  let def = safeName(name);
  try { const last = fs.readFileSync(LAST_SAVE(), 'utf8'); if (fs.existsSync(last)) def = path.join(last, def); } catch (err) {}
  const r = await dialog.showSaveDialog(win, { defaultPath: def, filters: [{ name: ext === 'pdfjob' ? 'ג׳וב' : ext.toUpperCase(), extensions: [ext] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
  if (r.canceled || !r.filePath) return null;
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(LAST_SAVE(), path.dirname(r.filePath)); } catch (err) {}
  return r.filePath;
});
ipcMain.handle('write-path', async (e, p, data) => { await fsp.writeFile(p, Buffer.from(data)); });
ipcMain.handle('read-file', async (e, p) => { try { const b = await fsp.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); } catch (err) { return null; } });
ipcMain.handle('version', () => currentVersion());

/* ---------- updates ---------- */
async function fetchOne(u) { const r = await net.fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
async function fetchText(rel) {
  let last;
  for (const base of MIRRORS) { try { return await fetchOne(`${base}/${rel}`); } catch (e) { last = e; } }
  throw last;
}
ipcMain.handle('update:check', async () => {
  try {
    const j = JSON.parse(await fetchText('version.json'));
    const cur = currentVersion();
    return { ok: true, current: cur, latest: +j.version || 0, notes: j.notes || '', available: (+j.version || 0) > cur };
  } catch (err) { return { ok: false, current: currentVersion(), error: String(err.message || err) }; }
});
ipcMain.handle('update:apply', async () => {
  try {
    const vj = await fetchText('version.json');
    const html = await fetchText('index.html');
    if (!/<!doctype html/i.test(html.slice(0, 200)) || !html.includes('FRAMELESS_APP') || html.length < 500000) throw new Error('קובץ לא תקין');
    const tmp = UPDATED() + '.tmp';
    await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(path.join(tmp, 'index.html'), html);
    await fsp.writeFile(path.join(tmp, 'version.json'), vj);
    await fsp.rm(UPDATED(), { recursive: true, force: true }); await fsp.rename(tmp, UPDATED());
    setTimeout(() => win && win.loadFile(path.join(pageDir(), 'index.html')), 300);
    return { ok: true, version: +JSON.parse(vj).version };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu', label: 'עריכה' },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'toggleDevTools', label: 'כלי מפתח' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu', label: 'חלון' }
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
