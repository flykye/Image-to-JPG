const fs = require('fs');
const path = require('path');
const { factory } = require('../converters');
const { detectFileType } = require('../services/file-signature');
const { errorDetails } = require('../services/job-error');
const emptyStats = () => ({ total: 0, heic: 0, livp: 0, png: 0, dng: 0, tiff: 0, jpg: 0 });

// Both drivers consume the same traversal. The async driver yields while scanning
// so a CLI signal/cancellation request can run before conversion begins.
function* scanSteps(dirPath, options = {}) {
  const result = {
    success: true,
    groups: [],
    totalStats: emptyStats(),
    warnings: [],
    scanErrors: [],
    cancelled: false
  };
  const excluded = new Set((options.excludedDirs || []).map((dir) => path.resolve(dir)));
  try {
    if (!fs.statSync(dirPath).isDirectory()) {
      const error = new Error('Path is not a directory');
      error.code = 'ENOTDIR';
      throw error;
    }
    fs.accessSync(dirPath, fs.constants.R_OK);
  } catch (error) {
    return {
      ...result,
      success: false,
      error: `Cannot read directory '${dirPath}': ${error.message}`,
      errorType: 'directory_not_found',
      scanErrors: [errorDetails(error, 'SCAN_ERROR', dirPath)]
    };
  }
  const stack = [path.resolve(dirPath)];
  while (stack.length) {
    if (options.shouldCancel?.()) {
      result.cancelled = true;
      break;
    }
    const current = stack.pop();
    let entries;
    try {
      entries = fs
        .readdirSync(current, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (error) {
      const details = errorDetails(error, 'SCAN_ERROR', current);
      result.scanErrors.push(details);
      result.warnings.push(`Cannot read '${current}': ${error.message}`);
      continue;
    }
    const files = [],
      subdirs = [],
      stats = emptyStats();
    for (const entry of entries) {
      yield;
      if (options.shouldCancel?.()) {
        result.cancelled = true;
        break;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          entry.name.toLowerCase() !== 'jpg' &&
          !entry.name.startsWith('.image-to-jpg-') &&
          !excluded.has(fullPath)
        )
          subdirs.push(fullPath);
      } else if (entry.isFile()) {
        const detection = detectFileType(fullPath);
        const converter = detection.type && factory.getConverterByType(detection.type);
        if (converter) {
          files.push(fullPath);
          stats[converter.type]++;
          stats.total++;
        }
      }
    }
    if (files.length) {
      result.groups.push({ dirPath: current, files, stats });
      for (const key of Object.keys(stats)) result.totalStats[key] += stats[key];
    }
    if (options.recursive !== false) stack.push(...subdirs.reverse());
    yield;
  }
  return result;
}

function scanDirectoryRecursive(dirPath, options = {}) {
  const steps = scanSteps(dirPath, options);
  let step;
  do {
    step = steps.next();
  } while (!step.done);
  return step.value;
}

async function scanDirectoryAsync(dirPath, options = {}) {
  const steps = scanSteps(dirPath, options);
  let step,
    count = 0;
  do {
    step = steps.next();
    if (++count % 64 === 0) await new Promise((resolve) => setImmediate(resolve));
  } while (!step.done);
  return step.value;
}

function scanDirectory(dirPath) {
  const result = scanDirectoryRecursive(dirPath, { recursive: false });
  return result.success
    ? {
        success: true,
        files: result.groups[0]?.files || [],
        stats: result.totalStats,
        warnings: result.warnings,
        scanErrors: result.scanErrors
      }
    : result;
}

module.exports = { emptyStats, scanDirectory, scanDirectoryRecursive, scanDirectoryAsync };
