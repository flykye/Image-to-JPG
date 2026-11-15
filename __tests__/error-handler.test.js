const {
  ErrorTypes,
  categorizeError,
  createErrorResult
} = require('../src/core/services/error-handler');

describe('error-handler', () => {
  describe('categorizeError', () => {
    it('returns default type for null/undefined error', () => {
      expect(categorizeError(null)).toBe(ErrorTypes.UNKNOWN_ERROR);
      expect(categorizeError(undefined)).toBe(ErrorTypes.UNKNOWN_ERROR);
    });

    it('returns FILE_NOT_FOUND for "does not exist" errors', () => {
      expect(categorizeError(new Error('File does not exist'))).toBe(ErrorTypes.FILE_NOT_FOUND);
      expect(categorizeError(new Error('no such file'))).toBe(ErrorTypes.FILE_NOT_FOUND);
    });

    it('returns DIRECTORY_NOT_FOUND when "directory" is in message', () => {
      expect(categorizeError(new Error('Directory does not exist'))).toBe(
        ErrorTypes.DIRECTORY_NOT_FOUND
      );
    });

    it('returns PERMISSION_ERROR for permission/access errors', () => {
      expect(categorizeError(new Error('Permission denied'))).toBe(ErrorTypes.PERMISSION_ERROR);
      expect(categorizeError(new Error('Access denied'))).toBe(ErrorTypes.PERMISSION_ERROR);
    });

    it('returns INVALID_FORMAT for format errors', () => {
      expect(categorizeError(new Error('Not a HEIC file'))).toBe(ErrorTypes.INVALID_FORMAT);
      expect(categorizeError(new Error('Invalid format'))).toBe(ErrorTypes.INVALID_FORMAT);
      expect(categorizeError(new Error('Unsupported'))).toBe(ErrorTypes.INVALID_FORMAT);
    });

    it('returns CORRUPTED_FILE for corrupted image errors', () => {
      expect(categorizeError(new Error('Corrupted image'))).toBe(ErrorTypes.CORRUPTED_FILE);
      expect(categorizeError(new Error('Invalid image'))).toBe(ErrorTypes.CORRUPTED_FILE);
    });

    it('returns CONVERSION_ERROR for conversion errors', () => {
      expect(categorizeError(new Error('Conversion failed'))).toBe(ErrorTypes.CONVERSION_ERROR);
    });

    it('returns EXTRACTION_ERROR for extraction errors', () => {
      expect(categorizeError(new Error('Extract failed'))).toBe(ErrorTypes.EXTRACTION_ERROR);
    });

    it('returns COPY_ERROR for copy errors', () => {
      expect(categorizeError(new Error('Copy failed'))).toBe(ErrorTypes.COPY_ERROR);
    });

    it('returns DISK_SPACE_ERROR for disk space errors', () => {
      expect(categorizeError(new Error('No space left on device'))).toBe(
        ErrorTypes.DISK_SPACE_ERROR
      );
      expect(categorizeError(new Error('Disk full'))).toBe(ErrorTypes.DISK_SPACE_ERROR);
    });

    it('returns UNKNOWN_ERROR for unrecognized messages', () => {
      expect(categorizeError(new Error('Something went wrong'))).toBe(ErrorTypes.UNKNOWN_ERROR);
    });
  });

  describe('createErrorResult', () => {
    it('creates a proper error result object', () => {
      const result = createErrorResult('convert', 'test.heic', new Error('Failed'), 'heic');
      expect(result.success).toBe(false);
      expect(result.operation).toBe('convert');
      expect(result.filename).toBe('test.heic');
      expect(result.error).toBe('Failed');
      expect(result.fileType).toBe('heic');
      expect(result.errorType).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });
});
