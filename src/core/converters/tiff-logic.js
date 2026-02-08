const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * TIFF转JPG转换器模块
 * 使用sharp库处理TIFF文件到JPG格式的转换
 */

/**
 * 将TIFF文件转换为JPG格式
 * @param {string} inputPath - 输入TIFF文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：95）
 * @param {string|null} options.forceType - 强制类型（用于扩展名与真实类型不一致）
 * @returns {Promise<Object>} 转换结果
 */
async function convertTiffToJpg(inputPath, outputPath, options = {}) {
  const { quality = 95, forceType = null } = options;

  try {
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
    if (inputExt !== '.tif' && inputExt !== '.tiff' && forceType !== 'tiff') {
      return {
        success: false,
        inputPath,
        outputPath,
        error: `Input file is not a TIFF file: ${inputPath}`,
        errorType: 'invalid_format'
      };
    }

    fs.accessSync(inputPath, fs.constants.R_OK);
    const fileStats = fs.statSync(inputPath);
    if (fileStats.size === 0) {
      return {
        success: false,
        inputPath,
        outputPath,
        error: `Input file is empty: ${inputPath}`,
        errorType: 'empty_file'
      };
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.accessSync(outputDir, fs.constants.W_OK);

    await sharp(inputPath)
      .withMetadata()
      .jpeg({ quality })
      .toFile(outputPath);

    if (!fs.existsSync(outputPath)) {
      return {
        success: false,
        inputPath,
        outputPath,
        error: 'Conversion completed but output file was not created',
        errorType: 'conversion_error'
      };
    }

    const outputStats = fs.statSync(outputPath);
    if (outputStats.size === 0) {
      return {
        success: false,
        inputPath,
        outputPath,
        error: 'Conversion completed but output file is empty',
        errorType: 'conversion_error'
      };
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
      error: `TIFF conversion failed: ${error.message}`,
      errorType: 'conversion_error',
      method: 'sharp'
    };
  }
}

/**
 * 将TIFF文件转换为JPG，自动生成输出路径
 * @param {string} inputPath - 输入TIFF文件的路径
 * @param {string} outputDir - 保存JPG文件的目录（可选，默认为与输入文件相同的目录）
 * @param {Object} options - 转换选项
 * @returns {Promise<Object>} 转换结果
 */
async function convertTiffToJpgAuto(inputPath, outputDir = null, options = {}) {
  try {
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const targetDir = outputDir || inputDir;
    const outputPath = path.join(targetDir, `${inputName}.jpg`);

    return await convertTiffToJpg(inputPath, outputPath, options);
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

module.exports = {
  convertTiffToJpg,
  convertTiffToJpgAuto
};
