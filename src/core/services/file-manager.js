const fs = require('fs');
const path = require('path');

// Output preparation never removes existing files. Publication owns conflicts.
function prepareOutputDirectory(outputDir = null, inputDir = null) {
  const baseDir = inputDir || process.cwd();
  const targetPath = outputDir ? path.resolve(outputDir) : path.join(baseDir, 'jpg');
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
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
    const targetDir = prepareOutputDirectory(outputDir, sourceDir);

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

module.exports = { prepareOutputDirectory, copyToJpgDirectory, resolveNameConflict };
