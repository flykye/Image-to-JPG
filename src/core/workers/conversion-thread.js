/* global Atomics */
const { parentPort, workerData, threadId } = require('worker_threads');
const { convertWithPolicy } = require('../services/compression-policy');
const { JobError, errorDetails } = require('../services/job-error');

// stdout belongs to the public CLI protocol in the manager process.
console.log = (...args) => console.error(...args);
const cancel = new Int32Array(workerData.cancelBuffer);
let busy = false;

parentPort.on('message', async (message) => {
  if (message.type !== 'run' || busy) {
    throw new Error('Invalid conversion worker request');
  }
  busy = true;
  const { id, task } = message;
  try {
    if (Atomics.load(cancel, 0)) throw new JobError('CANCELLED', 'Task cancelled', task.input);
    const result = await convertWithPolicy(
      task.input,
      task.type,
      task.outputDir,
      { ...task.options, shouldCancel: () => !!Atomics.load(cancel, 0) },
      (event) => parentPort.postMessage({ type: 'retry', id, event })
    );
    parentPort.postMessage({ type: 'result', id, result: { ...result, workerThreadId: threadId } });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      id,
      error: errorDetails(error, 'CONVERSION_FAILED', task.input)
    });
  } finally {
    busy = false;
  }
});
parentPort.postMessage({ type: 'ready' });
