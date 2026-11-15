/* global Atomics, SharedArrayBuffer */
const { Worker } = require('worker_threads');
const { PassThrough } = require('stream');
const { JobError } = require('../services/job-error');
const { defaultMemoryBudget, estimateTaskBytes } = require('./memory-budget');

const OPTION_KEYS = ['quality', 'compressJpg', 'compressAboveMb', 'forceUnder20Mb'];

class ConversionPool {
  constructor({
    concurrency = 4,
    shouldCancel = () => false,
    onWarning = () => {},
    onState = () => {},
    workerPath = require.resolve('./conversion-thread'),
    memoryBudgetBytes = defaultMemoryBudget(),
    estimateMemory = estimateTaskBytes,
    startupTimeoutMs = 30_000,
    taskTimeoutMs = 300_000,
    cancelGraceMs = 10_000,
    cancelPollMs = 50,
    maxStartupFailures = 3
  } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
      throw new JobError('INVALID_ARGUMENT', 'Worker concurrency must be an integer from 1 to 32');
    }
    if (!Number.isFinite(memoryBudgetBytes) || memoryBudgetBytes <= 0) {
      throw new JobError('INVALID_ARGUMENT', 'Worker memory budget must be positive');
    }
    this.requestedConcurrency = concurrency;
    this.effectiveConcurrency = concurrency;
    this.memoryBudgetBytes = memoryBudgetBytes;
    this.shouldCancel = shouldCancel;
    this.onWarning = onWarning;
    this.onState = onState;
    this.workerPath = workerPath;
    this.estimateMemory = estimateMemory;
    this.startupTimeoutMs = startupTimeoutMs;
    this.taskTimeoutMs = taskTimeoutMs;
    this.cancelGraceMs = cancelGraceMs;
    this.maxStartupFailures = maxStartupFailures;
    this.startupFailures = 0;
    this.queue = [];
    this.workers = new Set();
    this.cancelBuffer = new SharedArrayBuffer(4);
    this.cancelView = new Int32Array(this.cancelBuffer);
    this.nextId = 0;
    this.peakActive = 0;
    this.workersCreated = 0;
    this.memoryLimited = false;
    this.closed = false;
    this.cancelled = false;
    this.pumpQueued = false;
    this.estimating = false;
    this.unavailableError = null;
    this.diagnostics = new PassThrough();
    this.diagnostics.setMaxListeners(concurrency * 2 + 5);
    this.diagnostics.pipe(process.stderr, { end: false });
    this.pollTimer = setInterval(() => this._checkCancellation(), cancelPollMs);
    this.pollTimer.unref();
    this._state(`已启用最多 ${concurrency} 个工作线程`);
  }

  stats() {
    return {
      mode: 'worker_threads',
      requestedConcurrency: this.requestedConcurrency,
      effectiveConcurrency: this.effectiveConcurrency,
      peakActive: this.peakActive,
      workersCreated: this.workersCreated,
      memoryBudgetMb: Math.floor(this.memoryBudgetBytes / 1_000_000),
      memoryLimited: this.memoryLimited
    };
  }

  run(task, { onStart = () => {}, onRetry = () => {} } = {}) {
    this._checkCancellation();
    if (this.closed || this.cancelled) return Promise.reject(this._cancelError(task.input));
    if (this.unavailableError)
      return Promise.reject(this._workerError(task.input, this.unavailableError));
    // Never clone callers' pool instances, emitters or cancellation functions.
    const options = {};
    for (const key of OPTION_KEYS)
      if (task.options?.[key] !== undefined) options[key] = task.options[key];
    const request = { input: task.input, type: task.type, outputDir: task.outputDir, options };
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: ++this.nextId,
        task: request,
        onStart,
        onRetry,
        resolve,
        reject,
        cost: null,
        settled: false
      });
      this._schedule();
    });
  }

  _cancelError(input) {
    return new JobError('CANCELLED', 'Conversion cancelled before completion', input);
  }

  _workerError(input, reason) {
    return new JobError('WORKER_ERROR', reason?.message || String(reason), input, reason?.code);
  }

  _notify(callback, value) {
    try {
      callback(value);
    } catch {
      /* Observers cannot break worker lifecycle cleanup. */
    }
  }

  _state(message) {
    this._notify(this.onState, { ...this.stats(), message });
  }

  _settle(job, error, result) {
    if (!job || job.settled) return;
    job.settled = true;
    if (error) job.reject(error);
    else job.resolve(result);
  }

  _schedule() {
    if (this.pumpQueued || this.closed) return;
    this.pumpQueued = true;
    queueMicrotask(() => {
      this.pumpQueued = false;
      this._pump();
    });
  }

  _checkCancellation() {
    if (this.cancelled || this.closed) return;
    let cancelled;
    try {
      cancelled = this.shouldCancel();
    } catch (error) {
      this._disable(error);
      return;
    }
    if (!cancelled) return;
    this.cancelled = true;
    Atomics.store(this.cancelView, 0, 1);
    for (const job of this.queue.splice(0)) this._settle(job, this._cancelError(job.task.input));
    for (const entry of this.workers) {
      if (entry.state === 'busy') {
        entry.cancelTimer = setTimeout(() => {
          this._retire(entry, this._cancelError(entry.job?.task.input));
        }, this.cancelGraceMs);
      } else if (entry.state !== 'stopping') {
        this._retire(entry, this._cancelError(entry.job?.task.input));
      }
    }
  }

  _disable(reason) {
    this.unavailableError = reason instanceof Error ? reason : new Error(String(reason));
    for (const job of this.queue.splice(0))
      this._settle(job, this._workerError(job.task.input, reason));
  }

  _pump() {
    this._checkCancellation();
    if (this.closed || this.cancelled || this.unavailableError) return;
    while (this.queue.length) {
      const job = this.queue[0];
      if (job.settled) {
        this.queue.shift();
        continue;
      }
      if (job.cost === null) {
        if (!this.estimating) this._estimate(job);
        return;
      }
      const idle = [...this.workers]
        .filter((entry) => entry.state === 'idle')
        .sort((a, b) => b.reservedBytes - a.reservedBytes);
      if (this.workers.size > this.effectiveConcurrency && idle.length) {
        this._retire(idle[0]);
        return;
      }
      const reserved = [...this.workers].reduce((sum, entry) => sum + entry.reservedBytes, 0);
      const reusable = idle.find(
        (entry) => reserved + Math.max(0, job.cost - entry.reservedBytes) <= this.memoryBudgetBytes
      );
      if (reusable) {
        this.queue.shift();
        reusable.reservedBytes = Math.max(reusable.reservedBytes, job.cost);
        this._dispatch(reusable, job);
        continue;
      }
      if (
        this.workers.size < this.effectiveConcurrency &&
        reserved + job.cost <= this.memoryBudgetBytes
      ) {
        this.queue.shift();
        this._spawn(job);
        continue;
      }
      // WASM/native allocations can remain after a large image. Keep their
      // reservation until that idle worker has actually terminated.
      if (idle.length) this._retire(idle[0]);
      return;
    }
  }

  _estimate(job) {
    this.estimating = true;
    Promise.resolve()
      .then(() => this.estimateMemory(job.task))
      .then((cost) => {
        if (job.settled || this.closed || this.cancelled) return;
        if (!Number.isFinite(cost) || cost <= 0 || cost > this.memoryBudgetBytes) {
          this.memoryLimited = true;
          this._settle(
            job,
            new JobError(
              'RESOURCE_LIMIT',
              `Estimated image memory ${Math.ceil(cost / 1_000_000)} MB exceeds this task's ${Math.floor(this.memoryBudgetBytes / 1_000_000)} MB budget`,
              job.task.input
            )
          );
          return;
        }
        job.cost = cost;
        const allowed = Math.max(
          1,
          Math.min(this.requestedConcurrency, Math.floor(this.memoryBudgetBytes / cost))
        );
        if (allowed < this.effectiveConcurrency) {
          this.memoryLimited = true;
          this.effectiveConcurrency = allowed;
          const message = `内存保护：根据图片尺寸，本任务最多使用 ${allowed} 个工作线程（请求 ${this.requestedConcurrency}，预算 ${Math.floor(this.memoryBudgetBytes / 1_000_000)} MB）`;
          this._notify(this.onWarning, message);
          this._state(message);
        }
      })
      .catch((error) => {
        this._settle(
          job,
          error instanceof JobError ? error : this._workerError(job.task.input, error)
        );
      })
      .finally(() => {
        this.estimating = false;
        this._schedule();
      });
  }

  _spawn(job) {
    let worker;
    try {
      worker = new Worker(this.workerPath, {
        workerData: { cancelBuffer: this.cancelBuffer },
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 256 }
      });
    } catch (error) {
      this._settle(job, this._workerError(job.task.input, error));
      this._startupFailure(error);
      this._schedule();
      return;
    }
    const entry = { worker, state: 'starting', job, reservedBytes: job.cost, ready: false };
    this.workers.add(entry);
    this.workersCreated++;
    worker.stdout.pipe(this.diagnostics, { end: false });
    worker.stderr.pipe(this.diagnostics, { end: false });
    entry.startTimer = setTimeout(
      () => this._failed(entry, new Error('Conversion worker startup timed out')),
      this.startupTimeoutMs
    );
    worker.on('message', (message) => this._message(entry, message));
    worker.on('messageerror', (error) => this._failed(entry, error));
    worker.on('error', (error) => this._failed(entry, error));
    worker.on('exit', (code) => {
      if (entry.state !== 'stopping')
        this._failed(entry, new Error(`Conversion worker exited unexpectedly (${code})`));
    });
  }

  _startupFailure(error) {
    if (++this.startupFailures >= this.maxStartupFailures) this._disable(error);
  }

  _failed(entry, error) {
    if (entry.state === 'stopping') return;
    if (!entry.ready) this._startupFailure(error);
    const failure =
      this.cancelled || this.closed
        ? this._cancelError(entry.job?.task.input)
        : this._workerError(entry.job?.task.input, error);
    this._retire(entry, failure);
  }

  _dispatch(entry, job) {
    this._checkCancellation();
    if (this.closed || this.cancelled) {
      this._settle(job, this._cancelError(job.task.input));
      this._retire(entry);
      return;
    }
    entry.job = job;
    entry.state = 'busy';
    this.peakActive = Math.max(
      this.peakActive,
      [...this.workers].filter((item) => item.state === 'busy').length
    );
    entry.taskTimer = setTimeout(
      () =>
        this._retire(
          entry,
          new JobError('WORKER_TIMEOUT', 'Image conversion exceeded its time limit', job.task.input)
        ),
      this.taskTimeoutMs
    );
    try {
      job.onStart();
      // A processing observer can itself request cancellation. The task is now
      // active, and the shared flag lets its worker stop safely before decoding.
      this._checkCancellation();
      entry.worker.postMessage({ type: 'run', id: job.id, task: job.task });
    } catch (error) {
      this._retire(entry, this._workerError(job.task.input, error));
    }
  }

  _message(entry, message) {
    if (entry.state === 'stopping' || this.closed) return;
    if (message?.type === 'ready' && entry.state === 'starting') {
      clearTimeout(entry.startTimer);
      entry.ready = true;
      this.startupFailures = 0;
      this._dispatch(entry, entry.job);
      return;
    }
    const job = entry.job;
    if (!job || entry.state !== 'busy' || message?.id !== job.id) {
      this._failed(entry, new Error('Invalid conversion worker response'));
      return;
    }
    if (message.type === 'retry') {
      try {
        job.onRetry(message.event);
      } catch (error) {
        this._failed(entry, error);
      }
      return;
    }
    if (message.type !== 'result' && message.type !== 'error') {
      this._failed(entry, new Error('Unknown conversion worker response'));
      return;
    }
    if (
      message.type === 'result' &&
      (message.result?.success !== true ||
        typeof message.result.outputPath !== 'string' ||
        !message.result.outputPath)
    ) {
      this._failed(entry, new Error('Invalid conversion worker result'));
      return;
    }
    clearTimeout(entry.taskTimer);
    clearTimeout(entry.cancelTimer);
    entry.job = null;
    entry.state = 'idle';
    if (message.type === 'error') {
      const error = message.error || {};
      this._settle(
        job,
        new JobError(
          error.code || 'CONVERSION_FAILED',
          error.message || 'Worker conversion failed',
          error.input || job.task.input,
          error.systemCode
        )
      );
    } else {
      this._settle(job, null, message.result);
    }
    this._schedule();
  }

  _retire(entry, error = null) {
    if (entry.stopPromise) return entry.stopPromise;
    const job = entry.job;
    entry.state = 'stopping';
    clearTimeout(entry.startTimer);
    clearTimeout(entry.taskTimer);
    clearTimeout(entry.cancelTimer);
    entry.stopPromise = (async () => {
      try {
        await entry.worker.terminate();
      } catch {
        /* exit already occurred */
      }
      entry.worker.stdout.unpipe(this.diagnostics);
      entry.worker.stderr.unpipe(this.diagnostics);
      this.workers.delete(entry);
      if (job) this._settle(job, error || this._cancelError(job.task.input));
      this._schedule();
    })();
    return entry.stopPromise;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    clearInterval(this.pollTimer);
    Atomics.store(this.cancelView, 0, 1);
    for (const job of this.queue.splice(0)) this._settle(job, this._cancelError(job.task.input));
    this.closePromise = Promise.all(
      [...this.workers].map((entry) =>
        this._retire(entry, this._cancelError(entry.job?.task.input))
      )
    ).then(() => {
      this.diagnostics.unpipe(process.stderr);
      this.diagnostics.destroy();
    });
    return this.closePromise;
  }
}

module.exports = { ConversionPool };
