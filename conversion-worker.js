const { parentPort, workerData } = require('worker_threads');
const { ProgressReporter } = require('./progress-reporter');
const { 
    batchProcessImages, 
    processFiles,
    processHeicFile,
    processLivpFile,
    processPngFile,
    processJpgFile,
    isHeicFile,
    isLivpFile,
    isPngFile,
    isJpgFile 
} = require('./batch-processor'); 
const path = require('path');

// Custom Worker ProgressReporter that sends messages back to the main thread
class WorkerProgressReporter extends ProgressReporter {
  constructor(verbose = false) {
    super(verbose);
  }

  // Helper to send messages to main thread
  send(type, data) {
    // We send a minimal set of data to avoid unnecessary serialization overhead
    parentPort.postMessage({ type, ...data });
  }

  // Override logging methods to send messages to main thread
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
    // Do not send summary here, send on 'done' message instead
    super.logSummary();
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

/**
 * Worker thread execution function
 */
async function runConversion() {
  const { fileCategories, targetDirectory, options } = workerData;

  // Worker Progress Reporter sends messages back to main thread (UI)
  const progressReporter = new WorkerProgressReporter(true); 

  try {
    // The core conversion logic runs here, off the main thread
    const result = await batchProcessImages(
      fileCategories, 
      targetDirectory, 
      progressReporter,
      options
    );
    
    // Final summary message
    progressReporter.stats.finalize();

    parentPort.postMessage({ 
      type: 'done', 
      stats: {
        duration: progressReporter.stats.getDuration(),
        totalFiles: progressReporter.stats.totalFiles,
        successfulConversions: progressReporter.stats.successfulConversions,
        failedConversions: progressReporter.stats.failedConversions,
        errors: progressReporter.stats.errors
      },
      hasFailures: result.hasFailures
    });
    
  } catch (error) {
    parentPort.postMessage({ type: 'fatal-error', error: error.message, stack: error.stack });
  }
}

// Start the conversion
runConversion();