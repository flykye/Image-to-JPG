const fs = require('fs');
const path = require('path');
const { factory } = require('../converters');
const { prepareOutputDirectory } = require('../services/file-manager');
const { detectFileType } = require('../services/file-signature');
const { JobError, errorDetails } = require('../services/job-error');
const {
  MAX_OUTPUT_BYTES,
  validateCompressionOptions,
  convertWithPolicy
} = require('../services/compression-policy');
const { planOutputNames, existingJpeg, publishOutput } = require('./output-planner');
const { scanDirectory, scanDirectoryRecursive, scanDirectoryAsync } = require('./scanner');

async function batchProcessImages(files, targetDirectory, progressReporter, options = {}) {
  const quality = options.quality ?? 90,
    concurrency = options.concurrency ?? 4;
  const policy = options.existing || (options.skipExisting ? 'skip' : 'rename');
  let outputDir;
  try {
    validateCompressionOptions(options);
    if (
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 100 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 32 ||
      !['rename', 'skip', 'error'].includes(policy)
    ) {
      throw new JobError(
        'INVALID_ARGUMENT',
        'Invalid quality, concurrency or existing-output policy'
      );
    }
    outputDir = prepareOutputDirectory(options.outputDir, targetDirectory);
  } catch (error) {
    return {
      success: false,
      error: error.message,
      errorDetails: errorDetails(error, 'WRITE_ERROR', options.outputDir || targetDirectory)
    };
  }
  const stats = {
    totalFiles: files.length,
    processedFiles: 0,
    successfulConversions: 0,
    convertedFiles: 0,
    failedConversions: 0,
    skippedFiles: 0,
    errors: [],
    files: [],
    cancelled: false
  };
  const started = Date.now(),
    records = new Array(files.length);
  const detections = new Map(files.map((file) => [file, detectFileType(file)]));
  const types = new Map(
    files.map((file) => [
      file,
      factory.getConverterByType(detections.get(file).type)?.type || 'unknown'
    ])
  );
  const plan = planOutputNames(files, types, options.reservedOutputNames);
  let next = 0;
  progressReporter.logStart(targetDirectory, options.stats || { total: files.length });
  async function work() {
    while (next < files.length) {
      if (options.shouldCancel?.()) {
        stats.cancelled = true;
        return;
      }
      const index = next++,
        input = files[index],
        filename = path.basename(input);
      const type = types.get(input),
        detection = detections.get(input);
      const expected = path.join(outputDir, plan.names.get(input));
      let staging, record;
      try {
        if (detection.error)
          throw new JobError('READ_ERROR', detection.error.message, input, detection.error.code);
        if (detection.warning)
          progressReporter.logWarning(`${filename}: ${detection.warning}`, input);
        if (type === 'unknown')
          throw new JobError('UNSUPPORTED_FORMAT', 'No converter for detected file type', input);
        const onStart = () =>
          progressReporter.logFileProcessing(filename, type, index + 1, files.length, input);
        const onRetry = (event) => progressReporter.logCompressionRetry?.(event);
        const maxBytes = options.forceUnder20Mb ? MAX_OUTPUT_BYTES : null;
        if (policy === 'skip' && existingJpeg(expected, maxBytes)) {
          onStart();
          record = { input, output: expected, type, status: 'skipped', error: null };
          record.details = {
            inputSize: fs.statSync(input).size,
            outputSize: fs.statSync(expected).size,
            quality: null,
            attempts: 0
          };
        } else {
          if (policy === 'error' && fs.existsSync(expected))
            throw new JobError('OUTPUT_EXISTS', 'Output already exists', expected);
          staging = fs.mkdtempSync(path.join(outputDir, '.image-to-jpg-'));
          let result;
          if (options.conversionPool) {
            result = await options.conversionPool.run(
              { input, type, outputDir: staging, options: { ...options, quality } },
              { onStart, onRetry }
            );
          } else {
            onStart();
            result = await convertWithPolicy(
              input,
              type,
              staging,
              { ...options, quality },
              onRetry
            );
          }
          const published = publishOutput(
            result.outputPath,
            expected,
            policy,
            plan.claimed,
            maxBytes
          );
          record = {
            input,
            output: published.output,
            type,
            status: published.skipped ? 'skipped' : 'converted',
            error: null
          };
          record.details = published.skipped
            ? { ...result.details, outputSize: fs.statSync(published.output).size, quality: null }
            : result.details;
        }
        stats.successfulConversions++;
        if (record.status === 'skipped') stats.skippedFiles++;
        else stats.convertedFiles++;
      } catch (error) {
        if (error.code === 'CANCELLED') {
          stats.cancelled = true;
          return;
        }
        const details = errorDetails(error, 'WRITE_ERROR', input);
        record = { input, output: null, type, status: 'failed', error: details };
        stats.failedConversions++;
        stats.errors.push({ filename, error: details.message, code: details.code });
      } finally {
        if (staging) {
          try {
            fs.rmSync(staging, { recursive: true, force: true });
          } catch (error) {
            progressReporter.logWarning(`Temporary cleanup failed: ${error.message}`, staging);
          }
        }
        if (record) {
          records[index] = record;
          stats.processedFiles++;
        }
      }
      if (record.status === 'failed')
        progressReporter.logError(filename, record.error.message, type, 'processing', record);
      else
        progressReporter.logSuccess(
          filename,
          record.output,
          type,
          { ...record.details, skipped: record.status === 'skipped' },
          record
        );
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, work));
  stats.files = records.filter(Boolean);
  stats.cancelled = stats.cancelled || !!options.shouldCancel?.();
  stats.duration = (Date.now() - started) / 1000;
  progressReporter.logSummary();
  return { success: stats.failedConversions === 0 && !stats.cancelled, stats, outputDir };
}

module.exports = { scanDirectory, scanDirectoryRecursive, scanDirectoryAsync, batchProcessImages };
