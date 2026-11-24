const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('x55Native', {
  isHandheld: true,
  platform: process.platform,
  scanLibrary: () => ipcRenderer.invoke('x55:scanLibrary'),
  readBookBuffer: async (filePath) => {
    const data = await ipcRenderer.invoke('x55:readBookBuffer', filePath);
    if (!data) return null;
    // Copy into clean ArrayBuffer for pdfjs-dist / jszip
    const uint8 = new Uint8Array(data);
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
  },
  loadState: () => ipcRenderer.invoke('x55:loadState'),
  saveState: (state) => ipcRenderer.invoke('x55:saveState', state),
  getBattery: () => ipcRenderer.invoke('x55:getBattery'),
  quitApp: () => ipcRenderer.invoke('x55:quitApp'),
});
