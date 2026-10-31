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
  showMoreMenu: (pos) => ipcRenderer.send('memo:show-more-menu', pos),
  openOptions: (tab) => ipcRenderer.send('memo:open-options', tab),
  getQuickColors: () => ipcRenderer.invoke('memo:get-quick-colors'),
  setQuickColors: (list) => ipcRenderer.send('memo:set-quick-colors', list),
  onQuickColors: (cb) => ipcRenderer.on('memo:quick-colors', (_e, list) => cb(list)),
  onApplyQuickColor: (cb) => ipcRenderer.on('memo:apply-quick-color', (_e, i) => cb(i)),
  onOptionsTab: (cb) => ipcRenderer.on('memo:options-tab', (_e, tab) => cb(tab)),
  minimize: () => ipcRenderer.send('memo:minimize'),
  close: () => ipcRenderer.send('memo:close'),
});
