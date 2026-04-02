const os = require('os');
const path = require('path');
const fs = require('fs');

describe('file-signature', () => {
  it('exports detectFileType function', () => {
    const { detectFileType } = require('../src/core/services/file-signature');
    expect(typeof detectFileType).toBe('function');
  });
});

describe('file-signature detectHeaderType with real files', () => {
  let tmpDir;
  let testFilePath;

  const writeBytes = (filePath, bytes) => {
    fs.writeFileSync(filePath, Buffer.from(bytes));
  };

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig_test_'));
    testFilePath = path.join(tmpDir, 'test.tmp');
  });

  afterEach(() => {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch {}
  });

  it('detects JPEG magic bytes FF D8 FF', () => {
    writeBytes(testFilePath, [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('jpg');
    expect(result.type).toBe('jpg');
  });

  it('detects PNG magic bytes', () => {
    writeBytes(testFilePath, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('png');
    expect(result.type).toBe('png');
  });

  it('detects HEIC via ftyp heic brand', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(16, 0);
    buf.write('ftyp', 4);
    buf.write('heic', 8);
    fs.writeFileSync(testFilePath, buf);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('heic');
    expect(result.type).toBe('heic');
  });

  it('detects HEIX brand as heic', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(16, 0);
    buf.write('ftyp', 4);
    buf.write('heix', 8);
    fs.writeFileSync(testFilePath, buf);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('heic');
  });

  it('detects ZIP (LIVP) magic bytes 50 4B 03 04', () => {
    writeBytes(testFilePath, [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('zip');
  });

  it('maps livp extension with zip header to livp type', () => {
    writeBytes(testFilePath, [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const livpPath = testFilePath.replace('.tmp', '.livp');
    fs.writeFileSync(livpPath, fs.readFileSync(testFilePath));
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(livpPath);
    expect(result.type).toBe('livp');
    // headerType is the raw detected header ('zip'), type is the resolved type ('livp')
    expect(result.headerType).toBe('zip');
    fs.unlinkSync(livpPath);
  });

  it('detects TIFF little-endian (II 2A 00)', () => {
    writeBytes(testFilePath, [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('tiff');
    expect(result.type).toBe('tiff');
  });

  it('detects TIFF big-endian (MM 00 2A)', () => {
    writeBytes(testFilePath, [0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBe('tiff');
    expect(result.type).toBe('tiff');
  });

  it('returns null for unknown header', () => {
    writeBytes(testFilePath, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(testFilePath);
    expect(result.headerType).toBeNull();
    expect(result.type).toBeNull();
  });

  it('falls back to extension when header is unknown', () => {
    writeBytes(testFilePath, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const dngPath = testFilePath.replace('.tmp', '.dng');
    fs.writeFileSync(dngPath, fs.readFileSync(testFilePath));
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(dngPath);
    expect(result.type).toBe('dng');
    fs.unlinkSync(dngPath);
  });

  it('shows warning when extension and header type differ', () => {
    // JPEG header but .png extension
    writeBytes(testFilePath, [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const pngPath = testFilePath.replace('.tmp', '.png');
    fs.writeFileSync(pngPath, fs.readFileSync(testFilePath));
    const { detectFileType } = require('../src/core/services/file-signature');
    const result = detectFileType(pngPath);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('JPG');
    expect(result.warning).toContain('PNG');
    fs.unlinkSync(pngPath);
  });
});
