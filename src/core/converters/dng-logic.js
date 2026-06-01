/**
 * DNG 转 JPG 转换器
 */

const sharp = require('sharp');
const path = require('path');
const {
  validateInputFile,
  prepareOutputPath,
  validateOutputFile,
  getImageMagickCommand,
  isImageMagickAvailable
} = require('../services/conversion-helpers');
const { categorizeError } = require('../services/error-handler');

/**
 * 检查 sharp 是否支持 DNG
 */
function isDngSupported() {
  try {
    const formats = sharp.format;
    return !!(formats.raw && formats.raw.input);
  } catch {
    return false;
  }
}

/**
 * 使用 Sharp 将 DNG 转换为 JPG
 */
async function convertDngWithSharp(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, method: 'sharp' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, method: 'sharp' };
  }

  try {
    await sharp(inputPath)
      .withMetadata()
      .jpeg({ quality })
      .toFile(outputPath);

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      throw new Error(result.error.message);
    }

    return {
      success: true,
      inputPath,
      outputPath,
      ...result.stats,
      method: 'sharp'
    };
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Sharp conversion failed: ${error.message}`,
      errorType: categorizeError(error),
      method: 'sharp'
    };
  }
}

/**
 * 使用 ImageMagick 将 DNG 转换为 JPG
 */
async function convertDngWithImageMagick(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, method: 'imagemagick' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, method: 'imagemagick' };
  }

  try {
    const { execFileSync } = require('child_process');
    const cmd = await getImageMagickCommand() || 'magick';
    execFileSync(cmd, [inputPath, '-quality', String(quality), outputPath], { timeout: 120000 });

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      throw new Error(result.error.message);
    }

    return {
      success: true,
      inputPath,
      outputPath,
      ...result.stats,
      method: 'imagemagick'
    };
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: categorizeError(error),
      method: 'imagemagick'
    };
  }
}

/**
 * 将 DNG 文件转换为 JPG
 */
async function convertDngToJpg(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, errorType: 'file_not_found' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, errorType: 'conversion_error' };
  }

  // 1. 优先尝试 Sharp
  const sharpResult = await convertDngWithSharp(inputPath, outputPath, options);
  if (sharpResult.success) return sharpResult;

  // 2. 降级到 ImageMagick
  const imAvailable = await isImageMagickAvailable();
  if (imAvailable) {
    const imResult = await convertDngWithImageMagick(inputPath, outputPath, options);
    if (imResult.success) return imResult;
    // ImageMagick 失败，返回更友好的错误信息
    return imResult;
  }

  return sharpResult;
}

/**
 * 将 DNG 文件转换为 JPG，自动生成输出路径
 */
async function convertDngToJpgAuto(inputPath, outputDir = null, options = {}) {
  const inputDir = path.dirname(inputPath);
  const inputName = path.basename(inputPath, path.extname(inputPath));
  const targetDir = outputDir || inputDir;
  const outputPath = path.join(targetDir, `${inputName}.jpg`);

  return await convertDngToJpg(inputPath, outputPath, options);
}

module.exports = {
  convertDngToJpg,
  convertDngToJpgAuto,
  isDngSupported,
  isImageMagickAvailable
};
