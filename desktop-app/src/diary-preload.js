const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('diaryAPI', {
  get: () => ipcRenderer.invoke('diary:get'), edit: (id, text) => ipcRenderer.invoke('diary:edit', id, text), delete: (id) => ipcRenderer.invoke('diary:delete', id), close: () => ipcRenderer.send('diary:close'),
});
