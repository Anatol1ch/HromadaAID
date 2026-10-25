const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hromadaManager', Object.freeze({
  inspectEnvironment: () => ipcRenderer.invoke('manager:inspect-environment'),
  controlService: operation => ipcRenderer.invoke('manager:control-service', operation),
  getInstallDefaults: () => ipcRenderer.invoke('manager:get-install-defaults'),
  selectInstallDirectory: kind => ipcRenderer.invoke('manager:select-install-directory', kind),
  installServer: request => ipcRenderer.invoke('manager:install-server', request),
  saveRecoveryKey: () => ipcRenderer.invoke('manager:save-recovery-key'),
  confirmRecoveryKeySaved: () => ipcRenderer.invoke('manager:confirm-recovery-key-saved'),
  cancelRecoveryKey: () => ipcRenderer.invoke('manager:cancel-recovery-key'),
  selectServerUpdatePackage: () => ipcRenderer.invoke('manager:select-server-update-package'),
  applyServerUpdate: previewId => ipcRenderer.invoke('manager:apply-server-update', previewId),
  cancelServerUpdatePreview: previewId => ipcRenderer.invoke('manager:cancel-server-update-preview', previewId),
  onInstallationUpdate: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('manager:installation-update', handler)
    return () => ipcRenderer.removeListener('manager:installation-update', handler)
  },
  onRecoveryKeyRequired: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('manager:recovery-key-required', handler)
    return () => ipcRenderer.removeListener('manager:recovery-key-required', handler)
  },
  onServerUpdateProgress: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('manager:server-update-progress', handler)
    return () => ipcRenderer.removeListener('manager:server-update-progress', handler)
  },
}))
