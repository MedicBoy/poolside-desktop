const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('poolside', {
  get: () => ipcRenderer.invoke('workspace:get'),
  add: input => ipcRenderer.invoke('account:add', input),
  open: id => ipcRenderer.invoke('account:open', id),
  close: id => ipcRenderer.invoke('account:close', id),
  checkIP: id => ipcRenderer.invoke('account:check-ip', id),
  checkRoute: id => ipcRenderer.invoke('account:check-route', id),
  deleteProfile: id => ipcRenderer.invoke('account:delete-profile', id),
  refreshProfiles: () => ipcRenderer.invoke('profiles:refresh'),
  settingsForm: () => ipcRenderer.invoke('settings:form'),
  diagnosticsPreview: () => ipcRenderer.invoke('diagnostics:preview'),
  returnGame: id => ipcRenderer.invoke('account:return-game', id),
  inspect: id => ipcRenderer.invoke('account:inspect', id),
  archive: id => ipcRenderer.invoke('account:archive', id),
  openAll: () => ipcRenderer.invoke('sessions:open'),
  closeAll: () => ipcRenderer.invoke('sessions:close'),
  arrange: () => ipcRenderer.invoke('sessions:arrange'),
  saveSettings: input => ipcRenderer.invoke('settings:save', input),
  subscribe: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  }
});
