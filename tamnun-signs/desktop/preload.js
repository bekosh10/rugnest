const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: patch => ipcRenderer.invoke('cfg:set', patch),
  pickFolder: opts => ipcRenderer.invoke('pick-folder', opts),
  pathOf: file => webUtils.getPathForFile(file),
  scan: paths => ipcRenderer.invoke('scan', paths),
  readFile: p => ipcRenderer.invoke('read-file', p),
  exportFiles: job => ipcRenderer.invoke('export', job),
  reveal: p => ipcRenderer.invoke('reveal', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
});
