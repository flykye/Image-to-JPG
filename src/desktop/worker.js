// One request per process; stdout is exclusively newline-delimited JSON.
const fs = require('fs');
const readline = require('readline');
const { runConversionJob } = require('../core/batch/conversion-job');
const { isImageMagickAvailable } = require('../core/services/conversion-helpers');

async function run(request, emit) {
  if (request.action === 'dependencies') return { imageMagick: await isImageMagickAvailable() };
  if (request.action !== 'process') throw new Error('Unknown worker action');
  const result = await runConversionJob(
    request.paths,
    {
      ...request.options,
      recursive: true,
      shouldCancel: () => !!request.cancelFile && fs.existsSync(request.cancelFile)
    },
    emit
  );
  // The GUI uses streamed per-file events. Keep its final frame bounded instead
  // of copying the public CLI's potentially large file list into the WebView.
  delete result.files;
  delete result.warnings;
  return result;
}

if (require.main === module) {
  console.log = (...args) => console.error(...args);
  const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const input = readline.createInterface({ input: process.stdin });
  input.once('line', async (line) => {
    input.close();
    try {
      emit({ type: 'result', result: await run(JSON.parse(line), emit) });
    } catch (error) {
      emit({ type: 'fatal-error', error: error.message });
      process.exitCode = 1;
    }
  });
}
module.exports = { run };
