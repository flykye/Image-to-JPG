const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Import core processing modules
const { validateDirectory, scanDirectory, __test__: { batchProcessImages } } = require('./batch-processor');
const { ProgressReporter } = require('./progress-reporter');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, process.platform === 'win32' ? 'assets/icon.ico' : 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e'
  });

  mainWindow.loadFile('index.html');
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

/**
 * Custom ProgressReporter that sends messages to the renderer process
 */
class UIProgressReporter extends ProgressReporter {
  constructor(webContents, verbose = false) {
    super(verbose);
    this.webContents = webContents;
  }

  send(type, data) {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('processing-log', { type, ...data });
    }
  }

  logStart(directory, fileCategories) {
    super.logStart(directory, fileCategories);
    this.send('start', {
      directory,
      heicCount: fileCategories.heicFiles.length,
      livpCount: fileCategories.livpFiles.length,
      pngCount: fileCategories.pngFiles ? fileCategories.pngFiles.length : 0,
      jpgCount: fileCategories.jpgFiles ? fileCategories.jpgFiles.length : 0,
      totalFiles: fileCategories.totalFiles
    });
  }

  logFileProcessing(filename, fileType, current, total) {
    super.logFileProcessing(filename, fileType, current, total);
    this.send('processing', {
      filename,
      fileType,
      current,
      total,
      progress: Math.round((current / total) * 100)
    });
  }

  logSuccess(filename, outputPath, fileType, details = {}) {
    super.logSuccess(filename, outputPath, fileType, details);
    const outputFilename = path.basename(outputPath);
    this.send('success', {
      filename,
      outputFilename,
      fileType,
      details
    });
  }

  logError(filename, error, fileType, operation = 'processing') {
    super.logError(filename, error, fileType, operation);
    this.send('error', {
      filename,
      error,
      fileType,
      operation
    });
  }

  logSummary() {
    super.logSummary();
    this.stats.finalize();
    this.send('summary', {
      duration: this.stats.getDuration(),
      totalFiles: this.stats.totalFiles,
      successfulConversions: this.stats.successfulConversions,
      failedConversions: this.stats.failedConversions,
      errors: this.stats.errors
    });
  }

  logInfo(message) {
    super.logInfo(message);
    this.send('info', { message });
  }

  logWarning(message) {
    super.logWarning(message);
    this.send('warning', { message });
  }
}

// Handle directory processing
ipcMain.handle('process-directory', async (event, dirPath, userOptions = {}) => {
  try {
    // Validate directory
    const validationResult = validateDirectory(dirPath);
    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    // Scan directory for files
    const scanResult = scanDirectory(dirPath);
    if (!scanResult.success) {
      return { success: false, error: scanResult.error };
    }

    if (scanResult.totalFiles === 0) {
      return { success: false, error: 'No HEIC, LIVP, PNG or JPG files found in the directory.' };
    }

    // Create UI progress reporter
    const progressReporter = new UIProgressReporter(event.sender, true);

    // Ensure output directory exists and is cleared once at the beginning
    const { createJpgDirectory } = require('./file-manager');
    const outputDir = path.join(dirPath, 'jpg');
    
    // Manual clear at the start of batch
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        } else {
          fs.rmSync(filePath, { recursive: true, force: true });
        }
      }
    } else {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Processing options
    const options = {
      outputDir: outputDir,
      copy: true,
      quality: userOptions.quality || 95,
      compressJpg: userOptions.compressJpg !== undefined ? userOptions.compressJpg : true
    };

    // Process files
    const result = await batchProcessImages(
      scanResult,
      dirPath,
      progressReporter,
      options
    );

    return {
      success: true,
      stats: result.stats,
      hasFailures: result.hasFailures
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle directory validation (for drag and drop)
ipcMain.handle('validate-directory', async (event, dirPath) => {
  try {
    const stats = fs.statSync(dirPath);
    return { success: stats.isDirectory(), isDirectory: stats.isDirectory() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle opening directory in native file manager
ipcMain.handle('open-directory', (event, dirPath) => {
  shell.openPath(dirPath);
  return { success: true };
});

// Handle native file dialog for folder selection
ipcMain.handle('open-file-dialog', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择包含图片的文件夹',
    buttonLabel: '选择文件夹'
  });
  return result;
});
