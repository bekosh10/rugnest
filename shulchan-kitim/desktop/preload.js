const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: patch => ipcRenderer.invoke('cfg:set', patch),
  savePdf: opts => ipcRenderer.invoke('save-pdf', opts),
  reveal: p => ipcRenderer.invoke('reveal', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
});
