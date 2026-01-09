const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File System Operations
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  validateDirectory: (dirPath) => ipcRenderer.invoke('validate-directory', dirPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openDirectory: (dirPath) => ipcRenderer.invoke('open-directory', dirPath),

  // Processing
  processDirectory: (dirPath, options) => ipcRenderer.invoke('process-directory', dirPath, options),
  onProcessingLog: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('processing-log', subscription);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('processing-log', subscription);
  },

  // Settings persistence (NEW)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value)
});
