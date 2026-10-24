'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memo', {
  getState: () => ipcRenderer.invoke('memo:get-state'),
  saveContent: (html) => ipcRenderer.send('memo:save-content', html),
  setOpacity: (value) => ipcRenderer.send('memo:set-opacity', value),
  setPinned: (flag) => ipcRenderer.send('memo:set-pinned', flag),
  minimize: () => ipcRenderer.send('memo:minimize'),
  close: () => ipcRenderer.send('memo:close'),
});
