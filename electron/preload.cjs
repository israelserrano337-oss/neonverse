// Puente seguro entre la interfaz y el proceso principal (sin acceso directo a Node desde la página).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neonDesktop', {
  isDesktop: true,
  platform: process.platform,
  ffmpegInfo: () => ipcRenderer.invoke('ffmpeg:info'),
  exportStart: (opts) => ipcRenderer.invoke('export:start', opts),
  exportFrame: (pixels) => ipcRenderer.invoke('export:frame', pixels),
  exportFinish: () => ipcRenderer.invoke('export:finish'),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  saveFile: (o) => ipcRenderer.invoke('file:save', o),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  selftestDone: (r) => ipcRenderer.invoke('selftest:done', r),
});
