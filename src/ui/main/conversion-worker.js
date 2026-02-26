const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const { batchProcessImages } = require('../../core/batch');
const { ProgressReporter } = require('../../core/services/progress-reporter');

class WorkerProgressReporter extends ProgressReporter {
  constructor() {
    super(false);
  }

  send(type, data) {
    parentPort.postMessage({ type, ...data });
  }

  logStart(directory, fileCategories) {
    this.send('start', {
      totalFiles: fileCategories.total || fileCategories.totalFiles,
      heicCount: fileCategories.heic || fileCategories.heicCount || 0,
      livpCount: fileCategories.livp || fileCategories.livpCount || 0,
      pngCount: fileCategories.png || fileCategories.pngCount || 0,
      dngCount: fileCategories.dng || fileCategories.dngCount || 0,
      tiffCount: fileCategories.tiff || fileCategories.tiffCount || 0,
      jpgCount: fileCategories.jpg || fileCategories.jpgCount || 0
    });
  }

  logFileProcessing(filename, fileType, current, total) {
    this.send('processing', {
      filename,
      fileType,
      current,
      total,
      progress: Math.round((current / total) * 100)
    });
  }

  logSuccess(filename, outputPath, fileType, details) {
    const outputFilename = outputPath ? require('path').basename(outputPath) : filename;
    this.send('success', { filename, outputFilename, fileType, details });
  }

  logError(filename, error, fileType, operation) {
    this.send('error', { filename, error, fileType, operation });
  }

  logWarning(message) {
    this.send('warning', { message });
  }

  logSummary() {
    const stats = this.stats;
    this.send('done', {
      stats: {
        duration: stats.getDuration(),
        totalFiles: stats.totalFiles,
        successfulConversions: stats.successfulConversions,
        failedConversions: stats.failedConversions
      }
    });
  }
}

async function run() {
  const { groups, rootDirectory, options: baseOptions } = workerData;

  // 兼容旧格式（单文件列表）
  if (!groups && workerData.files) {
    const reporter = new WorkerProgressReporter();
    try {
      await batchProcessImages(workerData.files, workerData.targetDirectory, reporter, workerData.options);
    } catch (error) {
      parentPort.postMessage({ type: 'fatal-error', error: error.message });
    }
    return;
  }

  // 新格式：按组处理
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalFiles = 0;
  const startTime = Date.now();

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupDirName = path.relative(rootDirectory, group.dirPath) || path.basename(group.dirPath);

    parentPort.postMessage({
      type: 'group-start',
      groupIndex: i,
      groupCount: groups.length,
      groupDir: group.dirPath,
      groupDirName: groupDirName || '.',
      groupStats: group.stats
    });

    const reporter = new WorkerProgressReporter();
    try {
      const result = await batchProcessImages(group.files, group.dirPath, reporter, {
        ...baseOptions,
        outputDir: group.outputDir,
        stats: group.stats,
        clearExisting: true
      });

      if (result && result.stats) {
        totalSuccess += result.stats.successfulConversions;
        totalFailed += result.stats.failedConversions;
        totalFiles += result.stats.totalFiles;
      }
    } catch (error) {
      parentPort.postMessage({ type: 'error', filename: groupDirName, error: error.message });
    }

    parentPort.postMessage({
      type: 'group-done',
      groupIndex: i,
      groupCount: groups.length,
      groupDir: group.dirPath,
      groupDirName: groupDirName || '.'
    });
  }

  // 发送总汇总
  parentPort.postMessage({
    type: 'all-done',
    stats: {
      duration: (Date.now() - startTime) / 1000,
      totalFiles,
      successfulConversions: totalSuccess,
      failedConversions: totalFailed
    }
  });
}

run();
