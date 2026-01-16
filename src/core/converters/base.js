/**
 * 图像转换器基类
 * 独立于工厂以避免循环引用
 */
class ImageConverter {
  /**
   * 检查是否支持该文件
   * @param {string} filePath 
   * @returns {boolean}
   */
  supports(filePath) {
    throw new Error('supports() must be implemented');
  }

  /**
   * 执行转换
   * @param {string} filePath 
   * @param {string} outputDir 
   * @param {Object} options 
   * @returns {Promise<Object>}
   */
  async convert(filePath, outputDir, options) {
    throw new Error('convert() must be implemented');
  }

  /**
   * 获取文件类型标识
   */
  get type() {
    throw new Error('type getter must be implemented');
  }
}

module.exports = { ImageConverter };
