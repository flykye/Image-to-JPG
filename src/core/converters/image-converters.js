const { ImageConverter } = require('./base');
const path = require('path');

class HeicConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.heic');
  }

  get type() { return 'heic'; }

  async convert(filePath, outputDir, options) {
    const { convertHeicToJpgAuto } = require('./heic-logic'); // I will move the logic to a separate file
    return await convertHeicToJpgAuto(filePath, outputDir, options);
  }
}

class PngConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.png');
  }

  get type() { return 'png'; }

  async convert(filePath, outputDir, options) {
    const { convertPngToJpgAuto } = require('./heic-logic');
    return await convertPngToJpgAuto(filePath, outputDir, options);
  }
}

module.exports = { HeicConverter, PngConverter };
