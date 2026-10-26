'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memo', {
  getState: () => ipcRenderer.invoke('memo:get-state'),
  saveContent: (html, title) => ipcRenderer.send('memo:save-content', html, title),
  newNote: () => ipcRenderer.send('memo:new-note'),
  deleteNote: () => ipcRenderer.invoke('memo:delete-note'),
  setSettings: (partial) => ipcRenderer.send('memo:set-settings', partial),
  setPinned: (flag) => ipcRenderer.send('memo:set-pinned', flag),
  setCollapsed: (flag) => ipcRenderer.send('memo:set-collapsed', flag),
  getBounds: () => ipcRenderer.invoke('memo:get-bounds'),
  setBounds: (bounds) => ipcRenderer.send('memo:set-bounds', bounds),
  minimize: () => ipcRenderer.send('memo:minimize'),
  close: () => ipcRenderer.send('memo:close'),
});
