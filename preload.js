const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kanbanStorage', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  onImported: (callback) => ipcRenderer.on('data:imported', (_event, data) => callback(data)),
  onCommand: (callback) => ipcRenderer.on('app:command', (_event, command) => callback(command))
});
