const { ImageConverter } = require('./base');
const { extractImageFromLivp } = require('./livp-logic');

class LivpConverter extends ImageConverter {
  supports(filePath) {
    return filePath.toLowerCase().endsWith('.livp');
  }

  get type() { return 'livp'; }

  async convert(filePath, outputDir, options) {
    return await extractImageFromLivp(filePath, outputDir, options);
  }
}

module.exports = { LivpConverter };
