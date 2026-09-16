const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getConfig: () => ipcRenderer.invoke('pet:config'),
  showMenu: () => ipcRenderer.send('pet:menu'),
  beginDrag: () => ipcRenderer.send('pet:begin-drag'),
  endDrag: (cancelled) => ipcRenderer.send('pet:end-drag', cancelled),
  updateMask: (mask) => ipcRenderer.send('pet:mask', mask),
  beginWalk: (name, direction) => ipcRenderer.invoke('pet:begin-walk', name, direction),
  walkProgress: (progress) => ipcRenderer.send('pet:walk-progress', progress),
  stopWalk: () => ipcRenderer.send('pet:stop-walk'),
  actionStatus: (status) => ipcRenderer.send('pet:action-status', status),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('pet:command', listener);
    return () => ipcRenderer.removeListener('pet:command', listener);
  },
});
