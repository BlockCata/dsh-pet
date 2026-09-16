const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  getInfo: () => ipcRenderer.invoke('chat:info'),
  getMessages: () => ipcRenderer.invoke('chat:get'),
  getAttachment: (request) => ipcRenderer.invoke('chat:get-attachment', request),
  send: (request) => ipcRenderer.invoke('chat:send', request),
  editLatest: (request) => ipcRenderer.invoke('chat:edit-latest', request),
  confirmSearch: ({ requestId, approved } = {}) => ipcRenderer.invoke('chat:confirm-search', { requestId, approved }),
  resize: (size) => ipcRenderer.invoke('chat:resize', size),
  openSource: ({ messageId, sourceId } = {}) => ipcRenderer.invoke('chat:open-source', { messageId, sourceId }),
  cancel: () => ipcRenderer.send('chat:cancel'),
  collapse: () => ipcRenderer.send('chat:collapse'),
  onEvent: (callback) => {
    const listener = (_event, event) => callback(event);
    ipcRenderer.on('chat:event', listener);
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
});
