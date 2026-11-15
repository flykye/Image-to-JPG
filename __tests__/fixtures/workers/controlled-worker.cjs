/* global Atomics, SharedArrayBuffer */
const fs = require('fs');
const path = require('path');
const { parentPort, workerData, threadId } = require('worker_threads');
const cancel = new Int32Array(workerData.cancelBuffer);
parentPort.postMessage({ type: 'ready' });
parentPort.on('message', async ({ id, task }) => {
  const action = path.basename(task.input);
  if (action.startsWith('exit')) process.exit(23);
  if (action.startsWith('malformed')) {
    parentPort.postMessage({ type: 'result', id, result: {} });
    return;
  }
  if (action.startsWith('hang')) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    return;
  }
  if (action.startsWith('cooperative')) {
    fs.writeFileSync(path.join(task.outputDir, 'started'), 'started');
    while (!Atomics.load(cancel, 0)) await new Promise((resolve) => setImmediate(resolve));
    parentPort.postMessage({
      type: 'error',
      id,
      error: { code: 'CANCELLED', message: 'Cancelled', input: task.input }
    });
    return;
  }
  if (action.startsWith('hold')) {
    fs.writeFileSync(path.join(task.outputDir, 'started'), 'started');
    while (!fs.existsSync(path.join(task.outputDir, 'release')))
      await new Promise((resolve) => setImmediate(resolve));
  }
  if (action.startsWith('log')) {
    console.log('worker-stdout-diagnostic');
    console.error('worker-stderr-diagnostic');
  }
  const outputPath = path.join(task.outputDir, 'out.jpg');
  fs.writeFileSync(outputPath, Buffer.from([0xff, 0xd8, 0xff, 1]));
  parentPort.postMessage({
    type: 'retry',
    id,
    event: { input: task.input, quality: 85, outputSize: 20_000_000 }
  });
  parentPort.postMessage({
    type: 'result',
    id,
    result: { success: true, outputPath, workerThreadId: threadId, options: task.options }
  });
});
