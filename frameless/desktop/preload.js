const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('native', {
  isNative: true,
  pickFolder: (def) => ipcRenderer.invoke('pick-folder', def),
  writeFile: (dir, name, data) => ipcRenderer.invoke('write-file', dir, name, data),
  saveDialog: (name, ext) => ipcRenderer.invoke('save-dialog', name, ext),
  writePath: (p, data) => ipcRenderer.invoke('write-path', p, data),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  pendingOpen: () => ipcRenderer.invoke('pending-open'),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, p) => cb(p))
});
