const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const { factory } = require('../src/core/converters');
const { convertWithPolicy, MAX_OUTPUT_BYTES } = require('../src/core/services/compression-policy');
const { runConversionJob } = require('../src/core/batch/conversion-job');
const { ConversionPool } = require('../src/core/workers/conversion-pool');

let root, input, output;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jpg-policy-'));
  input = path.join(root, 'source.jpg');
  output = path.join(root, 'output');
  fs.mkdirSync(output);
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const jpeg = () =>
  sharp({ create: { width: 32, height: 24, channels: 3, background: '#567890' } })
    .jpeg({ quality: 95 })
    .toBuffer();
function fakeJpeg(file, size) {
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
  fs.truncateSync(file, size);
}

it('copies JPG at the exact threshold and only recompresses strictly above it', async () => {
  const original = await jpeg();
  fs.writeFileSync(input, original);
  const threshold = original.length / 1_000_000;
  const copied = await convertWithPolicy(input, 'jpg', output, {
    compressJpg: true,
    compressAboveMb: threshold,
    quality: 60
  });
  expect(fs.readFileSync(copied.outputPath)).toEqual(original);
  expect(copied.details).toMatchObject({ quality: null, attempts: 1, inputSize: original.length });
  const encoded = await convertWithPolicy(input, 'jpg', output, {
    compressJpg: true,
    compressAboveMb: threshold - 0.000001,
    quality: 60
  });
  expect(encoded.details.quality).toBe(60);
  expect(fs.readFileSync(encoded.outputPath)).not.toEqual(original);
  expect(fs.readFileSync(input)).toEqual(original);
});

it('does not apply the JPG threshold to PNG conversion quality', async () => {
  input = path.join(root, 'source.png');
  await sharp({ create: { width: 24, height: 18, channels: 4, background: '#33445580' } })
    .png()
    .toFile(input);
  const result = await convertWithPolicy(input, 'png', output, {
    compressAboveMb: 100,
    quality: 63
  });
  expect(result.details.quality).toBe(63);
  expect((await sharp(result.outputPath).metadata()).format).toBe('jpeg');
});

it('checks a copied JPG result before starting compression at the configured quality', async () => {
  fs.writeFileSync(input, await jpeg());
  fs.truncateSync(input, MAX_OUTPUT_BYTES);
  const converter = jest.spyOn(factory, 'convertByType');
  const retries = [];
  const result = await convertWithPolicy(
    input,
    'jpg',
    output,
    {
      compressJpg: false,
      compressAboveMb: 100,
      quality: 77,
      forceUnder20Mb: true
    },
    (event) => retries.push(event)
  );
  expect(converter.mock.calls.map((call) => call[3].compressJpg)).toEqual([false, true]);
  expect(retries).toEqual([
    expect.objectContaining({
      previousQuality: null,
      quality: 77,
      outputSize: MAX_OUTPUT_BYTES
    })
  ]);
  expect(result.details).toMatchObject({ quality: 77, attempts: 2 });
  expect(fs.statSync(result.outputPath).size).toBeLessThan(MAX_OUTPUT_BYTES);
  expect(fs.statSync(input).size).toBe(MAX_OUTPUT_BYTES);
});

it('keeps the configured quality when the first compression is already below 20 MB', async () => {
  fs.writeFileSync(input, await jpeg());
  fs.truncateSync(input, MAX_OUTPUT_BYTES + 123);
  const onRetry = jest.fn();
  const converter = jest.spyOn(factory, 'convertByType');
  const result = await convertWithPolicy(
    input,
    'jpg',
    output,
    {
      quality: 83,
      compressJpg: true,
      forceUnder20Mb: true
    },
    onRetry
  );
  expect(result.details).toMatchObject({ quality: 83, attempts: 1 });
  expect(result.details.outputSize).toBeLessThan(MAX_OUTPUT_BYTES);
  expect(converter).toHaveBeenCalledTimes(1);
  expect(onRetry).not.toHaveBeenCalled();
});

it('retains a below-threshold JPG unchanged when the copied result is below 20 MB', async () => {
  const original = await jpeg();
  fs.writeFileSync(input, original);
  const onRetry = jest.fn();
  const result = await convertWithPolicy(
    input,
    'jpg',
    output,
    {
      quality: 50,
      compressJpg: true,
      compressAboveMb: 5,
      forceUnder20Mb: true
    },
    onRetry
  );
  expect(result.details).toMatchObject({ quality: null, attempts: 1 });
  expect(fs.readFileSync(result.outputPath)).toEqual(original);
  expect(onRetry).not.toHaveBeenCalled();
});

it('retries equality and oversized results by 5 from the original, never from a prior JPEG', async () => {
  fs.writeFileSync(input, await jpeg());
  const sizes = [MAX_OUTPUT_BYTES + 1, MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES - 1];
  const qualities = [];
  const converter = jest
    .spyOn(factory, 'convertByType')
    .mockImplementation(async (source, type, dir, options) => {
      expect(source).toBe(input);
      expect(type).toBe('jpg');
      expect(dir).toBe(output);
      qualities.push(options.quality);
      fakeJpeg(path.join(dir, 'source.jpg'), sizes[qualities.length - 1]);
      return {
        success: true,
        outputPath: path.join(dir, 'source.jpg'),
        details: { converted: true }
      };
    });
  const retries = [];
  const result = await convertWithPolicy(
    input,
    'jpg',
    output,
    { quality: 91, compressJpg: true, forceUnder20Mb: true },
    (event) => retries.push(event)
  );
  expect(qualities).toEqual([91, 86, 81]);
  expect(converter).toHaveBeenCalledTimes(3);
  expect(result.details).toMatchObject({
    quality: 81,
    attempts: 3,
    outputSize: MAX_OUTPUT_BYTES - 1
  });
  expect(retries.map((event) => event.quality)).toEqual([86, 81]);
});

it('starts an extracted LIVP JPEG encode at the requested quality if copying exceeds the limit', async () => {
  input = path.join(root, 'source.livp');
  const original = Buffer.alloc(MAX_OUTPUT_BYTES);
  (await jpeg()).copy(original);
  const archive = new AdmZip();
  archive.addFile('photo.jpg', original);
  archive.writeZip(input);
  const result = await convertWithPolicy(input, 'livp', output, {
    quality: 73,
    compressJpg: false,
    forceUnder20Mb: true
  });
  expect(result.details).toMatchObject({ quality: 73, attempts: 2 });
  expect(fs.statSync(result.outputPath).size).toBeLessThan(MAX_OUTPUT_BYTES);
});

it('fails at quality 1 without publishing oversized results or modifying old output', async () => {
  // Fault-inject oversized encoder results at the executor boundary; actual
  // worker transport and lifetime have their own integration tests.
  jest.spyOn(ConversionPool.prototype, 'run').mockImplementation((task, callbacks) => {
    callbacks.onStart?.();
    return convertWithPolicy(
      task.input,
      task.type,
      task.outputDir,
      task.options,
      callbacks.onRetry
    );
  });
  fs.writeFileSync(input, await jpeg());
  const old = path.join(output, 'source.jpg');
  fs.writeFileSync(old, await jpeg());
  const original = fs.readFileSync(old);
  const qualities = [];
  jest.spyOn(factory, 'convertByType').mockImplementation(async (source, type, dir, options) => {
    qualities.push(options.quality);
    fakeJpeg(path.join(dir, 'source.jpg'), MAX_OUTPUT_BYTES);
    return { success: true, outputPath: path.join(dir, 'source.jpg') };
  });
  const result = await runConversionJob([root], {
    quality: 7,
    forceUnder20Mb: true,
    outputDir: output
  });
  expect(qualities).toEqual([7, 2, 1]);
  expect(result.status).toBe('failed');
  expect(result.files[0].error.code).toBe('OUTPUT_TOO_LARGE');
  expect(result.files[0].output).toBeNull();
  expect(fs.readFileSync(old)).toEqual(original);
  expect(fs.readdirSync(output)).toEqual(['source.jpg']);
});

it('validates the strict limit on existing skip targets and retains their bytes', async () => {
  fs.writeFileSync(input, await jpeg());
  fakeJpeg(path.join(output, 'source.jpg'), MAX_OUTPUT_BYTES);
  const result = await runConversionJob([root], {
    existing: 'skip',
    forceUnder20Mb: true,
    outputDir: output
  });
  expect(result.status).toBe('failed');
  expect(result.skippedFiles).toBe(0);
  expect(result.files[0].error.code).toBe('OUTPUT_TOO_LARGE');
  expect(fs.statSync(path.join(output, 'source.jpg')).size).toBe(MAX_OUTPUT_BYTES);
});

it('cancels between retries, leaves the source pending and removes staged output', async () => {
  jest.spyOn(ConversionPool.prototype, 'run').mockImplementation((task, callbacks) => {
    callbacks.onStart?.();
    return convertWithPolicy(
      task.input,
      task.type,
      task.outputDir,
      task.options,
      callbacks.onRetry
    );
  });
  fs.writeFileSync(input, await jpeg());
  let cancelled = false;
  jest.spyOn(factory, 'convertByType').mockImplementation(async (source, type, dir) => {
    fakeJpeg(path.join(dir, 'source.jpg'), MAX_OUTPUT_BYTES);
    cancelled = true;
    return { success: true, outputPath: path.join(dir, 'source.jpg') };
  });
  const result = await runConversionJob([root], {
    forceUnder20Mb: true,
    outputDir: output,
    shouldCancel: () => cancelled
  });
  expect(result).toMatchObject({
    status: 'cancelled',
    totalFiles: 1,
    processedFiles: 0,
    failedConversions: 0,
    scanComplete: true
  });
  expect(result.files[0].status).toBe('pending');
  expect(fs.readdirSync(output)).toEqual([]);
});

it('preserves the exact small decimal threshold without a floating-point multiply round-trip', async () => {
  fs.writeFileSync(input, await jpeg());
  fs.truncateSync(input, 489);
  const original = fs.readFileSync(input);
  const result = await convertWithPolicy(input, 'jpg', output, {
    compressJpg: true,
    compressAboveMb: 0.000489,
    quality: 60
  });
  expect(result.details.quality).toBeNull();
  expect(fs.readFileSync(result.outputPath)).toEqual(original);
});
