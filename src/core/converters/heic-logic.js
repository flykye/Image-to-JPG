/**
 * HEIC/PNG 转 JPG 转换器
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const heicConvert = require('heic-convert');
const { wrapAsyncWithTryCatch } = require('../services/error-handler');
const {
  validateInputFile,
  prepareOutputPath,
  validateOutputFile,
  getImageMagickCommand,
  isImageMagickAvailable
} = require('../services/conversion-helpers');
const { categorizeError } = require('../services/error-handler');

/**
 * 检查 sharp 是否支持 HEIC
 */
function isHeicSupported() {
  try {
    const formats = sharp.format;
    return !!(formats.heif && formats.heif.input && formats.heif.input.buffer);
  } catch {
    return false;
  }
}

/**
 * 使用内置 heic-convert (Wasm) 将 HEIC 转换为 JPG
 */
async function convertHeicBuiltIn(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, method: 'builtin' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, method: 'builtin' };
  }

  try {
    const inputBuffer = fs.readFileSync(inputPath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: quality / 100
    });

    try {
      const metadata = await sharp(inputBuffer).metadata();
      const density = metadata.density || 72;
      await sharp(outputBuffer)
        .withMetadata({ density })
        .jpeg({ quality: 100 })
        .toFile(outputPath);
    } catch {
      fs.writeFileSync(outputPath, outputBuffer);
    }

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      return { success: false, inputPath, outputPath, error: result.error.message, method: 'builtin' };
    }

    return {
      success: true,
      inputPath,
      outputPath,
      ...result.stats,
      method: 'builtin'
    };
  } catch (error) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: `Built-in decoder failed: ${error.message}`,
      method: 'builtin'
    };
  }
}

/**
 * 使用 ImageMagick 将 HEIC 转换为 JPG
 */
async function convertHeicWithImageMagick(inputPath, outputPath, options = {}) {
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
    execFileSync(cmd, [inputPath, '-quality', String(quality), outputPath], { timeout: 60000 });

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      return { success: false, inputPath, outputPath, error: result.error.message, method: 'imagemagick' };
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
 * 将 HEIC 文件转换为 JPG
 */
async function convertHeicToJpg(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, errorType: 'file_not_found' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, errorType: 'conversion_error' };
  }

  // 1. 优先尝试 Sharp（最快的原生方案）
  if (isHeicSupported()) {
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
      // fall through to Wasm
    }
  }

  // 2. 降级到内置 Wasm 解码器
  const wasmResult = await convertHeicBuiltIn(inputPath, outputPath, options);
  if (wasmResult.success) return wasmResult;

  // 3. 最后降级到 ImageMagick（外部工具，速度最慢）
  const imAvailable = await isImageMagickAvailable();
  if (imAvailable) {
    const imResult = await convertHeicWithImageMagick(inputPath, outputPath, options);
    if (imResult.success) return imResult;
    // ImageMagick 也失败了，返回 Wasm 的结果（更友好的错误信息）
    return imResult;
  }

  return wasmResult;
}

/**
 * 将 HEIC 文件转换为 JPG，自动生成输出路径
 */
async function convertHeicToJpgAuto(inputPath, outputDir = null, options = {}) {
  const inputDir = path.dirname(inputPath);
  const inputName = path.basename(inputPath, path.extname(inputPath));
  const targetDir = outputDir || inputDir;
  const outputPath = path.join(targetDir, `${inputName}.jpg`);

  return await convertHeicToJpg(inputPath, outputPath, options);
}

/**
 * 将 PNG 文件转换为 JPG
 */
async function convertPngToJpg(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return { success: false, inputPath, outputPath, error: validation.error.message, errorType: 'file_not_found' };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return { success: false, inputPath, outputPath, error: outputValidation.error.message, errorType: 'conversion_error' };
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
      error: `PNG conversion failed: ${error.message}`,
      errorType: categorizeError(error),
      method: 'sharp'
    };
  }
}

/**
 * 将 PNG 文件转换为 JPG，自动生成输出路径
 */
async function convertPngToJpgAuto(inputPath, outputDir = null, options = {}) {
  const inputDir = path.dirname(inputPath);
  const inputName = path.basename(inputPath, path.extname(inputPath));
  const targetDir = outputDir || inputDir;
  const outputPath = path.join(targetDir, `${inputName}.jpg`);

  return await convertPngToJpg(inputPath, outputPath, options);
}

module.exports = {
  convertHeicToJpg,
  convertHeicToJpgAuto,
  convertPngToJpg,
  convertPngToJpgAuto,
  isHeicSupported,
  isImageMagickAvailable
};
