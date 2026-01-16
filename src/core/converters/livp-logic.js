const AdmZip = require("adm-zip");
const sharp = require('sharp');
const path = require("path");
const fs = require("fs");
const { convertHeicToJpg } = require("./heic-logic");
const {
    safeExecute,
    safeExecuteAsync,
    createErrorResult,
    ErrorTypes,
    wrapWithTryCatch,
    wrapAsyncWithTryCatch
} = require("../services/error-handler");

/**
 * 从LIVP文件中提取图像，并在需要时将HEIC转换为JPG
 * @param {string} livpFilePath - LIVP文件的路径
 * @param {string} outputDir - 保存提取图像的目录
 * @returns {Promise<Object>} 包含成功状态和详细信息的提取结果
 */
async function extractImageFromLivp(livpFilePath, outputDir, options = {}) {
    try {
        // 验证输入文件是否存在且可访问（需求6.1, 6.3）
        if (!fs.existsSync(livpFilePath)) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                'File does not exist', 'livp');
        }

        // 检查输入文件是否可读
        try {
            fs.accessSync(livpFilePath, fs.constants.R_OK);
        } catch (accessError) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                `Cannot read LIVP file: ${accessError.message}`, 'livp');
        }

        // 检查文件是否为空
        let fileStats;
        try {
            fileStats = fs.statSync(livpFilePath);
            if (fileStats.size === 0) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    'LIVP file is empty', 'livp');
            }
        } catch (statError) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                `Cannot access LIVP file stats: ${statError.message}`, 'livp');
        }

        // 将LIVP作为ZIP归档打开并进行增强的错误处理（需求6.3）
        let zip;
        try {
            zip = new AdmZip(livpFilePath);
        } catch (error) {
            // 处理特定的ZIP/归档错误
            if (error.message.includes('invalid signature') || error.message.includes('not a zip')) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    'File is not a valid LIVP archive', 'livp');
            } else if (error.message.includes('corrupted') || error.message.includes('damaged')) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    'LIVP archive is corrupted', 'livp');
            } else {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    `Invalid LIVP archive: ${error.message}`, 'livp');
            }
        }

        // 获取条目并进行错误处理
        let entries;
        try {
            entries = zip.getEntries();
            if (!entries || entries.length === 0) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    'LIVP archive is empty', 'livp');
            }
        } catch (error) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                `Cannot read LIVP archive contents: ${error.message}`, 'livp');
        }

        // 在归档中查找图像文件
        const imageEntry = entries.find((entry) => {
            const entryName = entry.entryName.toLowerCase();
            return entryName.endsWith(".heic") || entryName.endsWith(".jpeg") || entryName.endsWith(".jpg");
        });

        if (!imageEntry) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                'No image file found in LIVP archive', 'livp');
        }

        // 确保输出目录存在并进行增强的错误处理
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            // 检查我们是否可以写入输出目录
            fs.accessSync(outputDir, fs.constants.W_OK);
        } catch (error) {
            return createErrorResult('directory_creation', outputDir, 
                `Failed to create or write to output directory: ${error.message}`, 'livp');
        }

        // 获取图像数据并进行错误处理（需求6.3）
        let imageData;
        try {
            imageData = imageEntry.getData();
            if (!imageData || imageData.length === 0) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    'Extracted image data is empty', 'livp');
            }
        } catch (error) {
            return createErrorResult('extraction', path.basename(livpFilePath), 
                `Failed to extract image data: ${error.message}`, 'livp');
        }

        const originalExtension = path.extname(imageEntry.entryName).toLowerCase();
        const baseName = path.basename(livpFilePath, ".livp");

        // 处理HEIC图像并进行全面的错误处理
        if (originalExtension === ".heic") {
            // 创建临时HEIC文件
            const tempHeicPath = path.join(outputDir, `temp_${baseName}.heic`);
            let conversionResult;
            
            try {
                // 写入临时HEIC文件并进行错误处理
                try {
                    fs.writeFileSync(tempHeicPath, imageData);
                } catch (writeError) {
                    return createErrorResult('extraction', path.basename(livpFilePath), 
                        `Failed to write temporary HEIC file: ${writeError.message}`, 'livp');
                }
                
                // 将HEIC转换为JPG并进行增强的错误处理（需求6.2, 6.3）
                const outputFileName = `${baseName}.jpg`;
                const outputFilePath = path.join(outputDir, outputFileName);
                
                conversionResult = await safeExecuteAsync(
                    convertHeicToJpg, 
                    [tempHeicPath, outputFilePath, options],
                    (error) => console.error(`HEIC conversion error: ${error.message}`),
                    { success: false, error: 'HEIC conversion failed' }
                );
            } catch (error) {
                return createErrorResult('conversion', path.basename(livpFilePath), 
                    `Failed to process HEIC image: ${error.message}`, 'livp');
            } finally {
                // 清理临时文件并进行错误处理
                try {
                    if (fs.existsSync(tempHeicPath)) {
                        fs.unlinkSync(tempHeicPath);
                    }
                } catch (cleanupError) {
                    console.warn(`Warning: Failed to clean up temporary file: ${cleanupError.message}`);
                }
            }

            if (conversionResult.success) {
                return { 
                    success: true, 
                    ...conversionResult, // 包含 outputPath, inputSize, outputSize, compressionRatio, method
                    converted: true,
                    originalFormat: "heic"
                };
            } else {
                return createErrorResult('conversion', path.basename(livpFilePath), 
                    conversionResult.error || 'HEIC conversion failed', 'livp');
            }
        } else {
            // 处理JPEG/JPG文件。如果开启了 compressJpg 选项，则进行重新压缩。
            const { quality = 95, compressJpg = false } = options;
            const outputFileName = `${baseName}.jpg`;
            const outputFilePath = path.join(outputDir, outputFileName);
            let inputSize = imageData.length; // 原始 Buffer 大小

            try {
                if (compressJpg) {
                    // 使用 Sharp 进行重新压缩 (如果启用了 JPG 压缩)
                    const outputBuffer = await sharp(imageData)
                        .jpeg({ quality })
                        .toBuffer();
                    
                    fs.writeFileSync(outputFilePath, outputBuffer);
                    
                    const outputStats = fs.statSync(outputFilePath);
                    return { 
                        success: true, 
                        outputPath: outputFilePath, 
                        outputFileName: outputFileName,
                        converted: true, // 视为转换，因为它经过了压缩流程
                        originalFormat: originalExtension.substring(1),
                        inputSize: inputSize,
                        outputSize: outputStats.size,
                        compressionRatio: (1 - outputStats.size / inputSize) * 100
                    };
                } else {
                    // 不进行压缩，直接写入文件
                    fs.writeFileSync(outputFilePath, imageData);

                    const outputStats = fs.statSync(outputFilePath);
                    
                    // 验证输出文件已创建且不为空
                    if (!fs.existsSync(outputFilePath) || outputStats.size === 0) {
                        return createErrorResult('extraction', path.basename(livpFilePath), 
                            'Extraction completed but output file was not created or is empty', 'livp');
                    }

                    return { 
                        success: true, 
                        outputPath: outputFilePath, 
                        outputFileName: outputFileName,
                        converted: false,
                        originalFormat: originalExtension.substring(1),
                        inputSize: inputSize,
                        outputSize: outputStats.size,
                        compressionRatio: 0 // 未压缩
                    };
                }
            } catch (error) {
                return createErrorResult('extraction', path.basename(livpFilePath), 
                    `Failed to save or compress extracted image: ${error.message}`, 'livp');
            }
        }
    } catch (error) {
        // 处理任何意外错误（需求6.5）
        return createErrorResult('extraction', path.basename(livpFilePath), 
            error.message, 'livp');
    }
}

// 扫描当前目录的所有 .livp 文件并处理
async function extractImagesInCurrentDirectory() {
    const currentDir = __dirname;
    const files = fs.readdirSync(currentDir);

    // 筛选出 .livp 文件（不区分大小写）
    const livpFiles = files.filter((file) => file.toLowerCase().endsWith(".livp"));

    if (livpFiles.length === 0) {
        console.log("No .livp files found in the current directory.");
        return;
    }

    console.log(`Found ${livpFiles.length} LIVP file(s) to process.`);

    // 处理每个 .livp 文件
    for (const livpFile of livpFiles) {
        console.log(`Processing: ${livpFile}`);
        const result = await extractImageFromLivp(path.join(currentDir, livpFile), currentDir);
        
        if (result.success) {
            console.log(`✓ Successfully processed ${livpFile} -> ${result.outputFileName}`);
        } else {
            console.error(`✗ Failed to process ${livpFile}: ${result.error}`);
        }
    }

    console.log("Processing complete.");
}

// 导出函数供其他模块使用
module.exports = {
    extractImageFromLivp,
    extractImagesInCurrentDirectory
};

// 执行脚本（仅在直接运行此文件时执行）
if (require.main === module) {
    (async () => {
        try {
            await extractImagesInCurrentDirectory();
        } catch (error) {
            console.error('Script execution failed:', error.message);
            process.exit(1);
        }
    })();
}
