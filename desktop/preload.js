const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rugdesk', {
  getCfg: () => ipcRenderer.invoke('cfg:get'),
  setCfg: patch => ipcRenderer.invoke('cfg:set', patch),
  pickFolder: opts => ipcRenderer.invoke('pick-folder', opts),
  listPdfs: dir => ipcRenderer.invoke('list-pdfs', dir),
  readFile: p => ipcRenderer.invoke('read-file', p),
  saveFile: (job, name, data, kind) => ipcRenderer.invoke('save-file', { job, name, data, kind }),
  reveal: p => ipcRenderer.invoke('reveal', p),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  readJob: p => ipcRenderer.invoke('read-job', p),
  onOpenJob: cb => ipcRenderer.on('open-job', (e, p) => cb(p)),
});
