const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAdd', {
  onOpen: (callback) => ipcRenderer.on('quickadd:open', (_event, payload) => callback(payload)),
  ready: (height) => ipcRenderer.send('quickadd:ready', height),
  resize: (height) => ipcRenderer.send('quickadd:resize', height),
  submit: (task) => ipcRenderer.send('quickadd:submit', task),
  close: () => ipcRenderer.send('quickadd:close')
});
