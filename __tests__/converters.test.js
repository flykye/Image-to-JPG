describe('ConverterFactory', () => {
  let factory;

  beforeEach(() => {
    // Create a fresh factory for each test
    jest.resetModules();
    const { ConverterFactory, factory: existingFactory } = require('../src/core/converters/index');

    // Create new factory instance for isolated tests
    class TestFactory extends ConverterFactory {
      constructor() {
        super();
        this.converters = [];
      }
    }
    factory = new TestFactory();
  });

  describe('register and getConverterByType', () => {
    it('finds converter by type', () => {
      const mockConverter = { type: 'heic', supports: () => true, convert: jest.fn() };
      factory.register(mockConverter);
      expect(factory.getConverterByType('heic')).toBe(mockConverter);
    });

    it('returns undefined for unregistered type', () => {
      expect(factory.getConverterByType('nonexistent')).toBeUndefined();
    });

    it('resolves type alias: zip -> livp', () => {
      // The factory's getConverterByType should resolve zip to livp via TYPE_ALIAS_MAP
      // We need to test with the actual factory
      const { factory: actualFactory } = require('../src/core/converters/index');
      const livpConverter = actualFactory.getConverterByType('livp');
      expect(livpConverter).toBeDefined();
      expect(livpConverter.type).toBe('livp');

      // zip type should resolve to livp converter
      const zipConverter = actualFactory.getConverterByType('zip');
      expect(zipConverter).toBeDefined();
      expect(zipConverter.type).toBe('livp');
    });
  });

  describe('getConverter', () => {
    it('finds converter by file path extension', () => {
      const heicConverter = { type: 'heic', supports: (p) => p.endsWith('.heic'), convert: jest.fn() };
      factory.register(heicConverter);
      expect(factory.getConverter('/path/to/photo.heic')).toBe(heicConverter);
      expect(factory.getConverter('/path/to/photo.jpg')).toBeUndefined();
    });
  });

  describe('getSupportedExtensions', () => {
    it('returns array of supported extensions', () => {
      const extensions = factory.getSupportedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
    });

    it('includes all format extensions via actual factory', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const extensions = actualFactory.getSupportedExtensions();
      expect(extensions).toContain('.heic');
      expect(extensions).toContain('.png');
      expect(extensions).toContain('.dng');
      expect(extensions).toContain('.jpg');
      expect(extensions).toContain('.jpeg');
      expect(extensions).toContain('.tif');
      expect(extensions).toContain('.tiff');
      expect(extensions).toContain('.livp');
    });
  });

  describe('actual factory - all converters registered', () => {
    it('has a converter for every supported format type', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const types = ['heic', 'png', 'dng', 'tiff', 'livp', 'jpg'];
      for (const type of types) {
        expect(actualFactory.getConverterByType(type)).toBeDefined();
      }
    });

    it('HEIC converter supports .heic files', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const converter = actualFactory.getConverterByType('heic');
      expect(converter.supports('/photo.HEIC')).toBe(true);
      expect(converter.supports('/photo.heic')).toBe(true);
    });

    it('PNG converter supports .png files', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const converter = actualFactory.getConverterByType('png');
      expect(converter.supports('/photo.PNG')).toBe(true);
      expect(converter.supports('/photo.png')).toBe(true);
    });

    it('LIVP converter supports .livp files', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const converter = actualFactory.getConverterByType('livp');
      expect(converter.supports('/photo.LIVP')).toBe(true);
      expect(converter.supports('/photo.livp')).toBe(true);
    });

    it('JPG converter supports .jpg and .jpeg files', () => {
      const { factory: actualFactory } = require('../src/core/converters/index');
      const converter = actualFactory.getConverterByType('jpg');
      expect(converter.supports('/photo.jpg')).toBe(true);
      expect(converter.supports('/photo.jpeg')).toBe(true);
    });
  });
});
