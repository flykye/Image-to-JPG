#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { JobError, errorDetails } = require('../core/services/job-error');
const version = require('../../package.json').version;
const argv = process.argv.slice(2);
const delimiter = argv.indexOf('--');
const flags = delimiter < 0 ? argv : argv.slice(0, delimiter);
const json = flags.includes('--json'),
  jsonl = flags.includes('--jsonl');
let signal = null,
  outputBroken = false,
  queue = Promise.resolve(),
  publicCancelFile;
console.log = (...args) => console.error(...args);
process.stdout.on('error', () => {
  outputBroken = true;
});
const interrupt = () => {
  signal = signal || 'SIGINT';
};
const terminate = () => {
  signal = signal || 'SIGTERM';
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

function cancellation() {
  if (signal || outputBroken) return signal || 'PIPE';
  for (const marker of [publicCancelFile, process.env.IMAGE_TO_JPG_CANCEL_FILE]) {
    if (marker && fs.existsSync(marker)) {
      let value = '';
      try {
        value = fs.readFileSync(marker, 'utf8').trim();
      } catch {
        /* existence is enough */
      }
      return value === 'SIGTERM' ? 'SIGTERM' : 'SIGINT';
    }
  }
  return null;
}

function write(text) {
  return new Promise((resolve, reject) => {
    if (outputBroken) {
      reject(new Error('stdout is closed'));
      return;
    }
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function enqueue(value) {
  queue = queue.then(() => write(`${JSON.stringify(value)}\n`));
  queue.catch(() => {
    outputBroken = true;
  });
}

function emptyResult(status, error = null) {
  return {
    schemaVersion: 1,
    version,
    status,
    inputDirectories: [],
    outputDirectory: null,
    total: 0,
    processed: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    scanComplete: false,
    scanErrors: [],
    warnings: [],
    files: [],
    durationMs: 0,
    error
  };
}

function publicResult(job) {
  return {
    ...emptyResult(job.status),
    inputDirectories: job.inputDirectories,
    outputDirectory: job.outputDirectory,
    total: job.totalFiles,
    processed: job.processedFiles,
    converted: job.convertedFiles,
    skipped: job.skippedFiles,
    failed: job.failedConversions,
    pending: job.totalFiles - job.processedFiles,
    scanComplete: job.scanComplete,
    scanErrors: job.scanErrors,
    warnings: job.warnings,
    durationMs: Math.round(job.duration * 1000),
    execution: job.execution,
    files: job.files.map((file) => ({
      input: file.input,
      output: file.output,
      type: file.type,
      status: file.status,
      error: file.error,
      inputSize: file.details?.inputSize ?? null,
      outputSize: file.details?.outputSize ?? null,
      quality: file.details?.quality ?? null,
      attempts: file.details?.attempts ?? 0
    }))
  };
}

async function main() {
  let result,
    informational = '',
    verbose = false;
  try {
    if (json && jsonl)
      throw new JobError('INVALID_ARGUMENT', '--json and --jsonl are mutually exclusive');
    const { Command, InvalidArgumentError } = require('commander');
    const integer = (label, max) => (value) => {
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > max
      ) {
        throw new InvalidArgumentError(`${label} must be a decimal integer between 1 and ${max}`);
      }
      return Number(value);
    };
    const program = new Command();
    const threshold = (value) => {
      if (
        !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
        !Number.isFinite(Number(value)) ||
        Number(value) > 1_000_000
      ) {
        throw new InvalidArgumentError(
          'Compression threshold must be a decimal number between 0 and 1000000 MB'
        );
      }
      return Number(value);
    };
    program
      .name('batch-image-processor')
      .description('Convert image directories to JPG without a GUI')
      .version(version)
      .argument('<directory>', 'Input directory')
      .option('-v, --verbose', 'Write per-file progress to stderr')
      .option('-r, --recursive', 'Include subdirectories')
      .option('-o, --output-dir <path>', 'Output root; recursive jobs preserve the relative tree')
      .option('-q, --quality <number>', 'JPEG quality (1-100)', integer('Quality', 100), 90)
      .option(
        '-c, --concurrency <number>',
        'Worker threads (1-32); memory protection may reduce simultaneous work',
        integer('Concurrency', 32),
        4
      )
      .option('--compress-jpg', 'Re-encode existing JPG/JPEG instead of copying')
      .option(
        '--compress-above-mb <number>',
        'Compress only JPG/JPEG sources larger than this size in MB; enables JPG compression',
        threshold
      )
      .option(
        '--force-under-20mb',
        'Require output <20 MB; retry the original source with quality reduced by 5'
      )
      .option('-s, --skip-existing', 'Alias for --existing skip')
      .option('--existing <policy>', 'Existing output policy: rename, skip or error')
      .option('--json', 'Write exactly one schemaVersion=1 result to stdout')
      .option('--jsonl', 'Stream JSON events, ending with a result event')
      .option('--cancel-file <path>', 'Stop after in-flight files when this marker exists')
      .configureOutput({
        writeOut: (text) => {
          informational += text;
        },
        writeErr() {}
      })
      .exitOverride()
      .action(async (directory, options) => {
        verbose = !!options.verbose;
        if (options.compressAboveMb !== undefined) options.compressJpg = true;
        const existing = options.existing || (options.skipExisting ? 'skip' : 'rename');
        if (
          !['rename', 'skip', 'error'].includes(existing) ||
          (options.skipExisting && existing !== 'skip')
        )
          throw new JobError('INVALID_ARGUMENT', 'Invalid or conflicting existing-output policy');
        if (options.cancelFile !== undefined) {
          if (!options.cancelFile || options.cancelFile.includes('\0'))
            throw new JobError('INVALID_ARGUMENT', 'Cancellation marker must be a nonempty path');
          publicCancelFile = path.resolve(options.cancelFile);
        }
        const { runConversionJob } = require('../core/batch/conversion-job');
        const emit = (event) => {
          if (jsonl) enqueue({ schemaVersion: 1, ...event });
          if (event.type === 'warning') process.stderr.write(`WARNING: ${event.message}\n`);
          else if (verbose && event.type === 'worker-pool')
            process.stderr.write(`${event.message}\n`);
          else if (event.type === 'error')
            process.stderr.write(
              `${event.file?.error?.code || 'CONVERSION_FAILED'}: ${JSON.stringify(event.file?.input || event.filename)}: ${event.error}\n`
            );
          else if (verbose && event.type === 'processing')
            process.stderr.write(`Processing ${event.fileType}: ${JSON.stringify(event.input)}\n`);
          else if (verbose && event.type === 'compression-retry')
            process.stderr.write(
              `Retrying original ${JSON.stringify(event.input)} at quality ${event.quality}: previous output ${event.outputSize} bytes\n`
            );
          else if (verbose && event.type === 'success')
            process.stderr.write(
              `${event.details?.skipped ? 'Skipped' : 'Created'} ${JSON.stringify(event.outputPath)}\n`
            );
        };
        const job = await runConversionJob(
          [directory],
          {
            ...options,
            existing,
            forceUnder20Mb: !!options.forceUnder20mb,
            recursive: !!options.recursive,
            shouldCancel: () => !!cancellation()
          },
          emit
        );
        result = publicResult(job);
      });
    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (error) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        result = {
          ...emptyResult(error.code === 'commander.version' ? 'version' : 'help'),
          message: informational.trimEnd()
        };
      } else if (error.code?.startsWith('commander.'))
        throw new JobError('INVALID_ARGUMENT', error.message);
      else throw error;
    }
  } catch (error) {
    const details = errorDetails(
      error,
      error.code === 'MODULE_NOT_FOUND' ? 'ENVIRONMENT_ERROR' : 'INTERNAL_ERROR'
    );
    const invalid = details.code.startsWith('INVALID_') || details.code === 'ENVIRONMENT_ERROR';
    result = emptyResult(invalid ? 'invalid' : 'failed', details);
    process.stderr.write(`${details.code}: ${details.message}\n`);
  }
  let exitCode =
    result.status === 'cancelled'
      ? cancellation() === 'SIGTERM'
        ? 143
        : 130
      : result.status === 'invalid'
        ? 2
        : ['failed', 'partial'].includes(result.status)
          ? 1
          : 0;
  try {
    if (jsonl && !json) {
      enqueue({ schemaVersion: 1, type: 'result', result });
      await queue;
    } else if (json) await write(`${JSON.stringify(result)}\n`);
    else if (['help', 'version'].includes(result.status)) await write(`${result.message}\n`);
    else
      await write(
        `${result.status}: ${result.converted} created, ${result.skipped} skipped, ${result.failed} failed, ${result.scanErrors.length} scan errors, ${result.pending} pending\n`
      );
  } catch (error) {
    process.stderr.write(`OUTPUT_STREAM_ERROR: ${error.message}\n`);
    exitCode = 1;
  }
  process.exitCode = outputBroken ? 1 : exitCode;
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
}

main().catch((error) => {
  console.error(`INTERNAL_ERROR: ${error.message}`);
  process.exitCode = 2;
});
