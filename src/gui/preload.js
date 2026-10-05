'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labGui', {
  run: (args) => ipcRenderer.invoke('lab:run', args),
  menu: (action) => ipcRenderer.invoke('lab:menu', action),
  stop: () => ipcRenderer.invoke('lab:stop'),
  notify: (payload) => ipcRenderer.invoke('lab:notify', payload),
  profiles: () => ipcRenderer.invoke('lab:profiles'),
  openReport: () => ipcRenderer.invoke('lab:open-report'),
  openArtifacts: () => ipcRenderer.invoke('lab:open-artifacts'),
  info: () => ipcRenderer.invoke('lab:info'),
  onStarted: (handler) => ipcRenderer.on('lab:started', (_event, payload) => handler(payload)),
  onOutput: (handler) => ipcRenderer.on('lab:output', (_event, text) => handler(text)),
  onDone: (handler) => ipcRenderer.on('lab:done', (_event, payload) => handler(payload)),
});
