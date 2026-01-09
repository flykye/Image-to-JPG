/**
 * 进度报告器模块
 * 处理处理开始、进度、完成和错误报告的控制台日志记录
 */

/**
 * 处理统计信息跟踪器
 */
class ProcessingStats {
  constructor() {
    this.totalFiles = 0;
    this.heicFiles = 0;
    this.livpFiles = 0;
    this.pngFiles = 0;
    this.jpgFiles = 0; // 新增JPG文件统计
    this.successfulConversions = 0;
    this.failedConversions = 0;
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Initialize processing statistics
   * @param {Object} fileCategories - Object containing heicFiles and livpFiles arrays
   */
  initialize(fileCategories) {
    this.heicFiles = fileCategories.heicFiles.length;
    this.livpFiles = fileCategories.livpFiles.length;
    this.pngFiles = fileCategories.pngFiles ? fileCategories.pngFiles.length : 0;
    this.jpgFiles = fileCategories.jpgFiles ? fileCategories.jpgFiles.length : 0; // 初始化JPG文件统计
    this.totalFiles = this.heicFiles + this.livpFiles + this.pngFiles + this.jpgFiles;
    this.startTime = new Date();
  }

  /**
   * Record a successful file processing
   * @param {string} fileType - Type of file processed ('heic' or 'livp')
   * @param {string} outputPath - Path to the output file
   */
  recordSuccess(fileType, outputPath) {
    this.successfulConversions++;
  }

  /**
   * Record a failed file processing
   * @param {string} filename - Name of the file that failed
   * @param {string} error - Error message
   * @param {string} fileType - Type of file that failed ('heic' or 'livp')
   */
  recordFailure(filename, error, fileType) {
    this.failedConversions++;
    this.errors.push({
      filename,
      error,
      fileType,
      timestamp: new Date()
    });
  }

  /**
   * Finalize processing statistics
   */
  finalize() {
    this.endTime = new Date();
  }

  /**
   * Get processing duration in seconds
   * @returns {number} Duration in seconds
   */
  getDuration() {
    if (!this.startTime || !this.endTime) {
      return 0;
    }
    return Math.round((this.endTime - this.startTime) / 1000);
  }
}

/**
 * Helper function to format bytes into readable string (e.g., 1.2 MB)
 * @param {number} bytes - Size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted size string
 */
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Progress Reporter class for handling all logging and progress reporting
 */
class ProgressReporter {
  constructor(verbose = false) {
    this.verbose = verbose;
    this.stats = new ProcessingStats();
  }

  /**
   * Log the start of processing (Requirement 4.1)
   * @param {string} directory - Target directory path
   * @param {Object} fileCategories - Object containing file counts and arrays
   */
  logStart(directory, fileCategories) {
    this.stats.initialize(fileCategories);
    
    console.log('='.repeat(60));
    console.log('🚀 Starting Batch Image Processing');
    console.log('='.repeat(60));
    console.log(`📁 Target directory: ${directory}`);
    console.log(`📊 Found ${fileCategories.heicFiles.length} HEIC files`);
    console.log(`📊 Found ${fileCategories.livpFiles.length} LIVP files`);
    console.log(`📊 Found ${fileCategories.pngFiles ? fileCategories.pngFiles.length : 0} PNG files`);
    console.log(`📊 Found ${fileCategories.jpgFiles ? fileCategories.jpgFiles.length : 0} JPG files`);
    console.log(`📊 Total files to process: ${fileCategories.totalFiles}`);
    
    if (this.verbose && fileCategories.totalFiles > 0) {
      console.log('\n📋 Files to process:');
      if (fileCategories.heicFiles.length > 0) {
        console.log('  HEIC files:');
        fileCategories.heicFiles.forEach(file => {
          console.log(`    • ${file}`);
        });
      }
      if (fileCategories.livpFiles.length > 0) {
        console.log('  LIVP files:');
        fileCategories.livpFiles.forEach(file => {
          console.log(`    • ${file}`);
        });
      }
      if (fileCategories.pngFiles && fileCategories.pngFiles.length > 0) {
        console.log('  PNG files:');
        fileCategories.pngFiles.forEach(file => {
          console.log(`    • ${file}`);
        });
      }
      if (fileCategories.jpgFiles && fileCategories.jpgFiles.length > 0) {
        console.log('  JPG files:');
        fileCategories.jpgFiles.forEach(file => {
          console.log(`    • ${file}`);
        });
      }
    }
    
    console.log('='.repeat(60));
    console.log('');
  }

  /**
   * Log the current file being processed (Requirement 4.2)
   * @param {string} filename - Name of the file being processed
   * @param {string} fileType - Type of file ('heic' or 'livp')
   * @param {number} current - Current file number
   * @param {number} total - Total number of files
   */
  logFileProcessing(filename, fileType, current, total) {
    const progress = `[${current}/${total}]`;
    const icon = fileType === 'heic' ? '🖼️' : '📦';
    console.log(`${progress} ${icon} Processing ${fileType.toUpperCase()}: ${filename}`);
  }

  /**
   * Log successful file processing (Requirement 4.3)
   * @param {string} filename - Original filename
   * @param {string} outputPath - Path to the output file
   * @param {string} fileType - Type of file processed
   * @param {Object} details - Additional processing details
   */
  logSuccess(filename, outputPath, fileType, details = {}) {
    this.stats.recordSuccess(fileType, outputPath);
    
    const icon = '✅';
    const outputFilename = require('path').basename(outputPath);
    
    let message = `${icon} Successfully processed ${filename} → ${outputFilename}`;
    
    if (details.converted) {
      message += ` (converted from ${details.originalFormat.toUpperCase()})`;
    }
    
    if (details.compressionRatio && details.compressionRatio > 0) {
      const inputSize = formatBytes(details.inputSize || 0);
      const outputSize = formatBytes(details.outputSize || 0);
      message += ` (${inputSize} → ${outputSize}, ${details.compressionRatio.toFixed(1)}% compression)`;
    }
    
    console.log(`    ${message}`);
    
    if (this.verbose && details.inputSize && details.outputSize) {
      const inputSizeKB = (details.inputSize / 1024).toFixed(1);
      const outputSizeKB = (details.outputSize / 1024).toFixed(1);
      console.log(`    📏 Size: ${inputSizeKB}KB → ${outputSizeKB}KB`);
    }
  }

  /**
   * Log error messages (Requirement 4.5)
   * @param {string} filename - Name of the file that caused the error
   * @param {string} error - Error message
   * @param {string} fileType - Type of file that failed
   * @param {string} operation - Operation that failed (e.g., 'conversion', 'extraction', 'copy')
   */
  logError(filename, error, fileType, operation = 'processing') {
    this.stats.recordFailure(filename, error, fileType);
    
    const icon = '❌';
    console.log(`    ${icon} Failed to ${operation} ${filename}: ${error}`);
    
    if (this.verbose) {
      console.log(`    🔍 File type: ${fileType.toUpperCase()}`);
      console.log(`    🕐 Error time: ${new Date().toLocaleTimeString()}`);
    }
  }

  /**
   * Log processing summary (Requirement 4.4)
   */
  logSummary() {
    this.stats.finalize();
    const duration = this.stats.getDuration();
    
    console.log('');
    console.log('='.repeat(60));
    console.log('📊 Processing Summary');
    console.log('='.repeat(60));
    
    console.log(`⏱️  Processing time: ${duration} seconds`);
    console.log(`📁 Total files processed: ${this.stats.totalFiles}`);
    console.log(`✅ Successful conversions: ${this.stats.successfulConversions}`);
    console.log(`❌ Failed conversions: ${this.stats.failedConversions}`);
    
    if (this.stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${this.stats.errors.length}`);
      
      if (this.verbose) {
        console.log('\n📋 Error details:');
        this.stats.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error.filename} (${error.fileType.toUpperCase()}): ${error.error}`);
        });
      } else {
        console.log('   Use --verbose flag to see detailed error information');
      }
    }
    
    // Success rate calculation
    if (this.stats.totalFiles > 0) {
      const successRate = ((this.stats.successfulConversions / this.stats.totalFiles) * 100).toFixed(1);
      console.log(`📈 Success rate: ${successRate}%`);
    }
    
    console.log('='.repeat(60));
    
    // Final status message
    if (this.stats.failedConversions === 0) {
      console.log('🎉 All files processed successfully!');
    } else if (this.stats.successfulConversions > 0) {
      console.log('⚠️  Processing completed with some errors. Check the error details above.');
    } else {
      console.log('💥 Processing failed for all files. Please check the error messages above.');
    }
  }

  /**
   * Log a general informational message
   * @param {string} message - Message to log
   */
  logInfo(message) {
    console.log(`ℹ️  ${message}`);
  }

  /**
   * Log a warning message
   * @param {string} message - Warning message to log
   */
  logWarning(message) {
    console.log(`⚠️  ${message}`);
  }

  /**
   * Get current processing statistics
   * @returns {ProcessingStats} Current statistics
   */
  getStats() {
    return this.stats;
  }
}

module.exports = {
  ProgressReporter,
  ProcessingStats
};