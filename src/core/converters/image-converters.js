const { ImageConverter } = require('./base');
const path = require('path');
const { convertHeicToJpgAuto, convertPngToJpgAuto } = require('./heic-logic');
const { convertDngToJpgAuto } = require('./dng-logic');
const { convertTiffToJpgAuto } = require('./tiff-logic');

class HeicConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.heic');
  }

  get type() { return 'heic'; }

  async convert(filePath, outputDir, options) {
    return await convertHeicToJpgAuto(filePath, outputDir, options);
  }
}

class PngConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.png');
  }

  get type() { return 'png'; }

  async convert(filePath, outputDir, options) {
    return await convertPngToJpgAuto(filePath, outputDir, options);
  }
}

class DngConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.dng');
  }

  get type() { return 'dng'; }

  async convert(filePath, outputDir, options) {
    return await convertDngToJpgAuto(filePath, outputDir, options);
  }
}

class TiffConverter extends ImageConverter {
  supports(filePath) {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.tif') || lower.endsWith('.tiff');
  }

  get type() { return 'tiff'; }

  async convert(filePath, outputDir, options) {
    return await convertTiffToJpgAuto(filePath, outputDir, options);
  }
}

module.exports = { HeicConverter, PngConverter, DngConverter, TiffConverter };
