// DOM Elements
const dropZone = document.getElementById('dropZone');
const addFolderBtn = document.getElementById('addFolderBtn');
const folderList = document.getElementById('folderList');
const startProcessingBtn = document.getElementById('startProcessingBtn');
const folderCount = document.getElementById('folderCount');
const processingPanel = document.getElementById('processingPanel');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const heicCount = document.getElementById('heicCount');
const livpCount = document.getElementById('livpCount');
const pngCount = document.getElementById('pngCount');
const dngCount = document.getElementById('dngCount');
const tiffCount = document.getElementById('tiffCount');
const jpgCount = document.getElementById('jpgCount');
const logOutput = document.getElementById('logOutput');
const summaryContainer = document.getElementById('summaryContainer');
const summaryIcon = document.getElementById('summaryIcon');
const summaryTitle = document.getElementById('summaryTitle');
const summaryDuration = document.getElementById('summaryDuration');
const summaryTotal = document.getElementById('summaryTotal');
const summarySuccess = document.getElementById('summarySuccess');
const summaryFailed = document.getElementById('summaryFailed');
const newProcessBtn = document.getElementById('newProcessBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const qualityRange = document.getElementById('qualityRange');
const qualityValue = document.getElementById('qualityValue');
const compressJpg = document.getElementById('compressJpg');
const folderStatsList = document.getElementById('folderStatsList');
const imagemagickWarning = document.getElementById('imagemagickWarning');
const imDownloadLink = document.getElementById('imDownloadLink');

let isProcessing = false;
let unsubscribeLog = null;
let currentProcessedDir = '';
let queuedFolders = [];
let folderStats = [];
let currentFolderStats = null;

/**
 * Helper function to format bytes into readable string (e.g., 1.2 MB)
 */
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Update quality value display
qualityRange.addEventListener('input', (e) => {
  qualityValue.textContent = e.target.value;
  window.electronAPI.setSetting('quality', parseInt(e.target.value));
});

// Handle compress JPG toggle (NEW)
compressJpg.addEventListener('change', (e) => {
  window.electronAPI.setSetting('compressJpg', e.target.checked);
});

// Handle 'Open Folder' button click
openFolderBtn.addEventListener('click', () => {
  if (currentProcessedDir) {
    window.electronAPI.openDirectory(currentProcessedDir);
  }
});

// Handle ImageMagick download link click
imDownloadLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.electronAPI.openExternalUrl('https://imagemagick.org/script/download.php');
});

// Prevent default drag behaviors
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  document.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Highlight drop zone when dragging over it
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
  dropZone.classList.add('drag-over');
}

function unhighlight(e) {
  dropZone.classList.remove('drag-over');
}

// Handle drop event
dropZone.addEventListener('drop', handleDrop, false);

// Handle 'Add Folder' button click
addFolderBtn.addEventListener('click', handleAddFolder);

async function handleAddFolder() {
  if (isProcessing) return;

  const result = await window.electronAPI.openFileDialog();
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  const dirPath = result.filePaths[0];

  const validationResult = await window.electronAPI.validateDirectory(dirPath);
  if (!validationResult.success || !validationResult.isDirectory) {
    showError('选择的不是一个有效的文件夹');
    return;
  }

  addFolderToQueue(dirPath);
}

async function handleDrop(e) {
  if (isProcessing) return;

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  let addedCount = 0;
  let hasError = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = window.electronAPI.getPathForFile(file);

    if (!filePath) {
      hasError = true;
      continue;
    }

    const result = await window.electronAPI.validateDirectory(filePath);
    if (result.success && result.isDirectory) {
      addFolderToQueue(filePath);
      addedCount++;
    } else {
      hasError = true;
    }
  }

  if (addedCount === 0 && hasError) {
    showError('请拖入有效的文件夹，而不是文件');
  } else if (hasError) {
    // Optional: show a warning if only some items were invalid
    // addLogEntry('warning', '部分拖入的内容不是有效的文件夹，已被忽略');
  }
}

function addFolderToQueue(dirPath) {
  if (queuedFolders.includes(dirPath)) {
    return;
  }

  queuedFolders.push(dirPath);
  renderFolderList();
}

function renderFolderList() {
  folderList.innerHTML = '';

  queuedFolders.forEach((folderPath, index) => {
    const folderName = folderPath.split(/[/\\]/).pop();
    const item = document.createElement('div');
    item.className = 'folder-item';
    item.innerHTML = `
      <span class="folder-name" title="${folderPath}">${folderName}</span>
      <button class="remove-folder-btn" data-index="${index}">&times;</button>
    `;
    folderList.appendChild(item);
  });

  folderCount.textContent = queuedFolders.length;

  if (queuedFolders.length > 0) {
    startProcessingBtn.classList.remove('hidden');
  } else {
    startProcessingBtn.classList.add('hidden');
  }
}

folderList.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-folder-btn')) {
    const index = parseInt(e.target.dataset.index);
    queuedFolders.splice(index, 1);
    renderFolderList();
  }
});

startProcessingBtn.addEventListener('click', startBatchProcessing);

async function startBatchProcessing() {
  if (isProcessing || queuedFolders.length === 0) return;

  isProcessing = true;
  startProcessingBtn.disabled = true;
  addFolderBtn.disabled = true;

  dropZone.classList.add('hidden');
  processingPanel.classList.remove('hidden');
  summaryContainer.classList.add('hidden');
  folderStatsList.innerHTML = '';

  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.remove('hidden');

  folderStats = [];

  const options = {
    quality: parseInt(qualityRange.value),
    compressJpg: compressJpg.checked
  };

  unsubscribeLog = window.electronAPI.onProcessingLog(handleLogMessage);

  for (let i = 0; i < queuedFolders.length; i++) {
    const dirPath = queuedFolders[i];
    currentProcessedDir = dirPath;

    currentFolderStats = {
      folderPath: dirPath,
      folderName: dirPath.split(/[/\\]/).pop(),
      totalFiles: 0,
      successfulConversions: 0,
      failedConversions: 0,
      heic: 0,
      livp: 0,
      png: 0,
      dng: 0,
      tiff: 0,
      jpg: 0,
      duration: 0,
      startTime: Date.now()
    };

    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    heicCount.textContent = '0';
    livpCount.textContent = '0';
    pngCount.textContent = '0';
    dngCount.textContent = '0';
    tiffCount.textContent = '0';
    jpgCount.textContent = '0';
    logOutput.innerHTML = '';

    addLogEntry('info', `开始处理第 ${i + 1}/${queuedFolders.length} 个文件夹: ${dirPath}`);

    try {
      const result = await window.electronAPI.processDirectory(dirPath, options);
      if (!result.success) {
        addLogEntry('error', `错误: ${result.error}`);
      }
    } catch (error) {
      addLogEntry('error', `错误: ${error.message}`);
    }

    currentFolderStats.duration = ((Date.now() - currentFolderStats.startTime) / 1000).toFixed(1);
    folderStats.push(currentFolderStats);
  }

  isProcessing = false;
  startProcessingBtn.disabled = false;
  addFolderBtn.disabled = false;
  queuedFolders = [];
  renderFolderList();

  renderFolderStatsSummary();

  if (unsubscribeLog) {
    unsubscribeLog();
    unsubscribeLog = null;
  }

  addLogEntry('info', '所有文件夹处理完成！');
}

async function startProcessing(dirPath) {
  isProcessing = true;

  currentProcessedDir = dirPath;

  dropZone.classList.add('hidden');
  processingPanel.classList.remove('hidden');
  summaryContainer.classList.add('hidden');

  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  heicCount.textContent = '0';
  livpCount.textContent = '0';
  pngCount.textContent = '0'; dngCount.textContent = '0';
  jpgCount.textContent = '0';
  logOutput.innerHTML = '';

  unsubscribeLog = window.electronAPI.onProcessingLog(handleLogMessage);

  try {
    const options = {
      quality: parseInt(qualityRange.value),
      compressJpg: compressJpg.checked
    };
    const result = await window.electronAPI.processDirectory(dirPath, options);

    if (!result.success) {
      addLogEntry('error', `错误: ${result.error}`);
      showSummary(false, { error: result.error });
    }
  } catch (error) {
    addLogEntry('error', `错误: ${error.message}`);
    showSummary(false, { error: error.message });
  }

  isProcessing = false;
}

function handleLogMessage(data) {
  switch (data.type) {
    case 'start':
      // 累加各组的统计（多组处理时会收到多次 start）
      heicCount.textContent = parseInt(heicCount.textContent || 0) + (data.heicCount || 0);
      livpCount.textContent = parseInt(livpCount.textContent || 0) + (data.livpCount || 0);
      pngCount.textContent = parseInt(pngCount.textContent || 0) + (data.pngCount || 0);
      dngCount.textContent = parseInt(dngCount.textContent || 0) + (data.dngCount || 0);
      tiffCount.textContent = parseInt(tiffCount.textContent || 0) + (data.tiffCount || 0);
      jpgCount.textContent = parseInt(jpgCount.textContent || 0) + (data.jpgCount || 0);

      if (currentFolderStats) {
        currentFolderStats.totalFiles += data.totalFiles;
        currentFolderStats.heic += data.heicCount || 0;
        currentFolderStats.livp += data.livpCount || 0;
        currentFolderStats.png += data.pngCount || 0;
        currentFolderStats.dng += data.dngCount || 0;
        currentFolderStats.tiff += data.tiffCount || 0;
        currentFolderStats.jpg += data.jpgCount || 0;
      }

      addLogEntry('info', `发现 ${data.totalFiles} 个文件待处理`);
      break;

    case 'processing':
      progressFill.style.width = `${data.progress}%`;
      progressText.textContent = `${data.progress}%`;
      addLogEntry('processing', `[${data.current}/${data.total}] 正在处理 ${data.fileType.toUpperCase()}: ${data.filename}`);
      break;

    case 'success':
      if (currentFolderStats) {
        currentFolderStats.successfulConversions++;
      }
      let msg = `  完成: ${data.filename} → ${data.outputFilename}`;
      if (data.details && data.details.compressionRatio) {
        const inputSize = formatBytes(data.details.inputSize || 0);
        const outputSize = formatBytes(data.details.outputSize || 0);
        msg += ` (${inputSize} → ${outputSize}, 压缩率 ${data.details.compressionRatio.toFixed(1)}%)`;
      }
      addLogEntry('success', msg);
      break;

    case 'error':
      if (currentFolderStats) {
        currentFolderStats.failedConversions++;
      }
      addLogEntry('error', `  失败: ${data.filename} - ${data.error}`);
      break;

    case 'warning':
      addLogEntry('warning', `  警告: ${data.message}`);
      break;

    case 'info':
      addLogEntry('info', `  ${data.message}`);
      break;

    case 'group-start':
      addLogEntry('info', `📁 [${data.groupIndex + 1}/${data.groupCount}] 处理子文件夹: ${data.groupDirName}`);
      break;

    case 'group-done':
      addLogEntry('info', `✅ 子文件夹处理完成: ${data.groupDirName}`);
      break;

    case 'done':
      // 单组完成（来自 batchProcessImages 的 progressReporter）
      break;

    case 'all-done':
      progressFill.style.width = '100%';
      progressText.textContent = '100%';

      if (currentFolderStats) {
        currentFolderStats.duration = ((Date.now() - currentFolderStats.startTime) / 1000).toFixed(1);
      }
      break;
  }
}

function addLogEntry(type, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  // 新的日志插入到最前面
  logOutput.insertBefore(entry, logOutput.firstChild);
}

function showError(message) {
  addLogEntry('error', `操作失败: ${message}`);
}

function renderFolderStatsSummary() {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.add('hidden');
  summaryContainer.classList.remove('hidden');

  folderStatsList.innerHTML = '';

  let totalFiles = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalDuration = 0;

  folderStats.forEach((stat, index) => {
    totalFiles += stat.totalFiles;
    totalSuccess += stat.successfulConversions;
    totalFailed += stat.failedConversions;
    totalDuration += parseFloat(stat.duration);

    const hasErrors = stat.failedConversions > 0;
    const allSuccess = stat.failedConversions === 0 && stat.successfulConversions > 0;

    const item = document.createElement('div');
    item.className = 'folder-stats-item';
    item.innerHTML = `
      <div class="folder-stats-header">
        <span class="folder-stats-name" title="${stat.folderPath}">${stat.folderName}</span>
        <span class="folder-stats-badge ${hasErrors ? 'error' : allSuccess ? '' : 'warning'}">
          ${hasErrors ? `${stat.failedConversions} 失败` : allSuccess ? '完成' : '完成'}
        </span>
      </div>
      <div class="folder-stats-types">
        ${stat.heic > 0 ? `<span>HEIC <b class="count">${stat.heic}</b></span>` : ''}
        ${stat.livp > 0 ? `<span>LIVP <b class="count">${stat.livp}</b></span>` : ''}
        ${stat.png > 0 ? `<span>PNG <b class="count">${stat.png}</b></span>` : ''}
        ${stat.dng > 0 ? `<span>DNG <b class="count">${stat.dng}</b></span>` : ''}
        ${stat.tiff > 0 ? `<span>TIFF <b class="count">${stat.tiff}</b></span>` : ''}
        ${stat.jpg > 0 ? `<span>JPG <b class="count">${stat.jpg}</b></span>` : ''}
        <span>耗时: ${stat.duration}秒</span>
      </div>
    `;
    folderStatsList.appendChild(item);
  });

  const allSuccess = totalFailed === 0 && totalSuccess > 0;
  if (allSuccess) {
    summaryIcon.textContent = '🎉';
    summaryTitle.textContent = '全部处理成功！';
    summaryTitle.style.color = 'var(--success)';
  } else if (totalFailed > 0) {
    summaryIcon.textContent = '⚠️';
    summaryTitle.textContent = '处理完成，但有部分失败';
    summaryTitle.style.color = 'var(--warning)';
  } else {
    summaryIcon.textContent = '📁';
    summaryTitle.textContent = '处理完成';
    summaryTitle.style.color = 'var(--text-primary)';
  }

  summaryDuration.textContent = `${totalDuration.toFixed(1)}秒`;
  summaryTotal.textContent = totalFiles;
  summarySuccess.textContent = totalSuccess;
  summaryFailed.textContent = totalFailed;
}

function showSummary(success, data) {
  renderFolderStatsSummary();
}

// Reset to initial state
newProcessBtn.addEventListener('click', () => {
  processingPanel.classList.add('hidden');
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.remove('hidden');
  dropZone.classList.remove('hidden');
  queuedFolders = [];
  renderFolderList();
});

// Also allow drag and drop on processing panel for quick restart
processingPanel.addEventListener('dragenter', highlight, false);
processingPanel.addEventListener('dragover', (e) => {
  preventDefaults(e);
  if (!isProcessing) {
    dropZone.classList.remove('hidden');
    processingPanel.classList.add('hidden');
    highlight(e);
  }
}, false);

// Load persisted settings on startup (NEW)
async function loadSettings() {
  const settings = await window.electronAPI.getSettings();
  if (settings) {
    // Apply quality setting
    qualityRange.value = settings.quality;
    qualityValue.textContent = settings.quality;

    // Apply compressJpg setting
    compressJpg.checked = settings.compressJpg;
  }
}

// Check system dependencies (ImageMagick)
async function checkSystemDependencies() {
  const hasIM = await window.electronAPI.checkImageMagick();
  if (!hasIM) {
    imagemagickWarning.classList.remove('hidden');
  } else {
    imagemagickWarning.classList.add('hidden');
  }
}

loadSettings();
checkSystemDependencies();
