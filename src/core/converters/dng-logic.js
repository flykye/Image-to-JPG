const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * DNG转JPG转换器模块
 * 使用sharp库处理DNG (Digital Negative) RAW文件到JPG格式的转换
 * 降级策略：Sharp -> ImageMagick
 */

/**
 * 检查当前sharp安装是否支持DNG转换
 * @returns {boolean} 如果支持DNG则返回true，否则返回false
 */
function isDngSupported() {
    try {
        const formats = sharp.format;
        // DNG格式通常通过libraw支持，检查raw格式支持
        return formats.raw && formats.raw.input;
    } catch (error) {
        return false;
    }
}

/**
 * 检查是否可以使用ImageMagick进行DNG转换
 * @returns {Promise<boolean>} 如果ImageMagick可用则返回true，否则返回false
 */
async function isImageMagickAvailable() {
    try {
        await execAsync('magick -version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * 使用Sharp将DNG转换为JPG
 * @param {string} inputPath - 输入DNG文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：95）
 * @returns {Promise<Object>} 转换结果
 */
async function convertDngToJpgWithSharp(inputPath, outputPath, options = {}) {
    const { quality = 95 } = options;

    try {
        // 验证输入文件存在
        if (!fs.existsSync(inputPath)) {
            throw new Error(`Input file does not exist: ${inputPath}`);
        }

        // 检查输入文件是否可读
        fs.accessSync(inputPath, fs.constants.R_OK);

        // 获取文件统计信息
        const fileStats = fs.statSync(inputPath);
        if (fileStats.size === 0) {
            throw new Error(`Input file is empty: ${inputPath}`);
        }

        // 确保输出目录存在
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.accessSync(outputDir, fs.constants.W_OK);

        // 使用Sharp进行转换
        // DNG是RAW格式，sharp会使用内置的预览设置处理白平衡
        await sharp(inputPath)
            .withMetadata()  // 保留基本EXIF元数据
            .jpeg({ quality })
            .toFile(outputPath);

        // 验证输出文件已创建
        if (!fs.existsSync(outputPath)) {
            throw new Error('Conversion completed but output file was not created');
        }

        const outputStats = fs.statSync(outputPath);
        if (outputStats.size === 0) {
            throw new Error('Conversion completed but output file is empty');
        }

        return {
            success: true,
            inputPath,
            outputPath,
            inputSize: fileStats.size,
            outputSize: outputStats.size,
            compressionRatio: (1 - outputStats.size / fileStats.size) * 100,
            method: 'sharp'
        };

    } catch (error) {
        return {
            success: false,
            inputPath,
            outputPath,
            error: `Sharp conversion failed: ${error.message}`,
            errorType: getErrorType(error),
            method: 'sharp'
        };
    }
}

/**
 * 使用ImageMagick作为备选方案将DNG转换为JPG
 * @param {string} inputPath - 输入DNG文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：95）
 * @returns {Promise<Object>} 转换结果
 */
async function convertDngToJpgWithImageMagick(inputPath, outputPath, options = {}) {
    const { quality = 95 } = options;

    try {
        // 验证输入文件存在
        if (!fs.existsSync(inputPath)) {
            throw new Error(`Input file does not exist: ${inputPath}`);
        }

        // 检查输入文件是否可读
        try {
            fs.accessSync(inputPath, fs.constants.R_OK);
        } catch (accessError) {
            throw new Error(`Cannot read input file: ${accessError.message}`);
        }

        // 获取输入文件统计信息
        const fileStats = fs.statSync(inputPath);
        if (fileStats.size === 0) {
            throw new Error(`Input file is empty: ${inputPath}`);
        }

        // 确保输出目录存在
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 使用ImageMagick转换
        const command = `magick "${inputPath}" -quality ${quality} "${outputPath}"`;
        await execAsync(command);

        // 验证输出文件已创建
        if (!fs.existsSync(outputPath)) {
            throw new Error('Conversion completed but output file was not created');
        }

        // 获取输出文件统计信息
        const outputStats = fs.statSync(outputPath);
        if (outputStats.size === 0) {
            throw new Error('Conversion completed but output file is empty');
        }

        return {
            success: true,
            inputPath,
            outputPath,
            inputSize: fileStats.size,
            outputSize: outputStats.size,
            compressionRatio: (1 - outputStats.size / fileStats.size) * 100,
            method: 'imagemagick'
        };

    } catch (error) {
        return {
            success: false,
            inputPath,
            outputPath,
            error: error.message,
            errorType: getErrorType(error),
            method: 'imagemagick'
        };
    }
}

/**
 * 将DNG文件转换为JPG格式（智能降级策略）
 * @param {string} inputPath - 输入DNG文件的路径
 * @param {string} outputPath - 保存JPG文件的路径
 * @param {Object} options - 转换选项
 * @param {number} options.quality - JPG质量（1-100，默认：95）
 * @returns {Promise<Object>} 包含成功状态和详细信息的转换结果
 */
async function convertDngToJpg(inputPath, outputPath, options = {}) {
    const { quality = 95 } = options;

    // 基本验证
    if (!fs.existsSync(inputPath)) {
        return {
            success: false,
            inputPath,
            outputPath,
            error: `Input file does not exist: ${inputPath}`,
            errorType: 'file_not_found'
        };
    }

    const inputExt = path.extname(inputPath).toLowerCase();
    if (inputExt !== '.dng') {
        return {
            success: false,
            inputPath,
            outputPath,
            error: `Input file is not a DNG file: ${inputPath}`,
            errorType: 'invalid_format'
        };
    }

    let lastErrorResult = null;

    // 1. 优先尝试Sharp（主方案）
    console.log('尝试使用Sharp转换DNG...');
    const sharpResult = await convertDngToJpgWithSharp(inputPath, outputPath, options);
    if (sharpResult.success) {
        return sharpResult;
    }

    // 记录错误并降级
    console.warn(`Sharp转换失败: ${sharpResult.error}. 尝试降级到ImageMagick...`);
    lastErrorResult = sharpResult;

    // 2. 降级到ImageMagick
    const isImAvailable = await isImageMagickAvailable();
    if (isImAvailable) {
        console.log('ImageMagick可用，尝试使用ImageMagick转换DNG...');
        const imResult = await convertDngToJpgWithImageMagick(inputPath, outputPath, options);
        if (imResult.success) {
            return imResult;
        }
        console.warn(`ImageMagick转换失败: ${imResult.error}`);
        lastErrorResult = imResult;
    } else {
        console.warn('ImageMagick不可用，无法使用降级方案');
    }

    // 3. 所有尝试都失败，返回最后一次失败的结果
    return lastErrorResult || {
        success: false,
        inputPath,
        outputPath,
        error: 'All conversion methods failed',
        errorType: 'conversion_error'
    };
}

/**
 * 将DNG文件转换为JPG，自动生成输出路径
 * @param {string} inputPath - 输入DNG文件的路径
 * @param {string} outputDir - 保存JPG文件的目录（可选，默认为与输入文件相同的目录）
 * @param {Object} options - 转换选项
 * @returns {Promise<Object>} 转换结果
 */
async function convertDngToJpgAuto(inputPath, outputDir = null, options = {}) {
    try {
        const inputDir = path.dirname(inputPath);
        const inputName = path.basename(inputPath, path.extname(inputPath));
        const targetDir = outputDir || inputDir;
        const outputPath = path.join(targetDir, `${inputName}.jpg`);

        return await convertDngToJpg(inputPath, outputPath, options);
    } catch (error) {
        return {
            success: false,
            inputPath,
            outputPath: null,
            error: error.message,
            errorType: 'conversion_error'
        };
    }
}

/**
 * 确定转换过程中发生的错误类型
 * @param {Error} error - 错误对象
 * @returns {string} 错误类型分类
 */
function getErrorType(error) {
    const message = error.message.toLowerCase();

    if (message.includes('does not exist') || message.includes('no such file')) {
        return 'file_not_found';
    } else if (message.includes('empty')) {
        return 'empty_file';
    } else if (message.includes('not a dng file') || message.includes('invalid format')) {
        return 'invalid_format';
    } else if (message.includes('not supported') || message.includes('unsupported')) {
        return 'unsupported_format';
    } else if (message.includes('corrupted') || message.includes('invalid image')) {
        return 'corrupted_file';
    } else if (message.includes('permission') || message.includes('access')) {
        return 'permission_error';
    } else if (message.includes('space') || message.includes('disk full')) {
        return 'disk_space_error';
    } else {
        return 'conversion_error';
    }
}

module.exports = {
    convertDngToJpg,
    convertDngToJpgAuto,
    convertDngToJpgWithSharp,
    convertDngToJpgWithImageMagick,
    isDngSupported,
    isImageMagickAvailable,
    getErrorType
};
