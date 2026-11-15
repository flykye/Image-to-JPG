import { isMyGo, onFileDrop, runtime } from 'mygo-runtime';
import { Desktop, events } from './mygo';

const $ = (id) => document.getElementById(id);
const state = {
  folders: [],
  running: false,
  completed: false,
  adding: false,
  settingsReady: false,
  engineReady: false,
  lastValidThreshold: 0,
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  logCount: 0
};
let saveChain = Promise.resolve();
let saveTimer;
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
const nameOf = (path) => path.split(/[/\\]/).filter(Boolean).pop() || path;
const settings = () => ({
  quality: Number($('qualityRange').value),
  compressJpg: $('compressJpg').checked,
  compressAboveMb: Number($('compressAboveMb').value),
  forceUnder20Mb: $('forceUnder20Mb').checked,
  skipExisting: $('skipExisting').checked,
  concurrency: Number($('concurrency').value)
});

function thresholdIsValid() {
  const value = String($('compressAboveMb').value).trim();
  const threshold = Number(value);
  return value !== '' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1000000;
}

function notice(message, error = true) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  show('notice', !!message);
}

function log(type, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  $('logOutput').append(entry);
  while ($('logOutput').children.length > 500) $('logOutput').firstChild.remove();
  $('logCount').textContent = String(++state.logCount);
  $('logOutput').scrollTop = $('logOutput').scrollHeight;
  show('logDetails');
}

function updateControls() {
  if (!$('compressJpg').checked && !thresholdIsValid()) {
    $('compressAboveMb').value = String(state.lastValidThreshold);
  }
  const validThreshold = thresholdIsValid();
  if (validThreshold) state.lastValidThreshold = Number($('compressAboveMb').value);
  $('startProcessingBtn').disabled =
    state.running ||
    state.adding ||
    !state.folders.length ||
    !state.settingsReady ||
    !state.engineReady ||
    !validThreshold;
  $('addFolderBtn').disabled = state.running || state.adding;
  $('clearQueueBtn').disabled = state.running || state.adding || !state.folders.length;
  $('settingsFields').disabled = state.running || !state.settingsReady;
  $('compressAboveMb').disabled =
    state.running || !state.settingsReady || !$('compressJpg').checked;
  $('compressAboveMb').setAttribute('aria-invalid', String(!validThreshold));
  $('compressThresholdHint').textContent = validThreshold
    ? '0 表示全部 JPG；1 MB = 1,000,000 字节'
    : '请输入 0–1,000,000 之间的有效 MB 数值';
  $('compressThresholdHint').classList.toggle('invalid-setting', !validThreshold);
  for (const button of $('folderList').querySelectorAll('button')) {
    button.disabled = state.running || state.adding;
  }
}

function renderQueue() {
  $('folderList').replaceChildren();
  state.folders.forEach((folder, index) => {
    const item = document.createElement('div');
    item.className = 'folder-item';
    const number = document.createElement('span');
    number.className = 'folder-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    copy.className = 'folder-copy';
    const title = document.createElement('span');
    title.className = 'folder-name';
    title.textContent = folder.name;
    const path = document.createElement('div');
    path.className = 'folder-path';
    path.textContent = folder.path;
    path.title = folder.path;
    copy.append(title, path);
    const remove = document.createElement('button');
    remove.className = 'remove-folder';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除 ${folder.name}`);
    remove.addEventListener('click', () => {
      if (state.running) return;
      state.folders.splice(index, 1);
      renderQueue();
    });
    item.append(number, copy, remove);
    $('folderList').append(item);
  });
  $('folderCount').textContent = String(state.folders.length);
  if (!state.running)
    $('actionHint').textContent = state.folders.length
      ? `${state.folders.length} 个文件夹已就绪，包含各自的子文件夹`
      : '添加文件夹，开始整理照片';
  updateControls();
}

function enqueue(folders) {
  if (!folders.length) return;
  if (state.completed) resetTask();
  for (const folder of folders) {
    if (!state.folders.some((item) => item.path === folder.path)) state.folders.push(folder);
  }
  renderQueue();
}

function resetTask() {
  if (state.running) return;
  state.completed = false;
  state.folders = [];
  state.total = state.processed = state.success = state.failed = state.skipped = state.logCount = 0;
  for (const id of ['newProcessBtn', 'progressPanel', 'logDetails', 'resultStats']) show(id, false);
  for (const id of ['folderResults', 'logOutput', 'typeCounts', 'resultStats']) {
    $(id).replaceChildren();
  }
  $('logCount').textContent = '0';
  $('logDetails').open = false;
  show('dropZone');
  show('startProcessingBtn');
  notice('');
  renderQueue();
  $('workspace').scrollTo(0, 0);
}

async function selectFolders() {
  if (state.running || state.adding || !isMyGo()) return;
  state.adding = true;
  updateControls();
  try {
    enqueue(await Desktop.selectDirectories());
  } catch (error) {
    notice(error.message);
  } finally {
    state.adding = false;
    updateControls();
  }
}

async function addPaths(paths) {
  if (state.running || state.adding) return;
  state.adding = true;
  updateControls();
  const failures = [];
  try {
    for (const path of paths) {
      try {
        enqueue(await Desktop.validateDirectories([path]));
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (failures.length) notice(failures.join('\n'));
  } finally {
    state.adding = false;
    updateControls();
  }
}

function updateProgress() {
  const percent = state.total
    ? Math.min(100, Math.round((state.processed / state.total) * 100))
    : 0;
  $('progressFill').style.width = `${percent}%`;
  $('progressPercent').textContent = `${percent}%`;
  $('progressBar').setAttribute('aria-valuenow', String(percent));
  $('actionHint').textContent =
    `已处理 ${state.processed} / ${state.total} 张 · 失败 ${state.failed} 张`;
}

function renderGroup(group) {
  const row = document.createElement('div');
  row.className = 'folder-result';
  const text = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'folder-name';
  title.textContent = nameOf(group.directory);
  title.title = group.directory;
  const description = document.createElement('p');
  description.textContent =
    `${group.successfulConversions - group.skippedFiles} 张完成 · ` +
    `${group.skippedFiles} 张跳过 · ${group.failedConversions} 张失败 · ${group.duration.toFixed(1)} 秒`;
  text.append(title, description);
  const open = document.createElement('button');
  open.className = 'text-button';
  open.textContent = '打开输出 ↗';
  open.addEventListener('click', async () => {
    try {
      await Desktop.openDirectory(group.outputDir);
    } catch (error) {
      notice(error.message);
    }
  });
  row.append(text, open);
  $('folderResults').append(row);
}

function onProgress(data) {
  if (!state.running) return;
  switch (data.type) {
    case 'scanning':
      $('progressTitle').textContent = '正在扫描文件夹…';
      $('cancelBtn').disabled = false;
      break;
    case 'start':
      state.total = data.totalStats.total;
      $('progressTitle').textContent = `正在转换 ${state.total} 张照片`;
      $('typeCounts').replaceChildren();
      for (const [type, count] of Object.entries(data.totalStats)) {
        if (type === 'total' || !count) continue;
        const label = document.createElement('span');
        label.textContent = `${type.toUpperCase()} ${count}`;
        $('typeCounts').append(label);
      }
      updateProgress();
      log('info', `发现 ${state.total} 张图片，分布在 ${data.groupCount} 个目录`);
      break;
    case 'group-start':
      $('progressDescription').textContent = data.directory;
      log('info', `处理文件夹：${data.directory}`);
      break;
    case 'worker-pool':
      log('info', data.message || `工作线程已就绪：最多 ${data.effectiveConcurrency} 个线程`);
      break;
    case 'processing':
      $('progressDescription').textContent = `正在处理 ${data.filename}`;
      break;
    case 'compression-retry': {
      const filename = nameOf(data.input);
      $('progressDescription').textContent = `正在重新压缩 ${filename} · 质量 ${data.quality}`;
      log(
        'info',
        `${filename} 的结果为 ${formatBytes(data.outputSize)}，未小于 20 MB；以质量 ${data.quality} 从原图重试`
      );
      break;
    }
    case 'success': {
      state.processed++;
      state.success++;
      if (data.details?.skipped) state.skipped++;
      const size =
        data.details?.inputSize && data.details?.outputSize
          ? ` (${formatBytes(data.details.inputSize)} → ${formatBytes(data.details.outputSize)})`
          : '';
      const compression =
        data.details?.quality != null
          ? ` · 质量 ${data.details.quality}${data.details.attempts > 1 ? ` · 压缩 ${data.details.attempts} 次` : ''}`
          : '';
      log(
        'success',
        data.details?.skipped
          ? `跳过：${data.filename}`
          : `完成：${data.filename} → ${nameOf(data.outputPath)}${size}${compression}`
      );
      updateProgress();
      break;
    }
    case 'error':
      state.processed++;
      state.failed++;
      log('error', `失败：${data.filename} · ${data.error}`);
      $('logDetails').open = true;
      updateProgress();
      break;
    case 'warning':
      log('warning', data.message);
      $('logDetails').open = true;
      break;
    case 'group-done':
      renderGroup(data.group);
      break;
  }
}

function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1000000).toFixed(1)} MB`;
}

function queueSettingsSave() {
  const snapshot = settings();
  saveChain = saveChain.catch(() => {}).then(() => Desktop.saveSettings(snapshot));
  saveChain.catch((error) => notice(`设置保存失败：${error.message}`));
  return saveChain;
}

async function start() {
  if ($('startProcessingBtn').disabled) return;
  state.running = true;
  state.completed = false;
  state.total = state.processed = state.success = state.failed = state.skipped = state.logCount = 0;
  notice('');
  $('logOutput').replaceChildren();
  $('folderResults').replaceChildren();
  $('typeCounts').replaceChildren();
  $('logCount').textContent = '0';
  $('progressTitle').textContent = '正在扫描文件夹…';
  $('progressDescription').textContent = '先统计全部图片，再开始转换';
  $('progressPercent').textContent = '—';
  $('progressFill').style.width = '0%';
  $('progressBar').removeAttribute('aria-valuenow');
  show('progressPanel');
  show('dropZone', false);
  show('resultStats', false);
  show('newProcessBtn', false);
  show('startProcessingBtn', false);
  show('cancelBtn');
  $('cancelBtn').disabled = true;
  $('cancelBtn').textContent = '停止处理';
  updateControls();
  try {
    clearTimeout(saveTimer);
    await queueSettingsSave();
    const result = await Desktop.process(
      state.folders.map((folder) => folder.path),
      settings()
    );
    state.total = result.totalFiles;
    state.processed = result.processedFiles;
    state.success = result.successfulConversions;
    state.failed = result.failedConversions;
    state.skipped = result.skippedFiles;
    updateProgress();
    $('progressTitle').textContent = result.cancelled
      ? '已停止，完成的文件已保留'
      : result.scanErrors?.length
        ? '处理结束，部分文件夹无法读取'
        : !result.totalFiles
          ? '没有找到支持的图片'
          : result.failedConversions
            ? '处理结束，部分图片转换失败'
            : '照片已全部整理完成';
    $('progressDescription').textContent = `用时 ${result.duration.toFixed(1)} 秒 · 原图已保留`;
    $('resultStats').replaceChildren();
    for (const [label, value] of [
      ['已完成', state.success - state.skipped],
      ['已跳过', state.skipped],
      ['失败', state.failed]
    ]) {
      const stat = document.createElement('div');
      stat.className = 'result-stat';
      const count = document.createElement('strong');
      count.textContent = String(value);
      const caption = document.createElement('span');
      caption.textContent = label;
      stat.append(count, caption);
      $('resultStats').append(stat);
    }
    show('resultStats');
    log('info', result.cancelled ? '任务已停止' : '任务处理结束');
    if (!result.totalFiles)
      notice('所选文件夹中没有 HEIC、LIVP、PNG、DNG、TIFF 或 JPG 图片。', false);
    state.completed = true;
    show('newProcessBtn');
  } catch (error) {
    notice(`处理未完成：${error.message}`);
    $('progressTitle').textContent = '处理未完成，可重试';
    log('error', error.message);
    $('logDetails').open = true;
    show('startProcessingBtn');
    show('dropZone');
  } finally {
    state.running = false;
    show('cancelBtn', false);
    updateControls();
  }
}

$('addFolderBtn').addEventListener('click', selectFolders);
$('clearQueueBtn').addEventListener('click', () => {
  state.folders = [];
  renderQueue();
});
$('startProcessingBtn').addEventListener('click', start);
$('cancelBtn').addEventListener('click', async () => {
  $('cancelBtn').disabled = true;
  try {
    await Desktop.cancel();
    $('cancelBtn').textContent = '正在停止…';
    $('progressDescription').textContent = '当前图片处理完成后停止，已完成的结果会保留';
  } catch (error) {
    notice(error.message);
    $('cancelBtn').disabled = false;
  }
});
$('newProcessBtn').addEventListener('click', resetTask);
$('imDownloadLink').addEventListener('click', async () => {
  try {
    await Desktop.openImageMagickDownload();
  } catch (error) {
    notice(error.message);
  }
});
$('settingsFields').addEventListener('input', () => {
  $('qualityValue').textContent = $('qualityRange').value;
  updateControls();
  clearTimeout(saveTimer);
  if (thresholdIsValid()) saveTimer = setTimeout(queueSettingsSave, 200);
});
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    if (!state.running)
      $('dropZone').classList.toggle('drag-over', type === 'dragenter' || type === 'dragover');
  });
}
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    selectFolders();
  }
});

async function initialize() {
  if (!isMyGo()) {
    notice('请通过 npm start 或安装后的桌面程序使用文件夹选择与转换功能。', false);
    $('dependencyStatus').textContent = '界面预览';
    return;
  }
  if (runtime().platform !== 'darwin') $('shortcutHint').textContent = 'Ctrl O';
  events.conversionProgress.on(onProgress);
  onFileDrop(({ paths }) => addPaths(paths));
  await Promise.all([
    (async () => {
      try {
        const saved = await Desktop.getSettings();
        $('qualityRange').value = saved.quality;
        $('qualityValue').textContent = String(saved.quality);
        $('compressJpg').checked = saved.compressJpg;
        $('compressAboveMb').value = String(saved.compressAboveMb ?? 0);
        $('forceUnder20Mb').checked = saved.forceUnder20Mb ?? false;
        $('skipExisting').checked = saved.skipExisting;
        $('concurrency').value = String(saved.concurrency ?? 4);
      } catch (error) {
        notice(`无法读取旧设置，将使用默认值：${error.message}`);
      }
      state.settingsReady = true;
      updateControls();
    })(),
    (async () => {
      try {
        const result = await Desktop.checkDependencies();
        state.engineReady = true;
        $('dependencyStatus').textContent = result.imageMagick
          ? '转换环境已就绪，ImageMagick 可用。'
          : '内置转换器已就绪。部分 DNG 可能需要安装 ImageMagick。';
        $('dependencyStatus').classList.toggle('warning', !result.imageMagick);
        show('imDownloadLink', !result.imageMagick);
      } catch (error) {
        $('dependencyStatus').textContent = '转换环境检查失败';
        notice(error.message);
      }
      updateControls();
    })()
  ]);
}
initialize();
