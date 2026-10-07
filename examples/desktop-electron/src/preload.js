const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
    sample: () => ipcRenderer.invoke('native:sample'),
});
