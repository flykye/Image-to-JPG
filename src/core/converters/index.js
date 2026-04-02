const { ImageConverter } = require('./base');

// 类型别名映射：文件签名检测到的类型 -> 实际转换器类型（必须在 ConverterFactory 之前定义）
const TYPE_ALIAS_MAP = {
  zip: 'livp'  // ZIP 文件头（LIVP）映射到 livp 转换器
};

class ConverterFactory {
  constructor() {
    this.converters = [];
  }

  register(converter) {
    this.converters.push(converter);
  }

  getConverterByType(type) {
    // 先直接查找，找不到则通过类型别名映射查找
    const resolved = TYPE_ALIAS_MAP[type] || type;
    return this.converters.find(c => c.type === resolved);
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

  async convertByType(filePath, type, outputDir, options) {
    const converter = this.getConverterByType(type);
    if (!converter) {
      throw new Error(`No converter found for type: ${type}`);
    }
    return await converter.convert(filePath, outputDir, options);
  }

  getSupportedExtensions() {
    const extMap = {
      heic: '.heic',
      livp: '.livp',
      png: '.png',
      dng: '.dng',
      tiff: '.tif',
      jpg: '.jpg'
    };
    const exts = new Set();
    for (const converter of this.converters) {
      const ext = extMap[converter.type];
      if (ext) exts.add(ext);
      if (converter.type === 'tiff') exts.add('.tiff');
      if (converter.type === 'jpg') exts.add('.jpeg');
    }
    return Array.from(exts);
  }
}

const factory = new ConverterFactory();

const { HeicConverter, PngConverter, DngConverter, TiffConverter } = require('./image-converters');
const { LivpConverter } = require('./livp-converter');
const { JpgConverter } = require('./jpg-converter');

factory.register(new HeicConverter());
factory.register(new PngConverter());
factory.register(new DngConverter());
factory.register(new TiffConverter());
factory.register(new LivpConverter());
factory.register(new JpgConverter());

module.exports = {
  ImageConverter,
  ConverterFactory,
  factory
};
