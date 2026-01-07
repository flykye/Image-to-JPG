const fs = require('fs');
const path = require('path');

/**
 * 文件管理器模块
 * 处理集中式JPG目录管理和文件操作
 */

/**
 * 如果输出目录不存在则创建它，如果已存在则清空内容
 * @param {string} outputDir - 自定义输出目录路径（默认：输入目录中的'jpg'）
 * @param {string} inputDir - 输入目录路径（默认：当前工作目录）
 * @param {boolean} clearExisting - 是否清空已存在的目录内容（默认：true）
 * @returns {Object} 包含成功状态和目录路径的结果对象
 */
function createJpgDirectory(outputDir = null, inputDir = null, clearExisting = true) {
  try {
    // 使用提供的输出目录，或者在输入目录下创建jpg目录，或者在当前工作目录下创建jpg目录
    const baseDir = inputDir || process.cwd();
    const jpgDirPath = outputDir ? path.resolve(outputDir) : path.join(baseDir, 'jpg');
    
    // Check if directory already exists
    if (fs.existsSync(jpgDirPath)) {
      const stats = fs.statSync(jpgDirPath);
      if (!stats.isDirectory()) {
        throw new Error(`'${jpgDirPath}' exists but is not a directory`);
      }
      
      return {
        success: true,
        path: jpgDirPath,
        created: false,
        cleared: false,
        message: `Output directory already exists: ${jpgDirPath}`
      };
    }
    
    // Create the directory
    fs.mkdirSync(jpgDirPath, { recursive: true });
    
    return {
      success: true,
      path: jpgDirPath,
      created: true,
      cleared: false,
      message: `Output directory created successfully: ${jpgDirPath}`
    };
    
  } catch (error) {
    return {
      success: false,
      path: null,
      created: false,
      cleared: false,
      error: error.message
    };
  }
}

/**
 * 通过添加数字后缀解决文件名冲突
 * @param {string} targetPath - 期望的文件路径
 * @returns {string} 解决冲突后的可用文件路径
 */
function resolveNameConflict(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }
  
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const baseName = path.basename(targetPath, ext);
  
  let counter = 1;
  let newPath;
  
  do {
    const newFileName = `${baseName}_${counter}${ext}`;
    newPath = path.join(dir, newFileName);
    counter++;
  } while (fs.existsSync(newPath));
  
  return newPath;
}

/**
 * 将文件复制到输出目录并解决冲突
 * @param {string} sourcePath - 源文件路径
 * @param {string} filename - 可选的自定义文件名（默认为原始文件名）
 * @param {string} outputDir - 可选的自定义输出目录（默认为源文件目录中的'jpg'）
 * @returns {Object} 包含成功状态和详细信息的结果对象
 */
function copyToJpgDirectory(sourcePath, filename = null, outputDir = null) {
  try {
    // Validate source file exists and is accessible (Requirement 6.1)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }
    
    // Check if source file is readable
    try {
      fs.accessSync(sourcePath, fs.constants.R_OK);
    } catch (accessError) {
      throw new Error(`Cannot read source file: ${accessError.message}`);
    }
    
    // Check if source file is not empty
    let sourceStats;
    try {
      sourceStats = fs.statSync(sourcePath);
      if (sourceStats.size === 0) {
        throw new Error('Source file is empty');
      }
    } catch (statError) {
      throw new Error(`Cannot access source file stats: ${statError.message}`);
    }
    
    // 确保输出目录存在并进行增强的错误处理
    // 使用源文件的目录作为输入目录
    const sourceDir = path.dirname(sourcePath);
    const jpgDirResult = createJpgDirectory(outputDir, sourceDir);
    if (!jpgDirResult.success) {
      throw new Error(`Failed to create output directory: ${jpgDirResult.error}`);
    }
    
    // Determine target filename
    const targetFileName = filename || path.basename(sourcePath);
    const targetPath = path.join(jpgDirResult.path, targetFileName);
    
    // Resolve any naming conflicts
    const finalTargetPath = resolveNameConflict(targetPath);
    const finalFileName = path.basename(finalTargetPath);
    
    // Check if we have write permissions to the target directory
    try {
      fs.accessSync(path.dirname(finalTargetPath), fs.constants.W_OK);
    } catch (writeError) {
      throw new Error(`Cannot write to jpg directory: ${writeError.message}`);
    }
    
    // Copy the file with error handling (Requirement 6.4)
    try {
      fs.copyFileSync(sourcePath, finalTargetPath);
    } catch (copyError) {
      throw new Error(`File copy failed: ${copyError.message}`);
    }
    
    // Verify the copy was successful
    if (!fs.existsSync(finalTargetPath)) {
      throw new Error('File copy completed but target file was not created');
    }
    
    // Verify file integrity by comparing sizes
    let targetStats;
    try {
      targetStats = fs.statSync(finalTargetPath);
      if (targetStats.size !== sourceStats.size) {
        throw new Error('File copy completed but file sizes do not match');
      }
    } catch (verifyError) {
      throw new Error(`Cannot verify copied file: ${verifyError.message}`);
    }
    
    return {
      success: true,
      sourcePath,
      targetPath: finalTargetPath,
      fileName: finalFileName,
      conflictResolved: finalTargetPath !== targetPath,
      sourceSize: sourceStats.size,
      targetSize: targetStats.size,
      message: `Successfully copied to jpg directory: ${finalFileName}`
    };
    
  } catch (error) {
    return {
      success: false,
      sourcePath,
      targetPath: null,
      fileName: null,
      conflictResolved: false,
      error: error.message,
      message: `Failed to copy to jpg directory: ${error.message}`
    };
  }
}

/**
 * 批量复制多个文件到jpg目录
 * @param {string[]} sourcePaths - 源文件路径数组
 * @param {Function} progressCallback - 可选的进度更新回调函数
 * @returns {Object} 带有统计信息的批量复制结果
 */
function batchCopyToJpgDirectory(sourcePaths, progressCallback = null) {
  const results = [];
  const stats = {
    total: sourcePaths.length,
    successful: 0,
    failed: 0,
    conflictsResolved: 0,
    totalSize: 0
  };
  
  for (let i = 0; i < sourcePaths.length; i++) {
    const sourcePath = sourcePaths[i];
    
    if (progressCallback) {
      progressCallback({
        current: i + 1,
        total: sourcePaths.length,
        currentFile: path.basename(sourcePath)
      });
    }
    
    const result = copyToJpgDirectory(sourcePath);
    results.push(result);
    
    if (result.success) {
      stats.successful++;
      stats.totalSize += result.sourceSize;
      if (result.conflictResolved) {
        stats.conflictsResolved++;
      }
    } else {
      stats.failed++;
    }
  }
  
  return {
    results,
    stats
  };
}

/**
 * 获取jpg目录的信息
 * @returns {Object} 目录信息
 */
function getJpgDirectoryInfo() {
  const jpgDirPath = path.join(process.cwd(), 'jpg');
  
  try {
    if (!fs.existsSync(jpgDirPath)) {
      return {
        exists: false,
        path: jpgDirPath,
        fileCount: 0,
        totalSize: 0
      };
    }
    
    const stats = fs.statSync(jpgDirPath);
    if (!stats.isDirectory()) {
      return {
        exists: false,
        path: jpgDirPath,
        fileCount: 0,
        totalSize: 0,
        error: 'jpg path exists but is not a directory'
      };
    }
    
    const files = fs.readdirSync(jpgDirPath);
    let totalSize = 0;
    let fileCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(jpgDirPath, file);
      const fileStats = fs.statSync(filePath);
      if (fileStats.isFile()) {
        fileCount++;
        totalSize += fileStats.size;
      }
    });
    
    return {
      exists: true,
      path: jpgDirPath,
      fileCount,
      totalSize
    };
    
  } catch (error) {
    return {
      exists: false,
      path: jpgDirPath,
      fileCount: 0,
      totalSize: 0,
      error: error.message
    };
  }
}

/**
 * 检查文件是否为JPG文件（不区分大小写）
 * @param {string} filename - 要检查的文件名
 * @returns {boolean} 如果是JPG文件则返回true
 */
function isJpgFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg';
}

/**
 * 扫描目录查找JPG和JPEG文件
 * @param {string} dirPath - 目录路径
 * @returns {string[]} JPG/JPEG文件的完整路径数组
 */
function findJpgFiles(dirPath) {
    const jpgFiles = [];
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            // 安全地检查它是否是一个文件
            const stats = fs.statSync(fullPath);
            if (stats.isFile() && isJpgFile(file)) {
                jpgFiles.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dirPath} for JPG files:`, error.message);
    }
    return jpgFiles;
}

/**
 * 将JPG文件移动到输出目录
 * @param {string} sourceDir - 源目录路径
 * @param {string} outputDir - 输出目录路径
 * @param {string[]} [jpgFilesToMove] - 要移动的JPG文件路径数组（可选）
 * @returns {Object} 移动结果
 */
function moveAllJpgFiles(sourceDir, outputDir, jpgFilesToMove = null) {
    const jpgDirResult = createJpgDirectory(outputDir, sourceDir);
    if (!jpgDirResult.success) {
        return {
            success: false,
            message: `Failed to ensure output directory: ${jpgDirResult.error}`
        };
    }

    // 如果提供了要移动的文件列表，则使用该列表，否则扫描目录
    let jpgFiles;
    if (jpgFilesToMove && Array.isArray(jpgFilesToMove) && jpgFilesToMove.length > 0) {
        jpgFiles = jpgFilesToMove;
    } else {
        jpgFiles = findJpgFiles(sourceDir);
    }
    
    const targetDir = jpgDirResult.path;

    let movedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const sourcePath of jpgFiles) {
        try {
            const filename = path.basename(sourcePath);
            const targetPath = path.join(targetDir, filename);
            const finalTargetPath = resolveNameConflict(targetPath);
            
            // 移动文件
            fs.renameSync(sourcePath, finalTargetPath);
            
            // 如果原始文件路径和最终目标路径不同，说明发生了重命名
            const renamed = finalTargetPath !== targetPath;
            movedCount++;
            
            console.log(`    📁 Moved JPG file to output directory: ${path.basename(finalTargetPath)}${renamed ? ' (renamed to avoid conflict)' : ''}`);
        } catch (error) {
            errorCount++;
            errors.push({
                file: sourcePath,
                error: error.message
            });
            console.error(`    ❌ Failed to move JPG file ${sourcePath}: ${error.message}`);
        }
    }

    return {
        success: true,
        movedCount,
        errorCount,
        errors,
        message: `Moved ${movedCount} JPG files to ${targetDir} directory. ${errorCount} errors occurred.`
    };
}

module.exports = {
  createJpgDirectory,
  copyToJpgDirectory,
  batchCopyToJpgDirectory,
  resolveNameConflict,
  getJpgDirectoryInfo,
  findJpgFiles,
  moveAllJpgFiles,
  isJpgFile // 导出这个辅助函数
};