class JobError extends Error {
  constructor(code, message, input = null, systemCode = null) {
    super(message);
    this.code = code;
    this.input = input;
    this.systemCode = systemCode;
  }
}

function errorDetails(error, code = 'INTERNAL_ERROR', input = null) {
  return {
    code: error instanceof JobError ? error.code : code,
    message: error.message || String(error),
    input: error.input || input,
    systemCode: error.systemCode || (error instanceof JobError ? null : error.code) || null
  };
}

module.exports = { JobError, errorDetails };
