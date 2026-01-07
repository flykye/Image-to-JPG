// DOM Elements
const dropZone = document.getElementById('dropZone');
const addFolderBtn = document.getElementById('addFolderBtn');
const processingPanel = document.getElementById('processingPanel');
const currentFolder = document.getElementById('currentFolder');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const heicCount = document.getElementById('heicCount');
const livpCount = document.getElementById('livpCount');
const pngCount = document.getElementById('pngCount');
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
const openFolderBtn = document.getElementById('openFolderBtn'); // New button element
const qualityRange = document.getElementById('qualityRange');
const qualityValue = document.getElementById('qualityValue');
const compressJpg = document.getElementById('compressJpg');

let isProcessing = false;
let unsubscribeLog = null;
let currentProcessedDir = ''; // To store the path of the output directory

// Update quality value display
qualityRange.addEventListener('input', (e) => {
  qualityValue.textContent = e.target.value;
});

// Handle 'Open Folder' button click
openFolderBtn.addEventListener('click', () => {
  if (currentProcessedDir) {
    window.electronAPI.openDirectory(currentProcessedDir);
  }
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
  addLogEntry('info', 'Add Folder button clicked.');
  if (isProcessing) return;

  const result = await window.electronAPI.openFileDialog();
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  const dirPath = result.filePaths[0];

  // Validate if it's a directory (optional, as dialog filters generally handle this)
  const validationResult = await window.electronAPI.validateDirectory(dirPath);
  if (!validationResult.success || !validationResult.isDirectory) {
    showError('选择的不是一个有效的文件夹');
    return;
  }
  
  startProcessing(dirPath);
}

async function handleDrop(e) {
  if (isProcessing) return;

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  // Get the first item's path using Electron's webUtils
  const file = files[0];
  const filePath = window.electronAPI.getPathForFile(file);
  
  if (!filePath) {
    showError('无法获取文件路径');
    return;
  }

  // Validate if it's a directory
  const result = await window.electronAPI.validateDirectory(filePath);
  if (!result.success || !result.isDirectory) {
    showError('请拖入文件夹，而不是文件');
    return;
  }

  // Start processing
  startProcessing(filePath);
}

async function startProcessing(dirPath) {
  isProcessing = true;
  
  // Set the expected output directory
  currentProcessedDir = `${dirPath}/jpg`;
  
  // Show processing panel
  dropZone.classList.add('hidden');
  processingPanel.classList.remove('hidden');
  summaryContainer.classList.add('hidden');
  
  // Reset UI
  currentFolder.textContent = dirPath;
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  heicCount.textContent = '0';
  livpCount.textContent = '0';
  pngCount.textContent = '0';
  jpgCount.textContent = '0';
  logOutput.innerHTML = '';
  
  // Subscribe to log messages
  unsubscribeLog = window.electronAPI.onProcessingLog(handleLogMessage);
  
  // Start processing
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
      heicCount.textContent = data.heicCount;
      livpCount.textContent = data.livpCount;
      pngCount.textContent = data.pngCount;
      jpgCount.textContent = data.jpgCount;
      addLogEntry('start', `开始处理...`);
      addLogEntry('info', `发现 ${data.totalFiles} 个文件待处理`);
      break;
      
    case 'processing':
      progressFill.style.width = `${data.progress}%`;
      progressText.textContent = `${data.progress}%`;
      addLogEntry('processing', `[${data.current}/${data.total}] 正在处理 ${data.fileType.toUpperCase()}: ${data.filename}`);
      break;
      
    case 'success':
      let msg = `  完成: ${data.filename} → ${data.outputFilename}`;
      if (data.details && data.details.compressionRatio) {
        msg += ` (压缩率 ${data.details.compressionRatio.toFixed(1)}%)`;
      }
      addLogEntry('success', msg);
      break;
      
    case 'error':
      addLogEntry('error', `  失败: ${data.filename} - ${data.error}`);
      break;
      
    case 'warning':
      addLogEntry('warning', `  警告: ${data.message}`);
      break;
      
    case 'info':
      addLogEntry('info', `  ${data.message}`);
      break;
      
    case 'summary':
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      showSummary(data.failedConversions === 0, data);
      
      // Unsubscribe from log messages
      if (unsubscribeLog) {
        unsubscribeLog();
        unsubscribeLog = null;
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

function showSummary(success, data) {
  // 隐藏处理中的计数器，显示最终总结
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.add('hidden');
  summaryContainer.classList.remove('hidden');
  
  if (success) {
    summaryIcon.textContent = '🎉';
    summaryTitle.textContent = '全部处理成功！';
    summaryTitle.style.color = 'var(--success)';
  } else if (data.error) {
    summaryIcon.textContent = '❌';
    summaryTitle.textContent = '处理过程出错';
    summaryTitle.style.color = 'var(--error)';
  } else {
    summaryIcon.textContent = '⚠️';
    summaryTitle.textContent = '处理完成，但有部分失败';
    summaryTitle.style.color = 'var(--warning)';
  }
  
  summaryDuration.textContent = data.duration ? `${data.duration}秒` : '-';
  summaryTotal.textContent = data.totalFiles || 0;
  summarySuccess.textContent = data.successfulConversions || 0;
  summaryFailed.textContent = data.failedConversions || 0;
}

// Reset to initial state
newProcessBtn.addEventListener('click', () => {
  processingPanel.classList.add('hidden');
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.remove('hidden');
  dropZone.classList.remove('hidden');
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
