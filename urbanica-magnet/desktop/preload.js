const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desk', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: patch => ipcRenderer.invoke('cfg:set', patch),
  pickFolder: opts => ipcRenderer.invoke('pick-folder', opts),
  pathOf: file => webUtils.getPathForFile(file),
  scan: paths => ipcRenderer.invoke('scan', paths),
  exportFiles: job => ipcRenderer.invoke('export', job),
  saveDialog: opts => ipcRenderer.invoke('save-dialog', opts),
  openText: opts => ipcRenderer.invoke('open-text', opts),
  readRange: opts => ipcRenderer.invoke('read-range', opts),
  htmlToPdf: html => ipcRenderer.invoke('html-to-pdf', html),
  reveal: p => ipcRenderer.invoke('reveal', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
});
