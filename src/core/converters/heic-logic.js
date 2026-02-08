const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const heicConvert = require('heic-convert');
const {
  safeExecute,
  safeExecuteAsync,
  createErrorResult,
  ErrorTypes,
  wrapWithTryCatch,
  wrapAsyncWithTryCatch
} = require('../services/error-handler');

const execAsync = promisify(exec);

/**
 * HEIC转JPG转换器模块
 * 使用sharp库处理HEIC文件到JPG格式的转换
 */

/**
 * 检查当前sharp安装是否支持HEIC转换
 * @returns {boolean} 如果支持HEIC则返回true，否则返回false
 */
function isHeicSupported() {
  try {
    const formats = sharp.format;
    return formats.heif && formats.heif.input && formats.heif.input.buffer;
  } catch (error) {
    return false;
  }
}

/**
 * 检查是否可以使用ImageMagick进行HEIC转换
 * @returns {Promise<boolean>} 如果ImageMagick可用则返回true，否则返回false
 */
async function isImageMagickAvailable() {
  try {
    await execAsync('magick -version');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 使用内置的 heic-convert (Wasm) 将 HEIC 转换为 JPG
 * 不需要外部依赖，兼容性最好但速度稍慢
 * @param {string} inputPath - 输入路径
 * @param {string} outputPath - 输出路径
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 转换结果
 */
async function convertHeicToJpgBuiltIn(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;
  try {
    const inputBuffer = fs.readFileSync(inputPath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: quality / 100
    });

    // 尝试从原始HEIC文件读取元数据并应用到输出JPG
    try {
      const metadata = await sharp(inputBuffer).metadata();
      // 使用 sharp 处理输出 buffer，仅用于设置 DPI 信息，不再进行压缩
      const density = metadata.density || 72; // 如果无法读取则使用默认值
      await sharp(outputBuffer)
        .withMetadata({ density })  // 保留 DPI 信息
        .jpeg({ quality: 100 })     // 使用最高质量，避免二次压缩损失
        .toFile(outputPath);
    } catch (metadataError) {
      // 如果元数据处理失败，直接写入原始 buffer
      console.warn(`无法保留元数据: ${metadataError.message}，使用原始输出`);
      fs.writeFileSync(outputPath, outputBuffer);
    }

    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);

    return {
      success: true,
      inputPath,
      outputPath,
      inputSize: inputStats.size,
      outputSize: outputStats.size,
      compressionRatio: (1 - outputStats.size / inputStats.size) * 100,
      method: 'builtin'
    };
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `内置解码器处理失败: ${error.message}`,
      method: 'builtin'
    };
  }
}

/**
 * 使用ImageMagick作为备选方案将HEIC转换为JPG
 * @param {string} inputPath - 输入HEIC文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：90）
 * @returns {Promise<Object>} 转换结果
 */
async function convertHeicToJpgWithImageMagick(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  try {
    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file does not exist: ${inputPath}`);
    }

    // Check if input file is readable
    try {
      fs.accessSync(inputPath, fs.constants.R_OK);
    } catch (accessError) {
      throw new Error(`Cannot read input file: ${accessError.message}`);
    }

    // Get input file stats
    const fileStats = fs.statSync(inputPath);
    if (fileStats.size === 0) {
      throw new Error(`Input file is empty: ${inputPath}`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert using ImageMagick
    const command = `magick "${inputPath}" -quality ${quality} "${outputPath}"`;
    await execAsync(command);

    // Verify the output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Conversion completed but output file was not created');
    }

    // Get output file stats
    const outputStats = fs.statSync(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Conversion completed but output file is empty');
    }

    return {
      success: true,
      inputPath,
      outputPath,
      inputSize: fileStats.size,
      outputSize: outputStats.size,
      compressionRatio: (1 - outputStats.size / fileStats.size) * 100,
      method: 'imagemagick'
    };

  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: error.message,
      errorType: getErrorType(error),
      method: 'imagemagick'
    };
  }
}

/**
 * 将HEIC文件转换为JPG格式
 * @param {string} inputPath - 输入HEIC文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：90）
 * @returns {Promise<Object>} 包含成功状态和详细信息的转换结果
 */
async function convertHeicToJpg(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;
  const { forceType = null } = options;

  // Basic validation
  if (!fs.existsSync(inputPath)) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Input file does not exist: ${inputPath}`,
      errorType: 'file_not_found'
    };
  }

  const inputExt = path.extname(inputPath).toLowerCase();
  if (inputExt !== '.heic' && forceType !== 'heic') {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Input file is not a HEIC file: ${inputPath}`,
      errorType: 'invalid_format'
    };
  }

  let lastErrorResult = null;

  // 1. 优先尝试 ImageMagick (用户请求)
  const isImAvailable = await isImageMagickAvailable();
  if (isImAvailable) {
    console.warn('ImageMagick 可用，优先尝试使用 ImageMagick 转换 HEIC...');
    const imResult = await convertHeicToJpgWithImageMagick(inputPath, outputPath, options);
    if (imResult.success) {
      return imResult;
    }
    // Record error and fall through to the next method
    console.warn(`ImageMagick 转换失败: ${imResult.error}. 回退到其他转换器...`);
    lastErrorResult = imResult;
  }

  // 2. 尝试 Sharp
  if (isHeicSupported()) {
    try {
      // Check if input file is readable
      fs.accessSync(inputPath, fs.constants.R_OK);

      // Get file stats
      const fileStats = fs.statSync(inputPath);
      if (fileStats.size === 0) {
        throw new Error(`Input file is empty: ${inputPath}`);
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.accessSync(outputDir, fs.constants.W_OK);

      // Perform the conversion using Sharp
      await sharp(inputPath)
        .withMetadata()  // 保留原始图片的DPI和EXIF元数据
        .jpeg({ quality })
        .toFile(outputPath);

      // Verify the output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Conversion completed but output file was not created');
      }

      const outputStats = fs.statSync(outputPath);
      if (outputStats.size === 0) {
        throw new Error('Conversion completed but output file is empty');
      }

      return {
        success: true,
        inputPath,
        outputPath,
        inputSize: fileStats.size,
        outputSize: outputStats.size,
        compressionRatio: (1 - outputStats.size / fileStats.size) * 100,
        method: 'sharp'
      };

    } catch (sharpError) {
      // If Sharp fails for any reason, we continue to the next fallback.
      console.warn(`Sharp conversion failed: ${sharpError.message}. 尝试使用内置解码器...`);
      lastErrorResult = {
        success: false,
        inputPath,
        outputPath,
        error: `Sharp conversion failed: ${sharpError.message}`,
        errorType: getErrorType(sharpError),
        method: 'sharp'
      };
    }
  } else {
    console.warn('Sharp 不支持 HEIC，尝试使用内置解码器...');
  }

  // 3. 尝试内置解码器 (heic-convert)
  const builtinResult = await convertHeicToJpgBuiltIn(inputPath, outputPath, options);
  if (builtinResult.success) {
    return builtinResult;
  }
  lastErrorResult = builtinResult;

  // 4. 所有尝试都失败，返回最后一次失败的结果
  return lastErrorResult;
}

/**
 * 将HEIC文件转换为JPG，自动生成输出路径
 * @param {string} inputPath - 输入HEIC文件的路径
 * @param {string} outputDir - 保存JPG文件的目录（可选，默认为与输入文件相同的目录）
 * @param {Object} options - 转换选项
 * @returns {Promise<Object>} 转换结果
 */
async function convertHeicToJpgAuto(inputPath, outputDir = null, options = {}) {
  try {
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const targetDir = outputDir || inputDir;
    const outputPath = path.join(targetDir, `${inputName}.jpg`);

    return await convertHeicToJpg(inputPath, outputPath, options);
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath: null,
      error: error.message,
      errorType: 'conversion_error'
    };
  }
}

/**
 * 批量将多个HEIC文件转换为JPG
 * @param {string[]} inputPaths - HEIC文件路径数组
 * @param {string} outputDir - 保存JPG文件的目录（可选）
 * @param {Object} options - 转换选项
 * @param {Function} progressCallback - 可选的进度更新回调函数
 * @returns {Promise<Object>} 批量转换结果
 */
async function batchConvertHeicToJpg(inputPaths, outputDir = null, options = {}, progressCallback = null) {
  const results = [];
  const stats = {
    total: inputPaths.length,
    successful: 0,
    failed: 0,
    totalInputSize: 0,
    totalOutputSize: 0
  };

  for (let i = 0; i < inputPaths.length; i++) {
    const inputPath = inputPaths[i];

    if (progressCallback) {
      progressCallback({
        current: i + 1,
        total: inputPaths.length,
        currentFile: path.basename(inputPath)
      });
    }

    const result = await convertHeicToJpgAuto(inputPath, outputDir, options);
    results.push(result);

    if (result.success) {
      stats.successful++;
      stats.totalInputSize += result.inputSize;
      stats.totalOutputSize += result.outputSize;
    } else {
      stats.failed++;
    }
  }

  return {
    results,
    stats: {
      ...stats,
      compressionRatio: stats.totalInputSize > 0 ?
        (1 - stats.totalOutputSize / stats.totalInputSize) * 100 : 0
    }
  };
}

/**
 * 将PNG文件转换为JPG格式
 * @param {string} inputPath - 输入PNG文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：90）
 * @returns {Promise<Object>} 包含成功状态和详细信息的转换结果
 */
async function convertPngToJpg(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  // 基本验证
  if (!fs.existsSync(inputPath)) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Input file does not exist: ${inputPath}`,
      errorType: 'file_not_found'
    };
  }

  const inputExt = path.extname(inputPath).toLowerCase();
  if (inputExt !== '.png') {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Input file is not a PNG file: ${inputPath}`,
      errorType: 'invalid_format'
    };
  }

  try {
    // 检查输入文件是否可读
    fs.accessSync(inputPath, fs.constants.R_OK);

    // 获取文件统计信息
    const fileStats = fs.statSync(inputPath);
    if (fileStats.size === 0) {
      throw new Error(`Input file is empty: ${inputPath}`);
    }

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.accessSync(outputDir, fs.constants.W_OK);

    // 使用Sharp进行转换
    await sharp(inputPath)
      .withMetadata()  // 保留原始图片的DPI和EXIF元数据
      .jpeg({ quality })
      .toFile(outputPath);

    // 验证输出文件已创建
    if (!fs.existsSync(outputPath)) {
      throw new Error('Conversion completed but output file was not created');
    }

    const outputStats = fs.statSync(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Conversion completed but output file is empty');
    }

    return {
      success: true,
      inputPath,
      outputPath,
      inputSize: fileStats.size,
      outputSize: outputStats.size,
      compressionRatio: (1 - outputStats.size / fileStats.size) * 100,
      method: 'sharp'
    };

  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `PNG conversion failed: ${error.message}`,
      errorType: getErrorType(error),
      method: 'sharp'
    };
  }
}

/**
 * 将PNG文件转换为JPG，自动生成输出路径
 * @param {string} inputPath - 输入PNG文件的路径
 * @param {string} outputDir - 保存JPG文件的目录（可选，默认为与输入文件相同的目录）
 * @param {Object} options - 转换选项
 * @returns {Promise<Object>} 转换结果
 */
async function convertPngToJpgAuto(inputPath, outputDir = null, options = {}) {
  try {
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const targetDir = outputDir || inputDir;
    const outputPath = path.join(targetDir, `${inputName}.jpg`);

    return await convertPngToJpg(inputPath, outputPath, options);
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath: null,
      error: error.message,
      errorType: 'conversion_error'
    };
  }
}

/**
 * 确定转换过程中发生的错误类型
 * @param {Error} error - 错误对象
 * @returns {string} 错误类型分类
 */
function getErrorType(error) {
  const message = error.message.toLowerCase();

  if (message.includes('does not exist') || message.includes('no such file')) {
    return 'file_not_found';
  } else if (message.includes('empty')) {
    return 'empty_file';
  } else if (message.includes('not a heic file') || message.includes('invalid format')) {
    return 'invalid_format';
  } else if (message.includes('not supported') || message.includes('unsupported')) {
    return 'unsupported_format';
  } else if (message.includes('corrupted') || message.includes('invalid image')) {
    return 'corrupted_file';
  } else if (message.includes('permission') || message.includes('access')) {
    return 'permission_error';
  } else if (message.includes('space') || message.includes('disk full')) {
    return 'disk_space_error';
  } else {
    return 'conversion_error';
  }
}

module.exports = {
  convertHeicToJpg,
  convertHeicToJpgAuto,
  convertPngToJpg,
  convertPngToJpgAuto,
  batchConvertHeicToJpg,
  isHeicSupported,
  isImageMagickAvailable,
  convertHeicToJpgWithImageMagick,
  getErrorType
};
