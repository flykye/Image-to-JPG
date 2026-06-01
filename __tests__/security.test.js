const childProcess = require('child_process');
const helpers = require('../src/core/services/conversion-helpers');
const heicConvert = require('heic-convert');
const sharp = require('sharp');

// Mock child_process
jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  execSync: jest.fn(),
  exec: jest.fn()
}));

// Mock heic-convert 强制 Wasm 降级
jest.mock('heic-convert', () => jest.fn());

// Mock sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    withMetadata: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({}),
    metadata: jest.fn().mockResolvedValue({ density: 72 })
  }));
  mockSharp.format = { heif: null }; // 模拟 sharp 不支持 HEIC
  return mockSharp;
});

describe('Security - Shell Command Injection Prevention', () => {
  let originalValidateInputFile;
  let originalPrepareOutputPath;
  let originalValidateOutputFile;

  beforeAll(() => {
    originalValidateInputFile = helpers.validateInputFile;
    originalPrepareOutputPath = helpers.prepareOutputPath;
    originalValidateOutputFile = helpers.validateOutputFile;
  });

  afterAll(() => {
    helpers.validateInputFile = originalValidateInputFile;
    helpers.prepareOutputPath = originalPrepareOutputPath;
    helpers.validateOutputFile = originalValidateOutputFile;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // 强制 mock 所有的文件系统辅助检测，避免对磁盘产生依赖
    helpers.validateInputFile = jest.fn().mockReturnValue({ valid: true, stats: { size: 100 } });
    helpers.prepareOutputPath = jest.fn().mockReturnValue({ valid: true });
    helpers.validateOutputFile = jest.fn().mockReturnValue({ valid: true, stats: { outputSize: 90, inputSize: 100 } });
  });

  it('should safely delegate HEIC conversion to execFileSync with array parameters', async () => {
    // 模拟 Wasm 失败，促使进入 ImageMagick
    heicConvert.mockRejectedValue(new Error('Wasm failed intentionally'));
    
    // 强制 mock ImageMagick 探测
    jest.spyOn(helpers, 'getImageMagickCommand').mockResolvedValue('/usr/local/bin/magick');
    jest.spyOn(helpers, 'isImageMagickAvailable').mockResolvedValue(true);

    const { convertHeicToJpg } = require('../src/core/converters/heic-logic');

    const suspiciousInputPath = '/path/with; rm -rf / && "spaces".heic';
    const outputPath = '/output/folder; mkdir injected/test.jpg';

    const result = await convertHeicToJpg(suspiciousInputPath, outputPath, { quality: 85 });

    // 应该成功被转换逻辑拦截并导向 ImageMagick，且转换成功
    expect(result.success).toBe(true);
    expect(result.method).toBe('imagemagick');

    // 关键：验证 execFileSync 确实是以防注入的形式被调用
    expect(childProcess.execFileSync).toHaveBeenCalledTimes(1);
    
    // 传入参数第一项为探测到的完整命令，第二项为防注入的参数数组
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      '/usr/local/bin/magick',
      [
        suspiciousInputPath,
        '-quality',
        '85',
        outputPath
      ],
      { timeout: 60000 }
    );
  });

  it('should safely delegate DNG conversion to execFileSync with array parameters', async () => {
    // 强制 mock ImageMagick 探测
    jest.spyOn(helpers, 'getImageMagickCommand').mockResolvedValue('convert');
    jest.spyOn(helpers, 'isImageMagickAvailable').mockResolvedValue(true);

    // 强制 mock sharp 将 DNG 转换抛错，促使走到 ImageMagick 分支
    sharp.mockImplementationOnce(() => {
      throw new Error('Sharp raw format unsupported in test mock');
    });

    const { convertDngToJpg } = require('../src/core/converters/dng-logic');

    const suspiciousInputPath = '/malicious/dng; cat /etc/passwd.dng';
    const outputPath = '/safe/output.jpg';

    const result = await convertDngToJpg(suspiciousInputPath, outputPath, { quality: 95 });

    expect(result.success).toBe(true);
    expect(result.method).toBe('imagemagick');

    // 验证 execFileSync 被调用
    expect(childProcess.execFileSync).toHaveBeenCalledTimes(1);
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'convert',
      [
        suspiciousInputPath,
        '-quality',
        '95',
        outputPath
      ],
      { timeout: 120000 }
    );
  });
});
