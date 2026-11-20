'use strict';
// 安全桥：contextIsolation 开启、nodeIntegration 关闭，仅暴露白名单 API。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveTask: (draft) => ipcRenderer.invoke('task:save', draft),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  restoreTask: (task) => ipcRenderer.invoke('task:restore', task),
  planToday: () => ipcRenderer.invoke('plan:today'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  minimize: () => ipcRenderer.send('win:minimize'),
  togglePin: () => ipcRenderer.invoke('win:togglePin'),
  setMode: (compact) => ipcRenderer.invoke('win:setMode', compact),
  setZoom: (factor) => ipcRenderer.invoke('win:setZoom', factor),
  quit: () => ipcRenderer.send('win:quit'),

  onDataChanged: (cb) => ipcRenderer.on('data:changed', (_e, payload) => cb(payload)),
  onModeChanged: (cb) => ipcRenderer.on('mode:changed', (_e, payload) => cb(payload)),
});
