#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { scanDirectory, batchProcessImages } = require('../core/batch');
const { ProgressReporter } = require('../core/services/progress-reporter');

const program = new Command();

program
  .name('batch-image-processor')
  .description('Batch process HEIC, LIVP and PNG files in a directory')
  .version('1.1.0')
  .argument('[directory]', 'Directory path containing images to process')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-s, --skip-existing', 'Skip processing files that already have JPG versions')
  .option('-o, --output-dir <path>', 'Custom output directory')
  .option('-q, --quality <number>', 'JPG output quality (1-100)', parseInt, 95)
  .option('--compress-jpg', 'Compress existing JPG files')
  .action(async (directory, options) => {
    if (!directory) {
      program.help();
      return;
    }

    const targetDirectory = path.resolve(directory);
    const scanResult = scanDirectory(targetDirectory);

    if (!scanResult.success) {
      console.error(`Error: ${scanResult.error}`);
      process.exit(1);
    }

    if (scanResult.files.length === 0) {
      console.log('No supported image files found.');
      process.exit(0);
    }

    const reporter = new ProgressReporter(options.verbose);
    const result = await batchProcessImages(
      scanResult.files,
      targetDirectory,
      reporter,
      {
        outputDir: options.outputDir,
        quality: options.quality,
        compressJpg: options.compressJpg,
        clearExisting: false,
        stats: scanResult.stats
      }
    );

    if (result.stats.failedConversions > 0) {
      process.exit(1);
    }
  });

program.parse();
