const fs = require('fs');
const path = require('path');
const { factory } = require('../converters');
const { prepareOutputDirectory } = require('../services/file-manager');
const { wrapAsyncWithTryCatch, safeExecute, ErrorTypes } = require('../services/error-handler');

/**
 * 扫描目录查找支持的文件
 */
function scanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { success: false, error: `Directory '${dirPath}' does not exist`, errorType: ErrorTypes.DIRECTORY_NOT_FOUND };
  }

  const files = fs.readdirSync(dirPath);
  const supportedFiles = [];
  const stats = { total: 0, heic: 0, livp: 0, png: 0, dng: 0, jpg: 0 };

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const fstat = safeExecute(fs.statSync, [fullPath], () => null, null);

    if (fstat && fstat.isFile()) {
      const converter = factory.getConverter(file);
      if (converter) {
        supportedFiles.push(fullPath);
        stats[converter.type]++;
        stats.total++;
      }
    }
  }

  return { success: true, files: supportedFiles, stats };
}

/**
 * 批处理图像
 */
const batchProcessImages = wrapAsyncWithTryCatch(async function (files, targetDirectory, progressReporter, options = {}) {
  const { stats: fileStats } = options;
  const processingStats = {
    startTime: new Date(),
    totalFiles: files.length,
    processedFiles: 0,
    successfulConversions: 0,
    failedConversions: 0,
    errors: []
  };

  const outputDir = prepareOutputDirectory(options.outputDir, targetDirectory, options.clearExisting !== false);
  const finalOptions = { ...options, outputDir };

  progressReporter.logStart(targetDirectory, fileStats || { totalFiles: files.length });

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = path.basename(filePath);
    const converter = factory.getConverter(filePath);

    processingStats.processedFiles++;
    progressReporter.logFileProcessing(filename, converter.type, i + 1, files.length);

    try {
      const result = await factory.convert(filePath, outputDir, finalOptions);
      if (result.success) {
        // 确保outputPath存在
        if (!result.outputPath) {
          throw new Error('Conversion succeeded but output path is missing');
        }
        processingStats.successfulConversions++;
        progressReporter.logSuccess(filename, result.outputPath, converter.type, result.details || {});
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      processingStats.failedConversions++;
      processingStats.errors.push({ filename, error: error.message });
      progressReporter.logError(filename, error.message, converter.type);
    }
  }

  processingStats.endTime = new Date();
  processingStats.duration = (processingStats.endTime - processingStats.startTime) / 1000;

  progressReporter.logSummary();

  return { success: true, stats: processingStats };
});

module.exports = {
  scanDirectory,
  batchProcessImages
};
