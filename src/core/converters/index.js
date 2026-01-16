const path = require('path');
const { ImageConverter } = require('./base');

/**
 * 转换器工厂
 */
class ConverterFactory {
  constructor() {
    this.converters = [];
  }

  register(converter) {
    this.converters.push(converter);
  }

  getConverter(filePath) {
    return this.converters.find(c => c.supports(filePath));
  }

  async convert(filePath, outputDir, options) {
    const converter = this.getConverter(filePath);
    if (!converter) {
      throw new Error(`No converter found for: ${filePath}`);
    }
    return await converter.convert(filePath, outputDir, options);
  }

  getSupportedExtensions() {
    return ['.heic', '.livp', '.png', '.jpg', '.jpeg'];
  }
}

const factory = new ConverterFactory();

// 注册转换器
const { HeicConverter, PngConverter } = require('./image-converters');
const { LivpConverter } = require('./livp-converter');
const { JpgConverter } = require('./jpg-converter');

factory.register(new HeicConverter());
factory.register(new PngConverter());
factory.register(new LivpConverter());
factory.register(new JpgConverter());

module.exports = {
  ImageConverter,
  ConverterFactory,
  factory
};
