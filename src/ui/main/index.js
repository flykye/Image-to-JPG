const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { exec } = require('child_process');
const { promisify } = require('util');
const Store = require('electron-store').default;

const execAsync = promisify(exec);

const { scanDirectory, scanDirectoryRecursive } = require('../../core/batch');
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
  // 确保 Homebrew 等路径在 PATH 中（macOS GUI 应用默认不包含）
  const homebrewPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
  const currentPath = process.env.PATH || '';
  const newPath = homebrewPaths.filter(p => !currentPath.split(':').includes(p)).join(':');
  if (newPath) {
    process.env.PATH = newPath + ':' + currentPath;
  }

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

    const scanResult = scanDirectoryRecursive(dirPath);
    if (!scanResult.success) return scanResult;

    if (scanResult.groups.length === 0) {
      return { success: false, error: 'No supported image files found.' };
    }

    // 为每个分组准备输出目录
    const groups = scanResult.groups.map(group => {
      const outputDir = prepareOutputDirectory(null, group.dirPath, true);
      return {
        dirPath: group.dirPath,
        files: group.files,
        stats: group.stats,
        outputDir
      };
    });

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'conversion-worker.js'), {
        workerData: {
          groups,
          rootDirectory: dirPath,
          options: {
            quality: userOptions.quality || 95,
            compressJpg: userOptions.compressJpg,
          }
        }
      });

      worker.on('message', (message) => {
        event.sender.send('processing-log', message);
        if (message.type === 'all-done') {
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
  // 先尝试系统PATH中的命令
  const commands = ['magick -version', 'convert -version'];
  // 再尝试完整路径（macOS Homebrew 安装路径）
  const fullPaths = ['/opt/homebrew/bin/magick -version', '/usr/local/bin/magick -version'];

  for (const cmd of [...commands, ...fullPaths]) {
    try {
      await execAsync(cmd, { timeout: 5000 });
      return true;
    } catch (error) {
      // 继续尝试下一个
    }
  }
  return false;
});

ipcMain.handle('open-external-url', (event, url) => {
  if (url) {
    shell.openExternal(url);
  }
  return { success: true };
});
