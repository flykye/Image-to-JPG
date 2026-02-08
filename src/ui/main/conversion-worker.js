const { parentPort, workerData } = require('worker_threads');
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
  const { files, targetDirectory, options } = workerData;
  const reporter = new WorkerProgressReporter();

  try {
    await batchProcessImages(files, targetDirectory, reporter, options);
  } catch (error) {
    parentPort.postMessage({ type: 'fatal-error', error: error.message });
  }
}

run();
