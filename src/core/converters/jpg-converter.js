const { ImageConverter } = require('./base');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class JpgConverter extends ImageConverter {
  supports(filePath) {
    const ext = filePath.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg');
  }

  get type() { return 'jpg'; }

  async convert(filePath, outputDir, options) {
    const filename = path.basename(filePath);
    const targetPath = path.join(outputDir, filename);

    if (options.compressJpg) {
      const stats = fs.statSync(filePath);
      await sharp(filePath)
        .withMetadata()  // 保留原始图片的DPI和EXIF元数据
        .jpeg({ quality: options.quality || 95 })
        .toFile(targetPath);

      const outputStats = fs.statSync(targetPath);

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
      const { copyToJpgDirectory } = require('../services/file-manager');
      const copyResult = copyToJpgDirectory(filePath, filename, outputDir);

      // 如果复制失败，返回失败结果
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
        outputPath: copyResult.targetPath,  // 映射targetPath到outputPath
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
