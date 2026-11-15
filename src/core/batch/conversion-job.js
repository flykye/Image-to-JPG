const fs = require('fs');
const path = require('path');
const { batchProcessImages, scanDirectoryAsync } = require('./index');
const { emptyStats } = require('./scanner');
const { JobError } = require('../services/job-error');
const { validateCompressionOptions } = require('../services/compression-policy');
const { ConversionPool } = require('../workers/conversion-pool');

function canonicalOutput(value) {
  let current = path.resolve(value);
  const missing = [];
  for (;;) {
    try {
      const resolved = fs.realpathSync(current);
      if (!fs.statSync(resolved).isDirectory())
        throw new JobError('INVALID_OUTPUT', 'Output path or ancestor is not a directory', current);
      return path.join(resolved, ...missing);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function runConversionJob(paths, options = {}, emit = () => {}) {
  validateCompressionOptions(options);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32)
    throw new JobError(
      'INVALID_ARGUMENT',
      'Worker concurrency must be an integer between 1 and 32'
    );
  const began = Date.now(),
    shouldCancel = options.shouldCancel || (() => false);
  if (!Array.isArray(paths) || !paths.length)
    throw new JobError('INVALID_ARGUMENT', 'At least one input directory is required');
  const roots = [
    ...new Set(
      paths.map((input) => {
        if (typeof input !== 'string' || !input || input.includes('\0'))
          throw new JobError('INVALID_ARGUMENT', 'Input directory must be a nonempty path');
        try {
          const resolved = fs.realpathSync(path.resolve(input));
          if (!fs.statSync(resolved).isDirectory())
            throw new JobError('INVALID_INPUT', 'Input is not a directory', input);
          return resolved;
        } catch (error) {
          if (error instanceof JobError) throw error;
          throw new JobError(
            ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'INVALID_INPUT' : 'SCAN_ERROR',
            error.message,
            path.resolve(input),
            error.code
          );
        }
      })
    )
  ];
  let outputRoot = null;
  if (options.outputDir !== undefined) {
    if (
      typeof options.outputDir !== 'string' ||
      !options.outputDir ||
      options.outputDir.includes('\0')
    )
      throw new JobError('INVALID_OUTPUT', 'Output directory must be a nonempty path');
    try {
      outputRoot = canonicalOutput(options.outputDir);
    } catch (error) {
      throw error instanceof JobError
        ? error
        : new JobError('INVALID_OUTPUT', error.message, options.outputDir, error.code);
    }
    if (roots.includes(outputRoot))
      throw new JobError(
        'INVALID_OUTPUT',
        'Output directory must differ from the input directory',
        outputRoot
      );
  }
  const groups = [],
    seen = new Set(),
    totalStats = emptyStats(),
    scanErrors = [],
    warnings = [];
  const warn = (message, input = null) => {
    warnings.push({ code: 'WARNING', input, message });
    emit({ type: 'warning', message, input });
  };
  emit({ type: 'scanning' });
  let scanCancelled = false;
  for (const [rootIndex, root] of roots.entries()) {
    if (shouldCancel()) {
      scanCancelled = true;
      break;
    }
    const scanned = await scanDirectoryAsync(root, {
      recursive: options.recursive !== false,
      excludedDirs: outputRoot ? [outputRoot] : [],
      shouldCancel
    });
    scanCancelled = scanCancelled || scanned.cancelled;
    for (const error of scanned.scanErrors) {
      scanErrors.push(error);
      emit({ type: 'warning', message: error.message, input: error.input, errorCode: error.code });
    }
    for (const group of scanned.groups) {
      const key = fs.realpathSync(group.dirPath);
      if (seen.has(key)) continue;
      seen.add(key);
      const relative = path.relative(root, group.dirPath);
      group.outputDir = outputRoot
        ? path.join(outputRoot, ...(roots.length > 1 ? [`input-${rootIndex + 1}`] : []), relative)
        : path.join(group.dirPath, 'jpg');
      groups.push(group);
      for (const type of Object.keys(totalStats)) totalStats[type] += group.stats[type];
    }
  }
  emit({ type: 'start', totalStats, groupCount: groups.length });
  // A source directory may be named photo.jpg. Reserve the entire output
  // directory tree before any image can claim one of those names as a file.
  const reservedDirectories = new Map();
  if (outputRoot) {
    for (const group of groups) {
      let directory = group.outputDir;
      while (directory !== outputRoot) {
        const parent = path.dirname(directory);
        if (parent === directory) break;
        if (!reservedDirectories.has(parent)) reservedDirectories.set(parent, new Set());
        reservedDirectories.get(parent).add(path.basename(directory));
        directory = parent;
      }
    }
  }
  const summary = {
    status: 'success',
    totalFiles: totalStats.total,
    processedFiles: 0,
    successfulConversions: 0,
    convertedFiles: 0,
    failedConversions: 0,
    skippedFiles: 0,
    duration: 0,
    cancelled: false,
    groups: [],
    files: [],
    scanErrors,
    warnings,
    inputDirectories: roots,
    outputDirectory: outputRoot,
    scanComplete: !scanErrors.length && !scanCancelled
  };
  const conversionPool = new ConversionPool({
    concurrency,
    shouldCancel,
    onWarning: (message) => warn(message),
    onState: (state) => emit({ type: 'worker-pool', ...state })
  });
  const completedGroups = new Array(groups.length);
  let nextGroup = 0;
  async function processGroup(group, index) {
    emit({ type: 'group-start', directory: group.dirPath, groupIndex: index });
    const reporter = {
      logStart() {},
      logSummary() {},
      logFileProcessing(filename, fileType, current, total, input) {
        emit({ type: 'processing', filename, fileType, input });
      },
      logSuccess(filename, outputPath, fileType, details, file) {
        emit({ type: 'success', filename, outputPath, fileType, details, file });
      },
      logError(filename, error, fileType, operation, file) {
        emit({ type: 'error', filename, error, fileType, file });
      },
      logWarning: warn,
      logCompressionRetry(event) {
        emit({ type: 'compression-retry', ...event });
      }
    };
    let result = await batchProcessImages(group.files, group.dirPath, reporter, {
      ...options,
      concurrency,
      conversionPool,
      reservedOutputNames: [...(reservedDirectories.get(group.outputDir) || [])],
      outputDir: group.outputDir,
      stats: group.stats,
      shouldCancel
    });
    if (!result.stats) {
      const error = result.errorDetails;
      result = {
        outputDir: group.outputDir,
        stats: {
          totalFiles: group.files.length,
          processedFiles: group.files.length,
          successfulConversions: 0,
          convertedFiles: 0,
          failedConversions: group.files.length,
          skippedFiles: 0,
          duration: 0,
          files: group.files.map((input) => ({
            input,
            output: null,
            type: null,
            status: 'failed',
            error
          }))
        }
      };
      for (const file of result.stats.files)
        reporter.logError(path.basename(file.input), error.message, 'unknown', 'processing', file);
    }
    const files = result.stats.files;
    const groupStats = { ...result.stats };
    delete groupStats.files;
    delete groupStats.errors;
    const groupResult = { directory: group.dirPath, outputDir: result.outputDir, ...groupStats };
    completedGroups[index] = { group: groupResult, files };
    for (const key of [
      'processedFiles',
      'successfulConversions',
      'convertedFiles',
      'failedConversions',
      'skippedFiles'
    ])
      summary[key] += result.stats[key];
    emit({ type: 'group-done', group: groupResult });
  }
  async function groupWorker() {
    while (nextGroup < groups.length && !shouldCancel()) {
      const index = nextGroup++;
      await processGroup(groups[index], index);
    }
  }
  try {
    // Bounded group lookahead fills the one global pool even when folders each
    // contain only one image. The pool, not the number of groups, caps threads.
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, groups.length) }, groupWorker)
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  } finally {
    await conversionPool.close();
  }
  summary.execution = conversionPool.stats();
  for (const completed of completedGroups) {
    if (!completed) continue;
    summary.groups.push(completed.group);
    summary.files.push(...completed.files);
  }
  const processed = new Set(summary.files.map((file) => file.input));
  for (const group of groups)
    for (const input of group.files)
      if (!processed.has(input))
        summary.files.push({ input, output: null, type: null, status: 'pending', error: null });
  summary.cancelled = !!shouldCancel();
  summary.duration = (Date.now() - began) / 1000;
  summary.status = summary.cancelled
    ? 'cancelled'
    : scanErrors.length || summary.failedConversions
      ? summary.successfulConversions
        ? 'partial'
        : 'failed'
      : summary.totalFiles
        ? 'success'
        : 'no_files';
  return summary;
}

module.exports = { runConversionJob };
