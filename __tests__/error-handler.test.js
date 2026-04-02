const {
  ErrorTypes,
  categorizeError,
  safeExecute,
  safeExecuteAsync,
  createErrorResult,
  wrapWithTryCatch,
  wrapAsyncWithTryCatch
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
      expect(categorizeError(new Error('Directory does not exist'))).toBe(ErrorTypes.DIRECTORY_NOT_FOUND);
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
      expect(categorizeError(new Error('No space left on device'))).toBe(ErrorTypes.DISK_SPACE_ERROR);
      expect(categorizeError(new Error('Disk full'))).toBe(ErrorTypes.DISK_SPACE_ERROR);
    });

    it('returns UNKNOWN_ERROR for unrecognized messages', () => {
      expect(categorizeError(new Error('Something went wrong'))).toBe(ErrorTypes.UNKNOWN_ERROR);
    });
  });

  describe('safeExecute', () => {
    it('returns function result on success', () => {
      const result = safeExecute(() => 42, [], null, null);
      expect(result).toBe(42);
    });

    it('returns defaultValue on error', () => {
      const result = safeExecute(() => { throw new Error('fail'); }, [], null, -1);
      expect(result).toBe(-1);
    });

    it('calls onError handler when provided', () => {
      const handler = jest.fn();
      safeExecute(() => { throw new Error('fail'); }, [], handler, null);
      expect(handler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('safeExecuteAsync', () => {
    it('returns function result on success', async () => {
      const result = await safeExecuteAsync(() => Promise.resolve(42), [], null, null);
      expect(result).toBe(42);
    });

    it('returns defaultValue on error', async () => {
      const result = await safeExecuteAsync(() => Promise.reject(new Error('fail')), [], null, -1);
      expect(result).toBe(-1);
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

  describe('wrapWithTryCatch', () => {
    it('returns result on success', () => {
      const wrapped = wrapWithTryCatch((a, b) => a + b);
      const result = wrapped(2, 3);
      expect(result).toBe(5);
    });

    it('returns error object on failure', () => {
      const wrapped = wrapWithTryCatch(() => { throw new Error('wrapped error'); });
      const result = wrapped();
      expect(result.success).toBe(false);
      expect(result.error).toBe('wrapped error');
    });
  });

  describe('wrapAsyncWithTryCatch', () => {
    it('returns result on success', async () => {
      const wrapped = wrapAsyncWithTryCatch(async (a, b) => a + b);
      const result = await wrapped(2, 3);
      expect(result).toBe(5);
    });

    it('returns error object on failure', async () => {
      const wrapped = wrapAsyncWithTryCatch(async () => { throw new Error('async error'); });
      const result = await wrapped();
      expect(result.success).toBe(false);
      expect(result.error).toBe('async error');
    });
  });
});
