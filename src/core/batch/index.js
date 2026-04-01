const fs = require('fs');
const path = require('path');
const { factory } = require('../converters');
const { prepareOutputDirectory } = require('../services/file-manager');
const { detectFileType } = require('../services/file-signature');
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
  const stats = { total: 0, heic: 0, livp: 0, png: 0, dng: 0, tiff: 0, jpg: 0 };

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const fstat = safeExecute(fs.statSync, [fullPath], () => null, null);

    if (fstat && fstat.isFile()) {
      const detection = detectFileType(fullPath);
      const converter = detection.type ? factory.getConverterByType(detection.type) : null;
      if (converter) {
        supportedFiles.push(fullPath);
        stats[converter.type]++;
        stats.total++;
      }
    }
  }

  return { success: true, files: supportedFiles, stats };
}

function getExpectedOutputPath(filePath, type, outputDir) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath).toLowerCase();
  // 当检测到的类型是 jpg，但原始扩展名不是 jpg/jpeg 时，需要修正扩展名
  if (type === 'jpg' && ext !== '.jpg' && ext !== '.jpeg') {
    return path.join(outputDir, `${baseName}.jpg`);
  }
  if (type === 'jpg') {
    return path.join(outputDir, path.basename(filePath));
  }
  return path.join(outputDir, `${baseName}.jpg`);
}

async function runWithConcurrency(items, concurrency, handler) {
  const limit = Math.max(1, concurrency || 1);
  let index = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= items.length) break;
      await handler(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
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

  let startedCount = 0;

  await runWithConcurrency(files, options.concurrency, async (filePath) => {
    const filename = path.basename(filePath);
    const detection = detectFileType(filePath);
    const converter = detection.type ? factory.getConverterByType(detection.type) : null;

    if (detection.warning) {
      progressReporter.logWarning(`${filename}: ${detection.warning}`);
    }

    if (!converter) {
      processingStats.failedConversions++;
      processingStats.errors.push({ filename, error: 'No converter found for detected file type' });
      progressReporter.logError(filename, 'No converter found for detected file type', detection.type || 'unknown');
      processingStats.processedFiles++;
      return;
    }

    const currentIndex = ++startedCount;
    progressReporter.logFileProcessing(filename, converter.type, currentIndex, files.length);

    try {
      if (options.skipExisting) {
        const expectedOutputPath = getExpectedOutputPath(filePath, converter.type, outputDir);
        if (fs.existsSync(expectedOutputPath)) {
          processingStats.successfulConversions++;
          progressReporter.logSuccess(filename, expectedOutputPath, converter.type, {
            converted: false,
            originalFormat: converter.type,
            skipped: true
          });
          return;
        }
      }

      const result = await factory.convertByType(filePath, converter.type, outputDir, {
        ...finalOptions,
        forceType: converter.type
      });
      if (result.success) {
        if (!result.outputPath) {
          throw new Error('Conversion succeeded but output path is missing');
        }
        processingStats.successfulConversions++;
        progressReporter.logSuccess(filename, result.outputPath, converter.type, result.details || {});
      } else {
        processingStats.failedConversions++;
        processingStats.errors.push({ filename, error: result.error || 'Unknown conversion error' });
        progressReporter.logError(filename, result.error || 'Unknown conversion error', converter.type);
      }
    } catch (error) {
      processingStats.failedConversions++;
      processingStats.errors.push({ filename, error: error.message });
      progressReporter.logError(filename, error.message, converter.type);
    } finally {
      processingStats.processedFiles++;
    }
  });

  processingStats.endTime = new Date();
  processingStats.duration = (processingStats.endTime - processingStats.startTime) / 1000;

  progressReporter.logSummary();

  return { success: true, stats: processingStats };
});

/**
 * 递归扫描目录及所有子文件夹，按目录分组返回支持的文件
 */
function scanDirectoryRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return { success: false, error: `Directory '${dirPath}' does not exist`, errorType: ErrorTypes.DIRECTORY_NOT_FOUND };
  }

  const groups = [];
  const totalStats = { total: 0, heic: 0, livp: 0, png: 0, dng: 0, tiff: 0, jpg: 0 };

  function walkDir(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir);
    } catch (e) {
      return;
    }

    const supportedFiles = [];
    const stats = { total: 0, heic: 0, livp: 0, png: 0, dng: 0, tiff: 0, jpg: 0 };
    const subdirs = [];

    for (const entry of entries) {
      // 跳过 jpg 输出目录
      if (entry === 'jpg') continue;

      const fullPath = path.join(currentDir, entry);
      const fstat = safeExecute(fs.statSync, [fullPath], () => null, null);
      if (!fstat) continue;

      if (fstat.isDirectory()) {
        subdirs.push(fullPath);
      } else if (fstat.isFile()) {
        const detection = detectFileType(fullPath);
        const converter = detection.type ? factory.getConverterByType(detection.type) : null;
        if (converter) {
          supportedFiles.push(fullPath);
          stats[converter.type]++;
          stats.total++;
        }
      }
    }

    if (supportedFiles.length > 0) {
      groups.push({ dirPath: currentDir, files: supportedFiles, stats });
      // 累加到总计
      for (const key of Object.keys(totalStats)) {
        totalStats[key] += stats[key];
      }
    }

    // 递归处理子目录
    for (const subdir of subdirs) {
      walkDir(subdir);
    }
  }

  walkDir(dirPath);

  return { success: true, groups, totalStats };
}

module.exports = {
  scanDirectory,
  scanDirectoryRecursive,
  batchProcessImages
};
