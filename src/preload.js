'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memo', {
  getState: () => ipcRenderer.invoke('memo:get-state'),
  saveContent: (html) => ipcRenderer.send('memo:save-content', html),
  setSettings: (partial) => ipcRenderer.send('memo:set-settings', partial),
  setPinned: (flag) => ipcRenderer.send('memo:set-pinned', flag),
  setCollapsed: (flag) => ipcRenderer.send('memo:set-collapsed', flag),
  getBounds: () => ipcRenderer.invoke('memo:get-bounds'),
  setBounds: (bounds) => ipcRenderer.send('memo:set-bounds', bounds),
  minimize: () => ipcRenderer.send('memo:minimize'),
  close: () => ipcRenderer.send('memo:close'),
});
