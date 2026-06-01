/**
 * 转换辅助函数
 * 提供统一的输入/输出验证和转换相关工具
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * 验证输入文件
 * @param {string} inputPath - 输入文件路径
 * @returns {{ valid: boolean, error?: object, stats?: object }}
 */
function validateInputFile(inputPath) {
  if (!fs.existsSync(inputPath)) {
    return {
      valid: false,
      error: { message: `Input file does not exist: ${inputPath}`, type: 'file_not_found' }
    };
  }

  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (e) {
    return {
      valid: false,
      error: { message: `Cannot read input file: ${e.message}`, type: 'permission_error' }
    };
  }

  const stats = fs.statSync(inputPath);
  if (stats.size === 0) {
    return {
      valid: false,
      error: { message: `Input file is empty: ${inputPath}`, type: 'empty_file' }
    };
  }

  return { valid: true, stats };
}

/**
 * 验证并准备输出目录
 * @param {string} outputPath - 输出文件路径
 * @returns {{ valid: boolean, error?: object, outputDir?: string }}
 */
function prepareOutputPath(outputPath) {
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (e) {
      return {
        valid: false,
        error: { message: `Cannot create output directory: ${e.message}`, type: 'directory_creation' }
      };
    }
  }

  try {
    fs.accessSync(outputDir, fs.constants.W_OK);
  } catch (e) {
    return {
      valid: false,
      error: { message: `Cannot write to output directory: ${e.message}`, type: 'permission_error' }
    };
  }

  return { valid: true, outputDir };
}

/**
 * 验证输出文件是否成功创建且非空
 * @param {string} outputPath - 输出文件路径
 * @param {object} inputStats - 输入文件统计信息
 * @returns {{ valid: boolean, stats?: object, error?: object }}
 */
function validateOutputFile(outputPath, inputStats) {
  if (!fs.existsSync(outputPath)) {
    return {
      valid: false,
      error: { message: 'Conversion completed but output file was not created', type: 'conversion_error' }
    };
  }

  const outputStats = fs.statSync(outputPath);
  if (outputStats.size === 0) {
    return {
      valid: false,
      error: { message: 'Conversion completed but output file is empty', type: 'conversion_error' }
    };
  }

  const compressionRatio = inputStats
    ? (1 - outputStats.size / inputStats.size) * 100
    : 0;

  return {
    valid: true,
    stats: {
      inputSize: inputStats ? inputStats.size : 0,
      outputSize: outputStats.size,
      compressionRatio
    }
  };
}

let cachedImageMagickCmd = null;

/**
 * 动态探测可用的 ImageMagick 命令或绝对路径（带缓存）
 * @returns {Promise<string|null>}
 */
async function getImageMagickCommand() {
  if (cachedImageMagickCmd !== null) {
    return cachedImageMagickCmd || null;
  }

  const commands = [
    { name: 'magick', cmd: 'magick -version', timeout: 3000 },
    { name: 'convert', cmd: 'convert -version', timeout: 3000 },
    { name: '/opt/homebrew/bin/magick', cmd: '/opt/homebrew/bin/magick -version', timeout: 3000 },
    { name: '/usr/local/bin/magick', cmd: '/usr/local/bin/magick -version', timeout: 3000 },
    { name: '/opt/homebrew/bin/convert', cmd: '/opt/homebrew/bin/convert -version', timeout: 3000 },
    { name: '/usr/local/bin/convert', cmd: '/usr/local/bin/convert -version', timeout: 3000 }
  ];

  for (const { name, cmd, timeout } of commands) {
    try {
      await execAsync(cmd, { timeout });
      cachedImageMagickCmd = name;
      return cachedImageMagickCmd;
    } catch {
      // continue
    }
  }

  cachedImageMagickCmd = '';
  return null;
}

/**
 * 检查 ImageMagick 是否可用
 * @returns {Promise<boolean>}
 */
async function isImageMagickAvailable() {
  const cmd = await getImageMagickCommand();
  return !!cmd;
}

module.exports = {
  validateInputFile,
  prepareOutputPath,
  validateOutputFile,
  getImageMagickCommand,
  isImageMagickAvailable
};
