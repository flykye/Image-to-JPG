/**
 * HEIC/PNG 转 JPG 转换器
 */

const sharp = require('sharp');
const fs = require('fs');
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
 * 检查 sharp 是否支持 HEIC
 */
function isHeicSupported() {
  try {
    const input = sharp.format.heif?.input;
    // The prebuilt libvips can read AVIF/HEIF containers without a HEVC decoder.
    // Prefer its advertised extensions; older/custom builds still get a try.
    return (
      !!input?.buffer &&
      (!Array.isArray(input.fileSuffix) ||
        input.fileSuffix.some((suffix) => ['.heic', '.heif'].includes(suffix.toLowerCase())))
    );
  } catch {
    return false;
  }
}

/**
 * 使用内置 Wasm 解码原始像素，再由 sharp 原生编码一次 JPG
 */
async function convertHeicBuiltIn(inputPath, outputPath, options = {}) {
  const { quality = 90 } = options;

  const validation = validateInputFile(inputPath);
  if (!validation.valid) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: validation.error.message,
      method: 'builtin'
    };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: outputValidation.error.message,
      method: 'builtin'
    };
  }

  try {
    const inputBuffer = fs.readFileSync(inputPath);
    let density;
    try {
      const metadata = await sharp(inputBuffer).metadata();
      if (Number.isFinite(metadata.density) && metadata.density > 0) density = metadata.density;
    } catch {
      // Metadata support is independent from the Wasm pixel decoder.
    }
    // Load the WASM decoder only in a thread that actually processes HEIC.
    const heicDecode = require('heic-decode');
    const { width, height, data } = await heicDecode({ buffer: inputBuffer });
    const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    // libheif already applies HEIF rotation/mirroring, so copying the source
    // orientation would transform the pixels again. Preserve the fallback's
    // density-only metadata behaviour without claiming original EXIF/ICC fidelity.
    await sharp(pixels, { raw: { width, height, channels: 4 } })
      .removeAlpha()
      .withMetadata(density ? { density } : {})
      .jpeg({ quality })
      .toFile(outputPath);

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      return {
        success: false,
        inputPath,
        outputPath,
        error: result.error.message,
        method: 'builtin'
      };
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
    return {
      success: false,
      inputPath,
      outputPath,
      error: validation.error.message,
      method: 'imagemagick'
    };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: outputValidation.error.message,
      method: 'imagemagick'
    };
  }

  try {
    const { execFileSync } = require('child_process');
    const cmd = (await getImageMagickCommand()) || 'magick';
    execFileSync(cmd, [inputPath, '-quality', String(quality), outputPath], {
      timeout: 60000,
      windowsHide: true
    });

    const result = validateOutputFile(outputPath, validation.stats);
    if (!result.valid) {
      return {
        success: false,
        inputPath,
        outputPath,
        error: result.error.message,
        method: 'imagemagick'
      };
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
    return {
      success: false,
      inputPath,
      outputPath,
      error: validation.error.message,
      errorType: 'file_not_found'
    };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: outputValidation.error.message,
      errorType: 'conversion_error'
    };
  }

  // 1. 优先尝试 Sharp（最快的原生方案）
  if (isHeicSupported()) {
    try {
      await sharp(inputPath).withMetadata().jpeg({ quality }).toFile(outputPath);

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
      // A custom libvips build can still reject this particular HEIC.
    }
  }

  // 2. 降级到内置 Wasm 解码器
  const wasmResult = await convertHeicBuiltIn(inputPath, outputPath, options);
  if (wasmResult.success) return wasmResult;

  // 3. 最后尝试可选的外部解码器；保留不依赖系统安装的默认路径
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
    return {
      success: false,
      inputPath,
      outputPath,
      error: validation.error.message,
      errorType: 'file_not_found'
    };
  }

  const outputValidation = prepareOutputPath(outputPath);
  if (!outputValidation.valid) {
    return {
      success: false,
      inputPath,
      outputPath,
      error: outputValidation.error.message,
      errorType: 'conversion_error'
    };
  }

  try {
    await sharp(inputPath)
      .withMetadata()
      .flatten({ background: '#ffffff' })
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
