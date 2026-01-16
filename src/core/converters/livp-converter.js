const { ImageConverter } = require('./base');
const path = require('path');

class LivpConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.livp');
  }

  get type() { return 'livp'; }

  async convert(filePath, outputDir, options) {
    const { extractImageFromLivp } = require('./livp-logic');
    return await extractImageFromLivp(filePath, outputDir, options);
  }
}

module.exports = { LivpConverter };
