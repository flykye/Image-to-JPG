const fs = require('fs');
const { factory } = require('../converters');
const { JobError } = require('./job-error');

const MB = 1_000_000;
const MAX_OUTPUT_BYTES = 20 * MB;
const MAX_THRESHOLD_MB = 1_000_000;

function validateCompressionOptions(options = {}) {
  const threshold = options.compressAboveMb ?? 0;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > MAX_THRESHOLD_MB) {
    throw new JobError(
      'INVALID_ARGUMENT',
      `JPG compression threshold must be between 0 and ${MAX_THRESHOLD_MB} MB`
    );
  }
  if (options.forceUnder20Mb !== undefined && typeof options.forceUnder20Mb !== 'boolean') {
    throw new JobError('INVALID_ARGUMENT', 'forceUnder20Mb must be a boolean');
  }
}

// Every pass reads the original source. No pass uses a previously encoded JPEG.
// The caller owns the staging directory and publishes only a successful result.
async function convertWithPolicy(input, type, outputDir, options = {}, onRetry = () => {}) {
  validateCompressionOptions(options);
  const inputSize = fs.statSync(input).size;
  const requestedQuality = options.quality ?? 90;
  const limit = options.forceUnder20Mb ? MAX_OUTPUT_BYTES : null;
  let quality = requestedQuality;
  let compressJpg = !!options.compressJpg;
  if (type === 'jpg') {
    // Compare in MB to avoid rounding an exact decimal threshold down a byte.
    compressJpg = compressJpg && inputSize / MB > (options.compressAboveMb ?? 0);
  }
  let attempts = 0;
  for (;;) {
    const result = await factory.convertByType(input, type, outputDir, {
      ...options,
      compressJpg,
      quality,
      forceType: type
    });
    attempts++;
    if (!result.success) {
      throw new JobError('CONVERSION_FAILED', result.error || 'Conversion failed', input);
    }
    if (!result.outputPath) {
      throw new JobError('CONVERSION_FAILED', 'Conversion produced no output', input);
    }
    // The limit is a postcondition of the normal conversion/copy, independent
    // of source size. Never reduce quality before inspecting the first result.
    const outputSize = fs.statSync(result.outputPath).size;
    if (!outputSize)
      throw new JobError('CONVERSION_FAILED', 'Conversion produced no output', input);
    const copied = result.details?.converted === false || result.converted === false;
    if (!limit || outputSize < limit) {
      return {
        ...result,
        details: {
          ...result.details,
          inputSize,
          outputSize,
          compressionRatio: (1 - outputSize / inputSize) * 100,
          quality: copied ? null : quality,
          attempts,
          method: result.method || result.details?.method || (copied ? 'copy' : 'sharp')
        }
      };
    }
    if (!copied && quality === 1) {
      throw new JobError(
        'OUTPUT_TOO_LARGE',
        `Output is ${outputSize} bytes at quality 1; cannot satisfy the strict limit of less than ${limit} bytes`,
        input
      );
    }
    // For a copied JPG/LIVP JPEG, the first encode uses the configured quality.
    const nextQuality = copied ? requestedQuality : Math.max(1, quality - 5);
    await new Promise((resolve) => setImmediate(resolve));
    if (options.shouldCancel?.()) {
      throw new JobError('CANCELLED', 'Cancelled before the next compression attempt', input);
    }
    onRetry({
      input,
      quality: nextQuality,
      previousQuality: copied ? null : quality,
      outputSize,
      maxOutputBytes: limit
    });
    quality = nextQuality;
    compressJpg = true;
  }
}

module.exports = {
  MB,
  MAX_OUTPUT_BYTES,
  MAX_THRESHOLD_MB,
  validateCompressionOptions,
  convertWithPolicy
};
