const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { runConversionJob } = require('../src/core/batch/conversion-job');
const { ConversionPool } = require('../src/core/workers/conversion-pool');

let root;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'threaded-job-')));
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function populate(folders) {
  const image = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#456789' }
  })
    .png()
    .toBuffer();
  for (let i = 0; i < folders; i++) {
    const dir = path.join(root, `folder-${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'photo.png'), image);
  }
}

it('uses one global four-thread pool across single-image subdirectories', async () => {
  await populate(8);
  const started = new Set();
  const released = new Set();
  const actualRun = ConversionPool.prototype.run;
  jest.spyOn(ConversionPool.prototype, 'run').mockImplementation(function (task, callbacks) {
    // A barrier proves distinct folders are submitted together; the former
    // sequential directory loop cannot reach the fourth dispatch.
    started.add(path.dirname(task.input));
    return new Promise((resolve) => {
      released.add(resolve);
      if (started.size >= 4) for (const release of released) release();
    }).then(() => actualRun.call(this, task, callbacks));
  });
  const result = await runConversionJob([root]);
  expect(result).toMatchObject({ status: 'success', totalFiles: 8, processedFiles: 8 });
  expect(result.execution).toMatchObject({ mode: 'worker_threads', requestedConcurrency: 4 });
  expect(result.execution.peakActive).toBeGreaterThan(1);
  expect(result.execution.peakActive).toBeLessThanOrEqual(4);
  expect(started.size).toBe(8);
  expect(result.groups.map((group) => path.basename(group.directory))).toEqual(
    Array.from({ length: 8 }, (_, i) => `folder-${i}`)
  );
  expect(new Set(result.files.map((file) => file.output)).size).toBe(8);
});

it('keeps real HEIC outputs identical between one and ten requested threads', async () => {
  const fixture = path.join(__dirname, 'fixtures/heic-rotation.heic');
  for (let i = 0; i < 12; i++)
    fs.copyFileSync(fixture, path.join(root, `photo-${String(i).padStart(2, '0')}.heic`));
  const one = await runConversionJob([root], { concurrency: 1 });
  const ten = await runConversionJob([root], { concurrency: 10 });
  expect(one.status).toBe('success');
  expect(ten.status).toBe('success');
  expect(ten.execution.requestedConcurrency).toBe(10);
  expect(ten.execution.peakActive).toBeGreaterThan(1);
  expect(ten.execution.peakActive).toBeLessThanOrEqual(10);
  expect(ten.files).toHaveLength(12);
  for (let i = 0; i < 12; i++)
    expect(fs.readFileSync(ten.files[i].output)).toEqual(fs.readFileSync(one.files[i].output));
});

it('isolates a malformed image and keeps cross-directory outputs and summary correct', async () => {
  await populate(4);
  fs.writeFileSync(path.join(root, 'broken.png'), 'not an image');
  const result = await runConversionJob([root], { concurrency: 10 });
  expect(result).toMatchObject({
    status: 'partial',
    processedFiles: 5,
    convertedFiles: 4,
    failedConversions: 1
  });
  expect(result.files.filter((file) => file.status === 'failed')).toHaveLength(1);
  for (const group of result.groups)
    expect(fs.readdirSync(group.outputDir).some((name) => name.startsWith('.image-to-jpg-'))).toBe(
      false
    );
});

it('reserves output directory names before files regardless of thread scheduling', async () => {
  const input = path.join(root, 'input');
  fs.mkdirSync(path.join(input, 'photo.jpg', 'nested'), { recursive: true });
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(input, 'photo.png'), png);
  fs.writeFileSync(path.join(input, 'photo.jpg', 'nested', 'inside.png'), png);
  for (const concurrency of [1, 10]) {
    const outputDir = path.join(root, `output-${concurrency}`);
    const result = await runConversionJob([input], { concurrency, outputDir });
    expect(result).toMatchObject({ status: 'success', convertedFiles: 2, failedConversions: 0 });
    expect(result.files.map((file) => path.relative(outputDir, file.output))).toEqual([
      'photo_1.jpg',
      path.join('photo.jpg', 'nested', 'inside.jpg')
    ]);
    const repeated = await runConversionJob([input], { concurrency, outputDir, existing: 'skip' });
    expect(repeated).toMatchObject({ status: 'success', skippedFiles: 2, convertedFiles: 0 });
  }
});
