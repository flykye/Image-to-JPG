const fs = require('fs');
const path = require('path');

/**
 * 文件管理器模块
 * 处理集中式JPG目录管理和文件操作
 */

/**
 * 清空已存在的目录内容
 * @param {string} dirPath - 目录路径
 */
function cleanOutputDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      } else {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    }
    return true;
  }
  return false;
}

/**
 * 准备输出目录（创建并可选清空）
 * @param {string} outputDir - 自定义输出目录路径
 * @param {string} inputDir - 输入目录路径
 * @param {boolean} clear - 是否清空
 */
function prepareOutputDirectory(outputDir = null, inputDir = null, clear = true) {
  const baseDir = inputDir || process.cwd();
  const targetPath = outputDir ? path.resolve(outputDir) : path.join(baseDir, 'jpg');

  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  } else if (clear) {
    cleanOutputDirectory(targetPath);
  }

  return targetPath;
}

/**
 * 如果输出目录不存在则创建它
 * @param {string} outputDir - 自定义输出目录路径
 * @param {string} inputDir - 输入目录路径
 * @returns {Object} 包含成功状态和目录路径的结果对象
 */
function createJpgDirectory(outputDir = null, inputDir = null) {
  try {
    const jpgDirPath = prepareOutputDirectory(outputDir, inputDir, false);
    return {
      success: true,
      path: jpgDirPath,
      message: `Output directory ready: ${jpgDirPath}`
    };
  } catch (error) {
    return {
      success: false,
      path: null,
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
 * @param {string} filename - 可选的自定义文件名
 * @param {string} outputDir - 可选的自定义输出目录
 * @returns {Object} 包含成功状态和详细信息的结果对象
 */
function copyToJpgDirectory(sourcePath, filename = null, outputDir = null) {
  try {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }
    
    const sourceStats = fs.statSync(sourcePath);
    const sourceDir = path.dirname(sourcePath);
    const targetDir = prepareOutputDirectory(outputDir, sourceDir, false);
    
    const targetFileName = filename || path.basename(sourcePath);
    const targetPath = path.join(targetDir, targetFileName);
    const finalTargetPath = resolveNameConflict(targetPath);
    const finalFileName = path.basename(finalTargetPath);
    
    fs.copyFileSync(sourcePath, finalTargetPath);
    
    return {
      success: true,
      sourcePath,
      targetPath: finalTargetPath,
      fileName: finalFileName,
      conflictResolved: finalTargetPath !== targetPath,
      sourceSize: sourceStats.size,
      targetSize: fs.statSync(finalTargetPath).size
    };
    
  } catch (error) {
    return {
      success: false,
      sourcePath,
      error: error.message
    };
  }
}

/**
 * 检查文件是否为JPG文件
 */
function isJpgFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg';
}

/**
 * 扫描目录查找JPG和JPEG文件
 */
function findJpgFiles(dirPath) {
    const jpgFiles = [];
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            if (fs.statSync(fullPath).isFile() && isJpgFile(file)) {
                jpgFiles.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory:`, error.message);
    }
    return jpgFiles;
}

/**
 * 将JPG文件移动到输出目录
 */
function moveAllJpgFiles(sourceDir, outputDir, jpgFilesToMove = null) {
    try {
        const targetDir = prepareOutputDirectory(outputDir, sourceDir, false);
        const jpgFiles = jpgFilesToMove || findJpgFiles(sourceDir);

        let movedCount = 0;
        for (const sourcePath of jpgFiles) {
            const filename = path.basename(sourcePath);
            const targetPath = path.join(targetDir, filename);
            const finalTargetPath = resolveNameConflict(targetPath);
            fs.renameSync(sourcePath, finalTargetPath);
            movedCount++;
        }

        return { success: true, movedCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
  prepareOutputDirectory,
  cleanOutputDirectory,
  createJpgDirectory,
  copyToJpgDirectory,
  resolveNameConflict,
  findJpgFiles,
  moveAllJpgFiles,
  isJpgFile
};
