/**
 * TIFF 转 JPG 转换器
 */

const sharp = require('sharp');
const path = require('path');
const { categorizeError } = require('../services/error-handler');
const {
  validateInputFile,
  prepareOutputPath,
  validateOutputFile
} = require('../services/conversion-helpers');

/**
 * 将 TIFF 文件转换为 JPG
 */
async function convertTiffToJpg(inputPath, outputPath, options = {}) {
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
      error: `TIFF conversion failed: ${error.message}`,
      errorType: categorizeError(error),
      method: 'sharp'
    };
  }
}

/**
 * 将 TIFF 文件转换为 JPG，自动生成输出路径
 */
async function convertTiffToJpgAuto(inputPath, outputDir = null, options = {}) {
  const inputDir = path.dirname(inputPath);
  const inputName = path.basename(inputPath, path.extname(inputPath));
  const targetDir = outputDir || inputDir;
  const outputPath = path.join(targetDir, `${inputName}.jpg`);

  return await convertTiffToJpg(inputPath, outputPath, options);
}

module.exports = {
  convertTiffToJpg,
  convertTiffToJpgAuto
};
