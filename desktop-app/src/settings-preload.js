const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getState: () => ipcRenderer.invoke('settings:get'),
  updatePet: (id, patch) => ipcRenderer.invoke('settings:update', id, patch),
  addPet: () => ipcRenderer.invoke('settings:add'),
  duplicatePet: (id, options) => ipcRenderer.invoke('settings:duplicate', id, options),
  removePet: (id) => ipcRenderer.invoke('settings:remove', id),
  getMemory: (id) => ipcRenderer.invoke('settings:memory-get', id),
  saveMemoryPolicy: (id, policy) => ipcRenderer.invoke('settings:memory-policy', id, policy),
  saveSearchBudget: (budget) => ipcRenderer.invoke('settings:search-budget-save', budget),
  runDiary: (id) => ipcRenderer.invoke('settings:diary-run', id),
  openDiary: (id) => ipcRenderer.invoke('settings:diary-open', id),
  editDiary: (id, diaryId, text) => ipcRenderer.invoke('settings:diary-edit', id, diaryId, text),
  deleteDiary: (id, diaryId, options) => ipcRenderer.invoke('settings:diary-delete', id, diaryId, options),
  clearMemory: (id) => ipcRenderer.invoke('settings:memory-clear', id),
  getAISettings: () => ipcRenderer.invoke('settings:ai-get'),
  saveAISettings: (settings) => ipcRenderer.invoke('settings:ai-save', settings),
  removeKey: (provider) => ipcRenderer.invoke('settings:ai-remove-key', provider),
  testAIConnection: () => ipcRenderer.invoke('settings:ai-test'),
  loadAIModels: (settings) => ipcRenderer.invoke('settings:ai-models', settings),
  onChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
});
