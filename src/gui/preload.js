'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labGui', {
  run: (args) => ipcRenderer.invoke('lab:run', args),
  stop: () => ipcRenderer.invoke('lab:stop'),
  openReport: () => ipcRenderer.invoke('lab:open-report'),
  openArtifacts: () => ipcRenderer.invoke('lab:open-artifacts'),
  info: () => ipcRenderer.invoke('lab:info'),
  onStarted: (handler) => ipcRenderer.on('lab:started', (_event, payload) => handler(payload)),
  onOutput: (handler) => ipcRenderer.on('lab:output', (_event, text) => handler(text)),
  onDone: (handler) => ipcRenderer.on('lab:done', (_event, payload) => handler(payload)),
});
