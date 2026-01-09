#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const {
  safeExecute,
  safeExecuteAsync,
  createErrorResult,
  ErrorTypes,
  wrapWithTryCatch,
  wrapAsyncWithTryCatch
} = require('./error-handler');
const { ProgressReporter } = require('./progress-reporter');
const { convertHeicToJpgAuto, convertPngToJpgAuto } = require('./heic-converter');
const { extractImageFromLivp } = require('./livp');
const { copyToJpgDirectory, createJpgDirectory } = require('./file-manager');

/**
 * 验证目录是否存在且可访问
 * @param {string} dirPath - 目录路径
 * @returns {Object} 包含成功状态的验证结果
 */
const validateDirectory = wrapWithTryCatch(function (dirPath) {
  // 检查目录是否存在
  if (!fs.existsSync(dirPath)) {
    return {
      success: false,
      error: `Directory '${dirPath}' does not exist`,
      errorType: ErrorTypes.DIRECTORY_NOT_FOUND
    };
  }

  // 检查路径是否确实是一个目录
  const stats = safeExecute(
    fs.statSync,
    [dirPath],
    (error) => {
      return {
        success: false,
        error: `Failed to get directory stats: ${error.message}`,
        errorType: ErrorTypes.PERMISSION_ERROR
      };
    }
  );

  if (!stats || !stats.isDirectory()) {
    return {
      success: false,
      error: `'${dirPath}' is not a directory`,
      errorType: ErrorTypes.INVALID_FORMAT
    };
  }

  // 检查目录是否可访问（可读）
  try {
    fs.accessSync(dirPath, fs.constants.R_OK);
  } catch (accessError) {
    return {
      success: false,
      error: `Cannot access directory '${dirPath}': ${accessError.message}`,
      errorType: ErrorTypes.PERMISSION_ERROR
    };
  }

  return {
    success: true,
    path: dirPath
  };
});

/**
 * 检查文件是否为HEIC文件（不区分大小写）
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果是HEIC文件则返回true
 */
function isHeicFile(filename) {
  return filename.toLowerCase().endsWith('.heic');
}

/**
 * 检查文件是否为LIVP文件（不区分大小写）
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果是LIVP文件则返回true
 */
function isLivpFile(filename) {
  return filename.toLowerCase().endsWith('.livp');
}

/**
 * 检查文件是否为PNG文件（不区分大小写）
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果是PNG文件则返回true
 */
function isPngFile(filename) {
  return filename.toLowerCase().endsWith('.png');
}

/**
 * 检查文件是否为JPG文件（不区分大小写）
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果是JPG文件则返回true
 */
function isJpgFile(filename) {
  const ext = filename.toLowerCase();
  return ext.endsWith('.jpg') || ext.endsWith('.jpeg');
}

/**
 * 处理单个HEIC文件并进行全面的错误处理
 * @param {string} filePath - HEIC文件的路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @param {number} current - 当前文件编号
 * @param {number} total - 文件总数
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
const processHeicFile = wrapAsyncWithTryCatch(async function (filePath, progressReporter, current, total, options = {}) {
  const filename = path.basename(filePath);

  // Log file processing start (Requirement 4.2)
  progressReporter.logFileProcessing(filename, 'heic', current, total);

  // Convert HEIC to JPG directly to output directory (源目录不做任何变更)
  const conversionResult = await safeExecuteAsync(
    convertHeicToJpgAuto,
    [filePath, options.outputDir],  // 直接输出到 jpg 目录
    (error) => {
      progressReporter.logError(filename, error.message, 'heic', 'conversion');
    },
    { success: false, error: 'HEIC conversion failed' }
  );

  if (!conversionResult.success) {
    progressReporter.logError(filename, conversionResult.error, 'heic', 'conversion');
    return { success: false, filename, error: conversionResult.error, type: 'heic' };
  }

  // Log successful conversion (Requirement 4.3)
  progressReporter.logSuccess(filename, conversionResult.outputPath, 'heic', {
    converted: true,
    originalFormat: 'heic',
    compressionRatio: conversionResult.compressionRatio,
    inputSize: conversionResult.inputSize,
    outputSize: conversionResult.outputSize
  });

  return {
    success: true,
    filename,
    outputPath: conversionResult.outputPath,
    type: 'heic',
  };
});

/**
 * 处理单个PNG文件并进行全面的错误处理
 * @param {string} filePath - PNG文件的路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @param {number} current - 当前文件编号
 * @param {number} total - 文件总数
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
const processPngFile = wrapAsyncWithTryCatch(async function (filePath, progressReporter, current, total, options = {}) {
  const filename = path.basename(filePath);

  // 记录文件处理开始
  progressReporter.logFileProcessing(filename, 'png', current, total);

  // 将PNG转换为JPG直接输出到目标目录 (源目录不做任何变更)
  const conversionResult = await safeExecuteAsync(
    convertPngToJpgAuto,
    [filePath, options.outputDir],  // 直接输出到 jpg 目录
    (error) => {
      progressReporter.logError(filename, error.message, 'png', 'conversion');
    },
    { success: false, error: 'PNG conversion failed' }
  );

  if (!conversionResult.success) {
    progressReporter.logError(filename, conversionResult.error, 'png', 'conversion');
    return { success: false, filename, error: conversionResult.error, type: 'png' };
  }

  // 记录成功转换
  progressReporter.logSuccess(filename, conversionResult.outputPath, 'png', {
    converted: true,
    originalFormat: 'png',
    compressionRatio: conversionResult.compressionRatio,
    inputSize: conversionResult.inputSize,
    outputSize: conversionResult.outputSize
  });

  return {
    success: true,
    filename,
    outputPath: conversionResult.outputPath,
    type: 'png',
  };
});

/**
 * 处理单个JPG文件并进行全面的错误处理
 * @param {string} filePath - JPG文件的路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @param {number} current - 当前文件编号
 * @param {number} total - 文件总数
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
const processJpgFile = wrapAsyncWithTryCatch(async function (filePath, progressReporter, current, total, options = {}) {
  const filename = path.basename(filePath);

  // 记录文件处理开始
  progressReporter.logFileProcessing(filename, 'jpg', current, total);

  if (options.compressJpg) {
    // 如果选择压缩JPG，使用 sharp 进行转换（压缩）
    const { convertPngToJpgAuto } = require('./heic-converter'); // PNG转JPG逻辑通用
    const sharp = require('sharp');
    const targetPath = path.join(options.outputDir, filename);

    try {
      const stats = fs.statSync(filePath);
      await sharp(filePath)
        .jpeg({ quality: options.quality || 95 })
        .toFile(targetPath);

      const outputStats = fs.statSync(targetPath);

      progressReporter.logSuccess(filename, targetPath, 'jpg', {
        converted: true,
        originalFormat: 'jpg',
        compressionRatio: (1 - outputStats.size / stats.size) * 100,
        inputSize: stats.size,
        outputSize: outputStats.size
      });

      return {
        success: true,
        filename,
        outputPath: targetPath,
        type: 'jpg',
      };
    } catch (error) {
      progressReporter.logError(filename, error.message, 'jpg', 'compression');
      return { success: false, filename, error: error.message, type: 'jpg' };
    }
  } else {
    // 对于不压缩的JPG文件，复制到输出目录 (源目录不做任何变更)
    const { copyToJpgDirectory } = require('./file-manager');
    const copyResult = copyToJpgDirectory(filePath, filename, options.outputDir);

    if (!copyResult.success) {
      progressReporter.logError(filename, copyResult.error, 'jpg', 'copy');
      return { success: false, filename, error: copyResult.error, type: 'jpg' };
    }

    progressReporter.logSuccess(filename, copyResult.targetPath, 'jpg', {
      converted: false,
      originalFormat: 'jpg'
    });

    return {
      success: true,
      filename,
      outputPath: copyResult.targetPath,
      type: 'jpg',
    };
  }
});

/**
 * 处理单个LIVP文件并进行全面的错误处理
 * @param {string} filePath - LIVP文件的路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @param {number} current - 当前文件编号
 * @param {number} total - 文件总数
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果
 */
const processLivpFile = wrapAsyncWithTryCatch(async function (filePath, progressReporter, current, total, options = {}) {
  const filename = path.basename(filePath);

  // Log file processing start (Requirement 4.2)
  progressReporter.logFileProcessing(filename, 'livp', current, total);

  // Extract image from LIVP directly to output directory (源目录不做任何变更)
  const extractionResult = await safeExecuteAsync(
    extractImageFromLivp,
    [filePath, options.outputDir, options],  // 直接输出到 jpg 目录并传递 options
    (error) => {
      progressReporter.logError(filename, error.message, 'livp', 'extraction');
    },
    { success: false, error: 'LIVP extraction failed' }
  );

  if (!extractionResult.success) {
    progressReporter.logError(filename, extractionResult.error, 'livp', 'extraction');
    return { success: false, filename, error: extractionResult.error, type: 'livp' };
  }

  // Log successful extraction (Requirement 4.3)
  progressReporter.logSuccess(filename, extractionResult.outputPath, 'livp', {
    converted: extractionResult.converted,
    originalFormat: extractionResult.originalFormat,
    compressionRatio: extractionResult.compressionRatio,
    inputSize: extractionResult.inputSize,
    outputSize: extractionResult.outputSize
  });

  return {
    success: true,
    filename,
    outputPath: extractionResult.outputPath,
    type: 'livp',
  };
});

/**
 * 主处理编排函数
 * 将所有组件组合成统一的批处理工作流
 * 实现顺序文件处理以管理内存使用
 * 跟踪处理统计信息并提供最终摘要报告
 * 
 * @param {Object} fileCategories - 包含heicFiles和livpFiles数组的对象
 * @param {string} targetDirectory - 目标目录路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @param {Object} options - 处理选项
 * @returns {Promise<Object>} 处理结果和统计信息
 */
const batchProcessImages = wrapAsyncWithTryCatch(async function (fileCategories, targetDirectory, progressReporter, options = {}) {
  // 初始化处理统计信息
  const processingStats = {
    startTime: new Date(),
    endTime: null,
    totalFiles: fileCategories.totalFiles,
    heicFiles: fileCategories.heicFiles.length,
    livpFiles: fileCategories.livpFiles.length,
    pngFiles: fileCategories.pngFiles ? fileCategories.pngFiles.length : 0,
    jpgFiles: fileCategories.jpgFiles ? fileCategories.jpgFiles.length : 0, // 新增JPG文件统计
    processedFiles: 0,
    successfulConversions: 0,
    failedConversions: 0,
    copiedToJpgDir: 0,
    errors: []
  };

  // 记录处理开始（需求4.1）
  progressReporter.logStart(targetDirectory, fileCategories);

  // 确保输出目录存在并进行错误处理（需求5.1）
  const outputDir = options.outputDir || null;
  const jpgDirResult = await safeExecuteAsync(
    createJpgDirectory,
    [outputDir, targetDirectory],
    (error) => {
      const dirName = outputDir || `${targetDirectory}/jpg`;
      progressReporter.logError(dirName, error.message, 'system', 'directory creation');
      processingStats.errors.push({
        type: 'system',
        operation: 'directory creation',
        message: error.message,
        timestamp: new Date()
      });
    },
    { success: false, error: 'Failed to create output directory' }
  );

  if (!jpgDirResult.success) {
    progressReporter.logError('jpg directory', jpgDirResult.error, 'system', 'directory creation');
    processingStats.errors.push({
      type: 'system',
      operation: 'directory creation',
      message: jpgDirResult.error,
      timestamp: new Date()
    });
    // Continue processing even if jpg directory creation fails
  }

  // 确保 options.outputDir 使用实际创建的目录路径
  const finalOutputDir = jpgDirResult.path || options.outputDir || path.join(targetDirectory, 'jpg');
  const processingOptions = { ...options, outputDir: finalOutputDir };

  // 合并所有文件以进行顺序处理
  const allFiles = [...fileCategories.heicFiles, ...fileCategories.livpFiles, ...(fileCategories.pngFiles || []), ...(fileCategories.jpgFiles || [])];
  const results = [];

  // 顺序处理每个文件以管理内存使用（需求6.1-6.5）
  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const filename = path.basename(filePath);

    // 更新处理统计信息
    processingStats.processedFiles++;

    // 检查文件是否存在并进行错误处理
    const fileExists = safeExecute(
      fs.existsSync,
      [filePath],
      (error) => {
        progressReporter.logError(filename, `File existence check failed: ${error.message}`, 'unknown', 'file access');
        processingStats.errors.push({
          filename,
          type: 'unknown',
          operation: 'file access',
          message: error.message,
          timestamp: new Date()
        });
        return false;
      },
      false
    );

    if (!fileExists) {
      progressReporter.logError(filename, 'File does not exist', 'unknown', 'file access');
      processingStats.failedConversions++;
      processingStats.errors.push({
        filename,
        type: 'unknown',
        operation: 'file access',
        message: 'File does not exist',
        timestamp: new Date()
      });
      results.push({ success: false, filename, error: 'File does not exist', type: 'unknown' });
      continue;
    }

    // 检查文件可访问性并进行错误处理
    const isReadable = safeExecute(
      () => {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
      },
      [],
      (error) => {
        progressReporter.logError(filename, `Cannot read file: ${error.message}`, 'unknown', 'file access');
        processingStats.errors.push({
          filename,
          type: 'unknown',
          operation: 'file access',
          message: `Cannot read file: ${error.message}`,
          timestamp: new Date()
        });
        return false;
      },
      false
    );

    if (!isReadable) {
      processingStats.failedConversions++;
      results.push({ success: false, filename, error: 'File is not readable', type: 'unknown' });
      continue;
    }

    let result;

    // 检查是否应该跳过此文件（如果已经有JPG版本）
    let shouldSkip = false;
    if (options.skipExisting) {
      const baseFilename = path.basename(filePath, path.extname(filePath));
      const jpgPath = path.join(path.dirname(filePath), `${baseFilename}.jpg`);
      const jpegPath = path.join(path.dirname(filePath), `${baseFilename}.jpeg`);

      shouldSkip = fs.existsSync(jpgPath) || fs.existsSync(jpegPath);

      if (shouldSkip) {
        progressReporter.logInfo(`Skipping ${filename} - JPG version already exists`);
        result = {
          success: true,
          filename,
          skipped: true,
          type: isHeicFile(filename) ? 'heic' : (isLivpFile(filename) ? 'livp' : 'png')
        };
        processingStats.successfulConversions++;
        results.push(result);
        continue;
      }
    }

    // 根据文件类型进行处理并进行错误处理
    try {
      if (isHeicFile(filename)) {
        result = await processHeicFile(filePath, progressReporter, i + 1, allFiles.length, processingOptions);
      } else if (isLivpFile(filename)) {
        result = await processLivpFile(filePath, progressReporter, i + 1, allFiles.length, processingOptions);
      } else if (isPngFile(filename)) {
        result = await processPngFile(filePath, progressReporter, i + 1, allFiles.length, processingOptions);
      } else if (isJpgFile(filename)) { // 新增对JPG文件的处理
        result = await processJpgFile(filePath, progressReporter, i + 1, allFiles.length, processingOptions);
      } else {
        // 考虑到我们的文件过滤，这种情况不应该发生，但仍然要优雅地处理
        progressReporter.logError(filename, 'Unknown file type', 'unknown', 'processing');
        processingStats.failedConversions++;
        processingStats.errors.push({
          filename,
          type: 'unknown',
          operation: 'processing',
          message: 'Unknown file type',
          timestamp: new Date()
        });
        result = { success: false, filename, error: 'Unknown file type', type: 'unknown' };
      }
    } catch (error) {
      // 处理单个文件处理过程中的任何意外错误（需求6.5）
      progressReporter.logError(filename, error.message, 'unknown', 'processing');
      processingStats.failedConversions++;
      processingStats.errors.push({
        filename,
        type: 'unknown',
        operation: 'processing',
        message: error.message,
        timestamp: new Date()
      });
      result = { success: false, filename, error: error.message, type: 'unknown' };
    }

    // 根据处理结果更新统计信息
    if (result.success) {
      processingStats.successfulConversions++;
      if (result.copied) {
        processingStats.copiedToJpgDir++;
      }
    } else {
      processingStats.failedConversions++;
    }

    results.push(result);

    // 可选的内存清理（有助于处理大批量文件）
    if (options.aggressiveMemoryCleanup && global.gc) {
      global.gc();
    }
  }

  // 文件已经直接输出到目标目录，不需要再移动

  // 完成处理统计信息
  processingStats.endTime = new Date();
  processingStats.duration = (processingStats.endTime - processingStats.startTime) / 1000;
  processingStats.successRate = processingStats.totalFiles > 0
    ? (processingStats.successfulConversions / processingStats.totalFiles) * 100
    : 0;

  // 记录最终摘要（需求4.4）
  progressReporter.logSummary();

  // 返回全面的结果以便更好地进行测试和集成
  // 包含所有处理过的文件路径
  const processedFiles = results.filter(r => r.success && r.outputPath).map(r => r.outputPath);

  return {
    success: true,
    targetDirectory,
    results,
    processedFiles, // 新增：所有处理过的文件路径
    stats: processingStats,
    hasFailures: results.some(result => !result.success)
  };
});

/**
 * 主文件处理函数，具有全面的错误处理
 * @param {Object} fileCategories - 包含heicFiles和livpFiles数组的对象
 * @param {string} targetDirectory - 目标目录路径
 * @param {ProgressReporter} progressReporter - 进度报告器实例
 * @returns {Promise<Object>} 处理结果
 */
const processFiles = wrapAsyncWithTryCatch(async function (fileCategories, targetDirectory, progressReporter) {
  // Delegate to the new batch processing orchestration function
  return batchProcessImages(fileCategories, targetDirectory, progressReporter);
});

/**
 * 扫描目录查找HEIC和LIVP文件
 * @param {string} dirPath - 目录路径
 * @returns {Object} 包含文件数组或错误信息的扫描结果
 */
const scanDirectory = wrapWithTryCatch(function (dirPath) {
  // 首先验证目录
  const validationResult = validateDirectory(dirPath);
  if (!validationResult.success) {
    return validationResult;
  }

  // 读取目录内容并进行错误处理
  const files = safeExecute(
    fs.readdirSync,
    [dirPath],
    (error) => {
      return {
        success: false,
        error: `Failed to read directory: ${error.message}`,
        errorType: ErrorTypes.PERMISSION_ERROR
      };
    },
    null
  );

  if (!files) {
    return {
      success: false,
      error: 'Failed to read directory contents',
      errorType: ErrorTypes.PERMISSION_ERROR
    };
  }

  const heicFiles = [];
  const livpFiles = [];
  const pngFiles = [];
  const jpgFiles = []; // 新增用于存储JPG文件的数组

  // 处理每个文件
  for (const file of files) {
    const fullPath = path.join(dirPath, file);

    // 安全地检查它是否是一个文件
    const stats = safeExecute(
      fs.statSync,
      [fullPath],
      (error) => {
        console.warn(`Warning: Cannot access file ${fullPath}: ${error.message}`);
        return null;
      },
      null
    );

    // 跳过我们无法访问或不是文件的文件
    if (!stats || !stats.isFile()) {
      continue;
    }

    // 按类型对文件进行分类
    if (isHeicFile(file)) {
      heicFiles.push(fullPath);
    } else if (isLivpFile(file)) {
      livpFiles.push(fullPath);
    } else if (isPngFile(file)) {
      pngFiles.push(fullPath);
    } else if (isJpgFile(file)) { // 新增对JPG文件的分类
      jpgFiles.push(fullPath);
    }
  }

  return {
    success: true,
    heicFiles,
    livpFiles,
    pngFiles,
    jpgFiles, // 导出JPG文件列表
    totalFiles: heicFiles.length + livpFiles.length + pngFiles.length + jpgFiles.length // 更新总文件数
  };
});

// Initialize commander program
const program = new Command();

/**
 * 显示批量图像处理器的使用示例
 */
function displayExamples() {
  console.log('\nExamples:');
  console.log('  $ batch-image-processor ./photos');
  console.log('  $ batch-image-processor ./photos --verbose');
  console.log('  $ batch-image-processor ./photos --skip-existing');
  console.log('  $ batch-image-processor ./photos --output-dir ./converted');
  console.log('  $ batch-image-processor --legacy');
}

program
  .name('batch-image-processor')
  .description('Batch process HEIC, LIVP and PNG files in a directory')
  .version('1.0.0')
  .argument('[directory]', 'Directory path containing HEIC, LIVP and PNG files to process')
  .option('-v, --verbose', 'Enable verbose logging with detailed information')
  .option('-m, --memory-cleanup', 'Enable aggressive memory cleanup after each file (helps with large batches)')
  .option('-s, --skip-existing', 'Skip processing files that already have JPG versions')
  .option('-c, --concurrency <number>', 'Number of files to process concurrently (default: 1)', parseInt)
  .option('-o, --output-dir <path>', 'Custom output directory for JPG files (default: ./jpg)')
  .option('-l, --legacy', 'Run in legacy mode (process only LIVP files in current directory)')
  .option('--no-copy', 'Do not copy processed files to jpg directory')
  .addHelpText('after', displayExamples)
  .action(wrapAsyncWithTryCatch(async (directory, options) => {
    // Check if running in legacy mode
    if (options.legacy) {
      console.log('Running in legacy mode - processing LIVP files in current directory');
      const { extractImagesInCurrentDirectory } = require('./livp');
      await extractImagesInCurrentDirectory();
      return;
    }

    // If no directory is provided and not in legacy mode, show help
    if (!directory) {
      console.error('Error: Directory path is required');
      program.help();
      return;
    }

    // Resolve to absolute path
    const targetDirectory = path.resolve(directory);

    console.log(`Target directory: ${targetDirectory}`);
    if (options.verbose) {
      console.log('Verbose mode enabled');
      console.log(`Processing options: ${JSON.stringify({
        memoryCleanup: options.memoryCleanup || false,
        skipExisting: options.skipExisting || false,
        concurrency: options.concurrency || 1,
        outputDir: options.outputDir || './jpg',
        copy: options.copy !== false
      }, null, 2)}`);
    }

    // Validate directory using enhanced validation function
    const validationResult = validateDirectory(targetDirectory);
    if (!validationResult.success) {
      console.error(`Error: ${validationResult.error}`);
      process.exit(1);
    }

    // Scan directory for HEIC and LIVP files with error handling
    const scanResult = scanDirectory(targetDirectory);
    if (!scanResult.success) {
      console.error(`Error: ${scanResult.error}`);
      process.exit(1);
    }

    const fileCategories = scanResult;

    console.log(`Found ${fileCategories.heicFiles.length} HEIC files`);
    console.log(`Found ${fileCategories.livpFiles.length} LIVP files`);
    console.log(`Found ${fileCategories.pngFiles ? fileCategories.pngFiles.length : 0} PNG files`);
    console.log(`Total files to process: ${fileCategories.totalFiles}`);

    if (options.verbose) {
      if (fileCategories.heicFiles.length > 0) {
        console.log('\nHEIC files:');
        fileCategories.heicFiles.forEach(file => console.log(`  - ${file}`));
      }
      if (fileCategories.livpFiles.length > 0) {
        console.log('\nLIVP files:');
        fileCategories.livpFiles.forEach(file => console.log(`  - ${file}`));
      }
      if (fileCategories.pngFiles && fileCategories.pngFiles.length > 0) {
        console.log('\nPNG files:');
        fileCategories.pngFiles.forEach(file => console.log(`  - ${file}`));
      }
    }

    if (fileCategories.totalFiles === 0) {
      console.log('No HEIC, LIVP or PNG files found in the specified directory.');
      process.exit(0);
    }

    // Create progress reporter
    const progressReporter = new ProgressReporter(options.verbose);

    // Configure processing options
    const processingOptions = {
      aggressiveMemoryCleanup: options.memoryCleanup || false,
      concurrency: options.concurrency || 1, // Default to sequential processing
      skipExisting: options.skipExisting || false,
      outputDir: options.outputDir || path.join(targetDirectory, 'jpg'),
      copy: options.copy !== false
    };

    // Start processing with the new batch processing orchestration function
    const processingResult = await batchProcessImages(
      fileCategories,
      targetDirectory,
      progressReporter,
      processingOptions
    );

    // Display additional statistics if verbose mode is enabled
    if (options.verbose && processingResult.stats) {
      console.log('\n📊 Detailed Processing Statistics:');
      console.log(`  • Processing time: ${processingResult.stats.duration.toFixed(2)} seconds`);
      console.log(`  • Files processed: ${processingResult.stats.processedFiles} of ${processingResult.stats.totalFiles}`);
      console.log(`  • Success rate: ${processingResult.stats.successRate.toFixed(1)}%`);
      console.log(`  • Files copied to jpg directory: ${processingResult.stats.copiedToJpgDir}`);
    } else {
      // Display a simple summary for non-verbose mode
      console.log('\n✅ Processing complete');
      console.log(`  • Processed ${processingResult.stats.processedFiles} files in ${processingResult.stats.duration.toFixed(2)} seconds`);
      console.log(`  • Successful: ${processingResult.stats.successfulConversions}, Failed: ${processingResult.stats.failedConversions}`);

      if (processingResult.stats.copiedToJpgDir > 0) {
        const outputDir = options.outputDir || path.join(targetDirectory, 'jpg');
        console.log(`  • ${processingResult.stats.copiedToJpgDir} files copied to ${outputDir} directory`);
      }
    }

    // Exit with appropriate code based on results
    if (processingResult.hasFailures) {
      console.log('\n⚠️  Some files failed to process. Use --verbose for more details.');
      process.exit(1);
    }
  }));

// Parse command line arguments with error handling
const parseCommandLine = wrapWithTryCatch(
  () => {
    // Handle cases where no arguments are provided
    if (process.argv.length <= 2) {
      program.help();
      process.exit(1);
    }
    program.parse();
  },
  (error) => {
    console.error(`Command parsing error: ${error.message}`);
    process.exit(1);
  }
);

// Only parse arguments when this file is run directly (not when required as a module)
if (require.main === module) {
  parseCommandLine();
}

// Export public API
module.exports = {
  // Public functions
  validateDirectory,
  scanDirectory,
  // Core processing functions (used by CLI and Worker Thread)
  batchProcessImages,
  processFiles,
  processHeicFile,
  processLivpFile,
  processPngFile,
  processJpgFile,
  isHeicFile,
  isLivpFile,
  isPngFile,
  isJpgFile,

  // For testing purposes only
  __test__: {
    batchProcessImages,
    processFiles,
    processHeicFile,
    processLivpFile,
    processPngFile,
    isHeicFile,
    isLivpFile,
    isPngFile,
    processJpgFile,
    isJpgFile
  }
};