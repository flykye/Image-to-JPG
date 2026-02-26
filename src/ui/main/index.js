const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { exec } = require('child_process');
const { promisify } = require('util');
const Store = require('electron-store').default;

const execAsync = promisify(exec);

const { scanDirectory } = require('../../core/batch');
const { prepareOutputDirectory } = require('../../core/services/file-manager');
const { ProgressReporter } = require('../../core/services/progress-reporter');

const store = new Store({
  defaults: {
    quality: 95,
    compressJpg: true
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, '../../../assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e'
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('process-directory', async (event, dirPath, userOptions = {}) => {
  try {
    store.set('quality', userOptions.quality);
    store.set('compressJpg', userOptions.compressJpg);

    const scanResult = scanDirectory(dirPath);
    if (!scanResult.success) return scanResult;

    if (scanResult.files.length === 0) {
      return { success: false, error: 'No supported image files found.' };
    }

    const outputDir = prepareOutputDirectory(null, dirPath, true);

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'conversion-worker.js'), {
        workerData: {
          files: scanResult.files,
          targetDirectory: dirPath,
          options: {
            outputDir,
            quality: userOptions.quality || 95,
            compressJpg: userOptions.compressJpg,
            stats: scanResult.stats
          }
        }
      });

      worker.on('message', (message) => {
        event.sender.send('processing-log', message);
        if (message.type === 'done') {
          resolve({ success: true, stats: message.stats });
          worker.terminate();
        }
      });

      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('validate-directory', async (event, dirPath) => {
  try {
    const stats = fs.statSync(dirPath);
    return { success: stats.isDirectory(), isDirectory: stats.isDirectory() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-directory', (event, dirPath) => {
  shell.openPath(dirPath);
  return { success: true };
});

ipcMain.handle('open-file-dialog', async () => {
  return await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择包含图片的文件夹',
    buttonLabel: '选择文件夹'
  });
});

ipcMain.handle('get-settings', () => {
  return { quality: store.get('quality'), compressJpg: store.get('compressJpg') };
});

ipcMain.handle('set-setting', (event, key, value) => {
  store.set(key, value);
  return { success: true };
});

ipcMain.handle('check-imagemagick', async () => {
  try {
    await execAsync('magick -version');
    return true;
  } catch (error) {
    try {
      // Fallback for older ImageMagick versions (v6)
      await execAsync('convert -version');
      return true;
    } catch (fallbackError) {
      return false;
    }
  }
});

ipcMain.handle('open-external-url', (event, url) => {
  if (url) {
    shell.openExternal(url);
  }
  return { success: true };
});
