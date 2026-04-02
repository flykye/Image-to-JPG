/**
 * LIVP 文件提取和转换
 */

const AdmZip = require('adm-zip');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { convertHeicToJpg } = require('./heic-logic');
const { createErrorResult } = require('../services/error-handler');
const {
  validateInputFile,
  prepareOutputPath,
  validateOutputFile
} = require('../services/conversion-helpers');

/**
 * 从 LIVP 文件中提取图像并转换为 JPG
 */
async function extractImageFromLivp(livpFilePath, outputDir, options = {}) {
  const validation = validateInputFile(livpFilePath);
  if (!validation.valid) {
    return createErrorResult('extraction', path.basename(livpFilePath), validation.error.message, 'livp');
  }

  const outputValidation = prepareOutputPath(outputDir);
  if (!outputValidation.valid) {
    return createErrorResult('directory_creation', outputDir, outputValidation.error.message, 'livp');
  }

  let zip;
  try {
    zip = new AdmZip(livpFilePath);
  } catch (error) {
    if (error.message.includes('invalid signature') || error.message.includes('not a zip')) {
      return createErrorResult('extraction', path.basename(livpFilePath), 'File is not a valid LIVP archive', 'livp');
    }
    return createErrorResult('extraction', path.basename(livpFilePath), `Invalid LIVP archive: ${error.message}`, 'livp');
  }

  let entries;
  try {
    entries = zip.getEntries();
    if (!entries || entries.length === 0) {
      return createErrorResult('extraction', path.basename(livpFilePath), 'LIVP archive is empty', 'livp');
    }
  } catch (error) {
    return createErrorResult('extraction', path.basename(livpFilePath), `Cannot read archive contents: ${error.message}`, 'livp');
  }

  const imageEntry = entries.find((entry) => {
    const name = entry.entryName.toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.jpeg') || name.endsWith('.jpg');
  });

  if (!imageEntry) {
    return createErrorResult('extraction', path.basename(livpFilePath), 'No image file found in archive', 'livp');
  }

  let imageData;
  try {
    imageData = imageEntry.getData();
    if (!imageData || imageData.length === 0) {
      return createErrorResult('extraction', path.basename(livpFilePath), 'Extracted image data is empty', 'livp');
    }
  } catch (error) {
    return createErrorResult('extraction', path.basename(livpFilePath), `Failed to extract image data: ${error.message}`, 'livp');
  }

  const originalExt = path.extname(imageEntry.entryName).toLowerCase();
  const baseName = path.basename(livpFilePath, '.livp');

  if (originalExt === '.heic') {
    const tempHeicPath = path.join(outputDir, `temp_${baseName}.heic`);
    let conversionResult;

    try {
      fs.writeFileSync(tempHeicPath, imageData);
      const outputFilePath = path.join(outputDir, `${baseName}.jpg`);
      conversionResult = await convertHeicToJpg(tempHeicPath, outputFilePath, options);
    } catch (error) {
      return createErrorResult('conversion', path.basename(livpFilePath), `Failed to process HEIC image: ${error.message}`, 'livp');
    } finally {
      try {
        if (fs.existsSync(tempHeicPath)) {
          fs.unlinkSync(tempHeicPath);
        }
      } catch {
        // cleanup failure is non-critical
      }
    }

    if (conversionResult.success) {
      return {
        success: true,
        ...conversionResult,
        converted: true,
        originalFormat: 'heic'
      };
    } else {
      return createErrorResult('conversion', path.basename(livpFilePath), conversionResult.error || 'HEIC conversion failed', 'livp');
    }
  } else {
    // JPEG/JPG file
    const { quality = 90, compressJpg = false } = options;
    const outputFilePath = path.join(outputDir, `${baseName}.jpg`);
    const inputSize = imageData.length;

    try {
      if (compressJpg) {
        const outputBuffer = await sharp(imageData)
          .jpeg({ quality })
          .toBuffer();
        fs.writeFileSync(outputFilePath, outputBuffer);
      } else {
        fs.writeFileSync(outputFilePath, imageData);
      }

      const result = validateOutputFile(outputFilePath, { size: inputSize });
      if (!result.valid) {
        return createErrorResult('extraction', path.basename(livpFilePath), result.error.message, 'livp');
      }

      return {
        success: true,
        outputPath: outputFilePath,
        outputFileName: `${baseName}.jpg`,
        converted: compressJpg,
        originalFormat: originalExt.substring(1),
        ...result.stats
      };
    } catch (error) {
      return createErrorResult('extraction', path.basename(livpFilePath), `Failed to save image: ${error.message}`, 'livp');
    }
  }
}

module.exports = {
  extractImageFromLivp
};
