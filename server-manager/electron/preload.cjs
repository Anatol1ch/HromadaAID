const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hromadaManager', Object.freeze({
  inspectEnvironment: () => ipcRenderer.invoke('manager:inspect-environment'),
}))
