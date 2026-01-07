const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Process a directory
  processDirectory: (dirPath, options) => ipcRenderer.invoke('process-directory', dirPath, options),
  
  // Open native file dialog for folder selection
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  
  // Validate if path is a directory
  validateDirectory: (dirPath) => ipcRenderer.invoke('validate-directory', dirPath),
  
  // Open directory in file manager
  openDirectory: (dirPath) => ipcRenderer.invoke('open-directory', dirPath),
  
  // Get file path from File object (for drag and drop)
  getPathForFile: (file) => webUtils.getPathForFile(file),
  
  // Listen for processing log messages
  onProcessingLog: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('processing-log', subscription);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('processing-log', subscription);
  }
});
