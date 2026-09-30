const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posDesktop', {
  platform: process.platform,
  request: (path, method = 'GET', body, token) => ipcRenderer.invoke('pos:request', { path, method, body, token }),
  onBluetoothDevices: callback => {
    const listener = (_event, devices) => callback(devices);
    ipcRenderer.on('pos:bluetooth-devices', listener);
    return () => ipcRenderer.removeListener('pos:bluetooth-devices', listener);
  },
  selectBluetoothDevice: id => ipcRenderer.invoke('pos:bluetooth-select', id),
  cancelBluetoothScan: () => ipcRenderer.invoke('pos:bluetooth-cancel'),
  openBluetoothSettings: () => ipcRenderer.invoke('pos:open-bluetooth-settings'),
  notifications: refresh => ipcRenderer.invoke('pos:notifications', refresh === true),
  notificationReadIds: userId => ipcRenderer.invoke('pos:notification-read-get', userId),
  saveNotificationReadIds: (userId, ids) => ipcRenderer.invoke('pos:notification-read-save', userId, ids),
  updateState: () => ipcRenderer.invoke('pos:update-state'),
  startUpdate: () => ipcRenderer.invoke('pos:update-start'),
  installUpdate: () => ipcRenderer.invoke('pos:update-install'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pos:update-state', listener);
    return () => ipcRenderer.removeListener('pos:update-state', listener);
  }
});
