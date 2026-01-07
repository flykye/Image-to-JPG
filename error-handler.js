/**
 * 错误处理模块
 * 为批量图像处理器提供集中式错误处理功能
 */

/**
 * 用于分类不同错误的错误类型
 */
const ErrorTypes = {
  FILE_NOT_FOUND: 'file_not_found',
  DIRECTORY_NOT_FOUND: 'directory_not_found',
  PERMISSION_ERROR: 'permission_error',
  INVALID_FORMAT: 'invalid_format',
  CORRUPTED_FILE: 'corrupted_file',
  CONVERSION_ERROR: 'conversion_error',
  EXTRACTION_ERROR: 'extraction_error',
  COPY_ERROR: 'copy_error',
  DISK_SPACE_ERROR: 'disk_space_error',
  UNKNOWN_ERROR: 'unknown_error'
};

/**
 * 根据错误消息对错误进行分类
 * @param {Error} error - 错误对象
 * @param {string} defaultType - 如果未检测到特定类型，则使用默认错误类型
 * @returns {string} 错误类型分类
 */
function categorizeError(error, defaultType = ErrorTypes.UNKNOWN_ERROR) {
  if (!error || !error.message) {
    return defaultType;
  }

  const message = error.message.toLowerCase();
  
  if (message.includes('does not exist') || message.includes('no such file')) {
    return message.includes('directory') && !message.includes('file or directory') ? 
      ErrorTypes.DIRECTORY_NOT_FOUND : ErrorTypes.FILE_NOT_FOUND;
  } else if (message.includes('permission') || message.includes('access')) {
    return ErrorTypes.PERMISSION_ERROR;
  } else if (message.includes('not a heic file') || message.includes('invalid format') || message.includes('unsupported')) {
    return ErrorTypes.INVALID_FORMAT;
  } else if (message.includes('corrupted') || message.includes('invalid image')) {
    return ErrorTypes.CORRUPTED_FILE;
  } else if (message.includes('conversion')) {
    return ErrorTypes.CONVERSION_ERROR;
  } else if (message.includes('extract')) {
    return ErrorTypes.EXTRACTION_ERROR;
  } else if (message.includes('copy')) {
    return ErrorTypes.COPY_ERROR;
  } else if (message.includes('space') || message.includes('disk full')) {
    return ErrorTypes.DISK_SPACE_ERROR;
  }
  
  return defaultType;
}

/**
 * Safely execute a function with error handling
 * @param {Function} fn - Function to execute
 * @param {Array} args - Arguments to pass to the function
 * @param {Function} onError - Error handler function
 * @param {any} defaultValue - Default value to return on error
 * @returns {any} Function result or default value on error
 */
function safeExecute(fn, args = [], onError = null, defaultValue = null) {
  try {
    return fn(...args);
  } catch (error) {
    if (onError && typeof onError === 'function') {
      onError(error);
    }
    return defaultValue;
  }
}

/**
 * Safely execute an async function with error handling
 * @param {Function} fn - Async function to execute
 * @param {Array} args - Arguments to pass to the function
 * @param {Function} onError - Error handler function
 * @param {any} defaultValue - Default value to return on error
 * @returns {Promise<any>} Promise resolving to function result or default value on error
 */
async function safeExecuteAsync(fn, args = [], onError = null, defaultValue = null) {
  try {
    return await fn(...args);
  } catch (error) {
    if (onError && typeof onError === 'function') {
      onError(error);
    }
    return defaultValue;
  }
}

/**
 * Create a standardized error result object
 * @param {string} operation - Operation that failed
 * @param {string} filename - Name of the file that caused the error
 * @param {Error|string} error - Error object or message
 * @param {string} fileType - Type of file that failed
 * @returns {Object} Standardized error result
 */
function createErrorResult(operation, filename, error, fileType = null) {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorType = error instanceof Error ? categorizeError(error) : ErrorTypes.UNKNOWN_ERROR;
  
  return {
    success: false,
    operation,
    filename,
    fileType,
    error: errorMessage,
    errorType,
    timestamp: new Date()
  };
}

/**
 * Wrap a function with try-catch to ensure graceful failure
 * @param {Function} fn - Function to wrap
 * @returns {Function} Wrapped function that never throws
 */
function wrapWithTryCatch(fn) {
  return function(...args) {
    try {
      return fn(...args);
    } catch (error) {
      console.error(`Error in operation: ${error.message}`);
      return {
        success: false,
        error: error.message,
        errorType: categorizeError(error)
      };
    }
  };
}

/**
 * Wrap an async function with try-catch to ensure graceful failure
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped async function that never throws
 */
function wrapAsyncWithTryCatch(fn) {
  return async function(...args) {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`Error in async operation: ${error.message}`);
      return {
        success: false,
        error: error.message,
        errorType: categorizeError(error)
      };
    }
  };
}

module.exports = {
  ErrorTypes,
  categorizeError,
  safeExecute,
  safeExecuteAsync,
  createErrorResult,
  wrapWithTryCatch,
  wrapAsyncWithTryCatch
};