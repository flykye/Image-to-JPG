const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { spawnSync } = require('child_process');
const { ConversionPool } = require('../src/core/workers/conversion-pool');
const {
  estimateTaskBytes,
  defaultMemoryBudget,
  MIB
} = require('../src/core/workers/memory-budget');

const workerPath = path.join(__dirname, 'fixtures/workers/controlled-worker.cjs');
const fixture = path.join(__dirname, 'fixtures/heic-rotation.heic');
let root;
const pools = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-pool-'));
});
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function pool(options = {}) {
  const instance = new ConversionPool(options);
  pools.push(instance);
  return instance;
}
function task(name, type = 'png', options = {}) {
  const outputDir = path.join(root, `out-${name}`);
  fs.mkdirSync(outputDir);
  return { input: path.join(root, name), type, outputDir, options };
}
function controlled(options = {}) {
  return pool({ workerPath, estimateMemory: () => 100, memoryBudgetBytes: 1000, ...options });
}
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error('Controlled worker did not reach the requested state');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

it('runs real HEIC and PNG conversions in worker threads, preserves sources and reuses a worker', async () => {
  const p = pool({ concurrency: 2 });
  const a = task('rotated.heic', 'heic', { quality: 80 });
  fs.copyFileSync(fixture, a.input);
  const b = task('photo.png', 'png', { quality: 80 });
  await sharp({ create: { width: 20, height: 16, channels: 4, background: '#55667780' } })
    .png()
    .toFile(b.input);
  const [one, two] = await Promise.all([p.run(a), p.run(b)]);
  expect(one.workerThreadId).toBeGreaterThan(0);
  expect(two.workerThreadId).toBeGreaterThan(0);
  expect(await sharp(one.outputPath).metadata()).toMatchObject({
    width: 200,
    height: 320,
    format: 'jpeg'
  });
  expect((await sharp(two.outputPath).metadata()).format).toBe('jpeg');
  expect(fs.readFileSync(a.input)).toEqual(fs.readFileSync(fixture));
  const c = task('another.png', 'png', { quality: 80 });
  fs.copyFileSync(b.input, c.input);
  const next = await p.run(c);
  expect([one.workerThreadId, two.workerThreadId]).toContain(next.workerThreadId);
  expect(p.stats().workersCreated).toBe(2);
});

it('enforces the global cap across callers and starts queued work only when a worker is free', async () => {
  const p = controlled({ concurrency: 2 });
  const tasks = [task('hold-a'), task('hold-b'), task('last')];
  const started = [];
  const promises = tasks.map((t) => p.run(t, { onStart: () => started.push(t.input) }));
  const all = Promise.allSettled(promises);
  await until(() =>
    tasks.slice(0, 2).every((t) => fs.existsSync(path.join(t.outputDir, 'started')))
  );
  expect(new Set(started)).toEqual(new Set(tasks.slice(0, 2).map((t) => t.input)));
  expect(p.stats().peakActive).toBe(2);
  fs.writeFileSync(path.join(tasks[0].outputDir, 'release'), '');
  await until(() => started.length === 3);
  fs.writeFileSync(path.join(tasks[1].outputDir, 'release'), '');
  expect((await all).every((result) => result.status === 'fulfilled')).toBe(true);
  expect(p.stats().workersCreated).toBe(2);
});

it('only clones approved options and forwards retries', async () => {
  const p = controlled({ concurrency: 1 });
  const request = task('options', 'png', {
    quality: 90,
    compressJpg: true,
    compressAboveMb: 5,
    forceUnder20Mb: true,
    conversionPool: p,
    shouldCancel: () => false,
    arbitrary: 'ignored'
  });
  const retry = jest.fn();
  const result = await p.run(request, { onRetry: retry });
  expect(result.options).toEqual({
    quality: 90,
    compressJpg: true,
    compressAboveMb: 5,
    forceUnder20Mb: true
  });
  expect(retry).toHaveBeenCalledWith(
    expect.objectContaining({ input: request.input, quality: 85 })
  );
});

it('cooperatively cancels an active worker and rejects queued jobs without starting them', async () => {
  let cancelled = false;
  const p = controlled({ concurrency: 1, shouldCancel: () => cancelled, cancelPollMs: 5 });
  const a = task('cooperative-first'),
    b = task('never-started');
  const onStart = jest.fn();
  const all = Promise.allSettled([p.run(a), p.run(b, { onStart })]);
  await until(() => fs.existsSync(path.join(a.outputDir, 'started')));
  cancelled = true;
  const results = await all;
  expect(results.map((r) => r.reason.code)).toEqual(['CANCELLED', 'CANCELLED']);
  expect(onStart).not.toHaveBeenCalled();
  await p.close();
  expect(p.workers.size).toBe(0);
});

it('lets an already active conversion finish during graceful cancellation', async () => {
  let cancelled = false;
  const p = controlled({ concurrency: 1, shouldCancel: () => cancelled, cancelPollMs: 5 });
  const a = task('hold-finish'),
    b = task('not-started');
  const all = Promise.allSettled([p.run(a), p.run(b)]);
  await until(() => fs.existsSync(path.join(a.outputDir, 'started')));
  cancelled = true;
  await until(() => p.cancelled);
  fs.writeFileSync(path.join(a.outputDir, 'release'), '');
  const results = await all;
  expect(results[0].status).toBe('fulfilled');
  expect(results[1].reason.code).toBe('CANCELLED');
});

it('terminates an unresponsive conversion before rejecting cancellation and freeing staging ownership', async () => {
  let cancelled = false;
  const p = controlled({
    concurrency: 1,
    shouldCancel: () => cancelled,
    cancelPollMs: 5,
    cancelGraceMs: 25
  });
  const request = task('hang-cancel');
  const result = p.run(request).catch((error) => error);
  await until(() => p.stats().peakActive === 1);
  cancelled = true;
  expect((await result).code).toBe('CANCELLED');
  expect(p.workers.size).toBe(0);
  fs.rmSync(request.outputDir, { recursive: true });
});

it('recovers from worker exit for subsequent tasks without losing attribution', async () => {
  const p = controlled({ concurrency: 1 });
  const bad = task('exit-now'),
    good = task('good-after-exit');
  const results = await Promise.allSettled([p.run(bad), p.run(good)]);
  expect(results[0].reason).toMatchObject({ code: 'WORKER_ERROR', input: bad.input });
  expect(results[1].status).toBe('fulfilled');
  expect(p.stats().workersCreated).toBe(2);
});

it('rejects malformed worker responses and replaces the broken worker', async () => {
  const p = controlled({ concurrency: 1 });
  const results = await Promise.allSettled([
    p.run(task('malformed-result')),
    p.run(task('valid-after'))
  ]);
  expect(results[0].reason.code).toBe('WORKER_ERROR');
  expect(results[1].status).toBe('fulfilled');
});

it('ends repeated startup failures without retrying indefinitely', async () => {
  const p = controlled({
    concurrency: 1,
    workerPath: path.join(root, 'missing-worker.cjs'),
    maxStartupFailures: 2
  });
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => p.run(task(`startup-${i}`)))
  );
  expect(results.every((r) => r.reason?.code === 'WORKER_ERROR')).toBe(true);
  expect(p.stats().workersCreated).toBe(2);
});

it('times out startup and active work and can process the next task after an active timeout', async () => {
  const neverReady = controlled({
    concurrency: 1,
    workerPath: path.join(__dirname, 'fixtures/workers/no-ready-worker.cjs'),
    startupTimeoutMs: 50,
    maxStartupFailures: 1
  });
  expect((await neverReady.run(task('startup-timeout')).catch((error) => error)).code).toBe(
    'WORKER_ERROR'
  );
  const p = controlled({ concurrency: 1, taskTimeoutMs: 50 });
  await expect(p.run(task('hang-timeout'))).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
  p.taskTimeoutMs = 3000;
  expect((await p.run(task('healthy'))).success).toBe(true);
});

it('reduces the effective cap within the memory budget and reports it once', async () => {
  const warning = jest.fn(),
    state = jest.fn();
  const p = controlled({
    concurrency: 4,
    memoryBudgetBytes: 250,
    estimateMemory: () => 100,
    onWarning: warning,
    onState: state
  });
  const tasks = [task('hold-memory-a'), task('hold-memory-b'), task('memory-last')];
  const all = Promise.all(tasks.map((t) => p.run(t)));
  await until(() =>
    tasks.slice(0, 2).every((t) => fs.existsSync(path.join(t.outputDir, 'started')))
  );
  expect(p.stats()).toMatchObject({ effectiveConcurrency: 2, peakActive: 2, memoryLimited: true });
  expect(warning).toHaveBeenCalledTimes(1);
  expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveConcurrency: 2 }));
  for (const t of tasks.slice(0, 2)) fs.writeFileSync(path.join(t.outputDir, 'release'), '');
  await all;
});

it('recycles idle high-water allocations before admitting a larger image', async () => {
  const p = controlled({
    concurrency: 2,
    memoryBudgetBytes: 1000,
    estimateMemory: (t) => (path.basename(t.input).startsWith('big') ? 700 : 400)
  });
  const small = [task('hold-small-a'), task('hold-small-b')];
  const all = Promise.all(small.map((t) => p.run(t)));
  await until(() => small.every((t) => fs.existsSync(path.join(t.outputDir, 'started'))));
  for (const t of small) fs.writeFileSync(path.join(t.outputDir, 'release'), '');
  await all;
  const result = await p.run(task('big-next'));
  expect(result.success).toBe(true);
  expect(p.stats().effectiveConcurrency).toBe(1);
  expect(p.workers.size).toBe(1);
  expect([...p.workers][0].reservedBytes).toBe(700);
});

it('rejects a task larger than its budget without creating a worker', async () => {
  const p = controlled({ memoryBudgetBytes: 200, estimateMemory: () => 201 });
  const start = jest.fn();
  expect((await p.run(task('oversized'), { onStart: start }).catch((error) => error)).code).toBe(
    'RESOURCE_LIMIT'
  );
  expect(start).not.toHaveBeenCalled();
  expect(p.stats().workersCreated).toBe(0);
});

it('uses header dimensions for known images, conservative unknown estimates and a bounded default budget', async () => {
  const known = task('known.png');
  await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } })
    .png()
    .toFile(known.input);
  expect(await estimateTaskBytes(known)).toBe(
    64 * MIB + 20 * 10 * 16 + fs.statSync(known.input).size * 2
  );
  const unknown = task('unknown.livp', 'livp');
  fs.writeFileSync(unknown.input, 'not-a-zip');
  expect(await estimateTaskBytes(unknown)).toBeGreaterThanOrEqual(512 * MIB);
  expect(defaultMemoryBudget()).toBeGreaterThanOrEqual(256 * MIB);
  expect(defaultMemoryBudget()).toBeLessThanOrEqual(16 * 1024 * MIB);
  await expect(estimateTaskBytes(task('missing.png'))).rejects.toMatchObject({
    code: 'READ_ERROR'
  });
});

it('close rejects active/queued work and is idempotent', async () => {
  const p = controlled({ concurrency: 1 });
  const all = Promise.allSettled([p.run(task('hang-close')), p.run(task('queued-close'))]);
  await until(() => p.stats().peakActive === 1);
  await p.close();
  expect((await all).map((r) => r.reason.code)).toEqual(['CANCELLED', 'CANCELLED']);
  await p.close();
  expect(p.workers.size).toBe(0);
  await expect(p.run(task('after-close'))).rejects.toMatchObject({ code: 'CANCELLED' });
});

it('isolates conversion errors and leaves the worker available for the next image', async () => {
  const p = pool({ concurrency: 1 });
  const bad = task('broken.png');
  fs.writeFileSync(bad.input, 'invalid');
  await expect(p.run(bad)).rejects.toMatchObject({ code: 'CONVERSION_FAILED', input: bad.input });
  const good = task('good.png');
  await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } })
    .png()
    .toFile(good.input);
  expect((await p.run(good)).success).toBe(true);
  expect(p.stats().workersCreated).toBe(1);
});

it('keeps ten workers diagnostics off stdout without global listener warnings or leaked handles', () => {
  const modulePath = require.resolve('../src/core/workers/conversion-pool');
  const requests = Array.from({ length: 10 }, (_, index) => task(`log-diagnostics-${index}`));
  const script = `const {ConversionPool}=require(${JSON.stringify(modulePath)});(async()=>{const pool=new ConversionPool({concurrency:10,workerPath:${JSON.stringify(workerPath)},estimateMemory:()=>100});try{await Promise.all(${JSON.stringify(requests)}.map(task=>pool.run(task)));console.log('manager-result');}finally{await pool.close();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout.trim()).toBe('manager-result');
  expect(child.stderr).toContain('worker-stdout-diagnostic');
  expect(child.stderr).toContain('worker-stderr-diagnostic');
  expect(child.stderr).not.toContain('MaxListenersExceededWarning');
});
