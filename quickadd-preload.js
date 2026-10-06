const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAdd', {
  onOpen: (callback) => ipcRenderer.on('quickadd:open', (_event, payload) => callback(payload)),
  submit: (task) => ipcRenderer.send('quickadd:submit', task),
  close: () => ipcRenderer.send('quickadd:close')
});
