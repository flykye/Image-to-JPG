const os = require('os');
const path = require('path');
const fs = require('fs');

describe('conversion-helpers', () => {
  let tmpDir;
  let tmpFile;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv_helper_test_'));
    tmpFile = path.join(tmpDir, 'test.heic');
    fs.writeFileSync(tmpFile, Buffer.from([0x00, 0x00, 0x00, 0x00]));
  });

  afterEach(() => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tmpDir, file));
        }
        fs.rmdirSync(tmpDir);
      }
    } catch {}
  });

  describe('validateInputFile', () => {
    it('returns valid for existing readable file', () => {
      const { validateInputFile } = require('../src/core/services/conversion-helpers');
      const result = validateInputFile(tmpFile);
      expect(result.valid).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.size).toBeGreaterThan(0);
    });

    it('returns invalid for non-existent file', () => {
      const { validateInputFile } = require('../src/core/services/conversion-helpers');
      const result = validateInputFile('/nonexistent/file.heic');
      expect(result.valid).toBe(false);
      expect(result.error.type).toBe('file_not_found');
    });

    it('returns invalid for empty file', () => {
      const emptyFile = path.join(tmpDir, 'empty.heic');
      fs.writeFileSync(emptyFile, Buffer.alloc(0));
      const { validateInputFile } = require('../src/core/services/conversion-helpers');
      const result = validateInputFile(emptyFile);
      expect(result.valid).toBe(false);
      expect(result.error.type).toBe('empty_file');
    });
  });

  describe('prepareOutputPath', () => {
    it('returns valid for existing writable directory', () => {
      const { prepareOutputPath } = require('../src/core/services/conversion-helpers');
      const result = prepareOutputPath(path.join(tmpDir, 'output.jpg'));
      expect(result.valid).toBe(true);
    });

    it('creates non-existent output directory recursively', () => {
      const nested = path.join(tmpDir, 'nested', 'deep', 'output.jpg');
      const { prepareOutputPath } = require('../src/core/services/conversion-helpers');
      const result = prepareOutputPath(nested);
      expect(result.valid).toBe(true);
      expect(fs.existsSync(path.dirname(nested))).toBe(true);
    });
  });

  describe('validateOutputFile', () => {
    it('returns invalid for non-existent output', () => {
      const { validateOutputFile } = require('../src/core/services/conversion-helpers');
      const result = validateOutputFile(path.join(tmpDir, 'nonexistent.jpg'), { size: 100 });
      expect(result.valid).toBe(false);
    });

    it('returns valid for existing output with matching size', () => {
      fs.writeFileSync(path.join(tmpDir, 'output.jpg'), Buffer.from([0xFF, 0xD8, 0xFF]));
      const { validateOutputFile } = require('../src/core/services/conversion-helpers');
      const result = validateOutputFile(path.join(tmpDir, 'output.jpg'), { size: 100 });
      expect(result.valid).toBe(true);
      expect(result.stats.outputSize).toBe(3);
      expect(result.stats.inputSize).toBe(100);
      expect(typeof result.stats.compressionRatio).toBe('number');
    });

    it('returns invalid for empty output file', () => {
      fs.writeFileSync(path.join(tmpDir, 'empty.jpg'), Buffer.alloc(0));
      const { validateOutputFile } = require('../src/core/services/conversion-helpers');
      const result = validateOutputFile(path.join(tmpDir, 'empty.jpg'), { size: 100 });
      expect(result.valid).toBe(false);
    });
  });

  describe('isImageMagickAvailable', () => {
    it('is a function', () => {
      const { isImageMagickAvailable } = require('../src/core/services/conversion-helpers');
      expect(typeof isImageMagickAvailable).toBe('function');
    });

    it('returns a promise', () => {
      const { isImageMagickAvailable } = require('../src/core/services/conversion-helpers');
      const result = isImageMagickAvailable();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('categorizeError - NOT exported anymore', () => {
    it('categorizeError is not in the exports', () => {
      const helpers = require('../src/core/services/conversion-helpers');
      expect(helpers.categorizeError).toBeUndefined();
    });

    it('categorizeError is available from error-handler', () => {
      const { categorizeError } = require('../src/core/services/error-handler');
      expect(typeof categorizeError).toBe('function');
    });
  });
});
