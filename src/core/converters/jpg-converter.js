const { ImageConverter } = require('./base');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { copyToJpgDirectory } = require('../services/file-manager');

class JpgConverter extends ImageConverter {
  supports(filePath) {
    const ext = filePath.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg');
  }

  get type() { return 'jpg'; }

  async convert(filePath, outputDir, options) {
    const originalFilename = path.basename(filePath);
    const ext = path.extname(originalFilename).toLowerCase();
    const filename = (ext !== '.jpg' && ext !== '.jpeg')
      ? `${path.basename(filePath, ext)}.jpg`
      : originalFilename;
    const targetPath = path.join(outputDir, filename);

    if (options.compressJpg) {
      const stats = await fsPromises.stat(filePath);
      await sharp(filePath)
        .withMetadata()
        .jpeg({ quality: options.quality || 90 })
        .toFile(targetPath);

      const outputStats = await fsPromises.stat(targetPath);

      return {
        success: true,
        filename,
        outputPath: targetPath,
        type: 'jpg',
        details: {
          converted: true,
          originalFormat: 'jpg',
          compressionRatio: (1 - outputStats.size / stats.size) * 100,
          inputSize: stats.size,
          outputSize: outputStats.size
        }
      };
    } else {
      const copyResult = copyToJpgDirectory(filePath, filename, outputDir);

      if (!copyResult.success) {
        return {
          success: false,
          error: copyResult.error,
          type: 'jpg'
        };
      }

      return {
        success: true,
        filename,
        outputPath: copyResult.targetPath,
        type: 'jpg',
        details: {
          converted: false,
          originalFormat: 'jpg'
        }
      };
    }
  }
}

module.exports = { JpgConverter };
