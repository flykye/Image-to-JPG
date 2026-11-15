const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const { run } = require('../src/desktop/worker');
const { batchProcessImages, scanDirectoryRecursive } = require('../src/core/batch');

let root;
const reporter = () => ({
  logStart() {},
  logSummary() {},
  logFileProcessing() {},
  logSuccess() {},
  logError() {},
  logWarning() {}
});
const image = () =>
  sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff000080' } });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-jpg-regression-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('converts real PNG/TIFF/JPG/LIVP in recursive groups without deleting prior output', async () => {
  const sub = path.join(root, '子文件夹');
  fs.mkdirSync(sub);
  await image().png().toFile(path.join(root, 'same.png'));
  await image().jpeg().toFile(path.join(root, 'same.jpg'));
  await image().tiff().toFile(path.join(sub, 'scan.tiff'));
  const archive = new AdmZip();
  archive.addFile('nested/photo.JPG', await image().jpeg().toBuffer());
  archive.writeZip(path.join(sub, 'live.LIVP'));
  fs.mkdirSync(path.join(root, 'jpg'));
  fs.writeFileSync(path.join(root, 'jpg', 'keep.txt'), 'do not delete');
  const original = fs.readFileSync(path.join(root, 'same.png'));
  const events = [];
  const result = await run(
    {
      action: 'process',
      paths: [root, sub],
      options: {
        quality: 80,
        compressJpg: false,
        concurrency: 4
      }
    },
    (event) => events.push(event)
  );
  expect(result.totalFiles).toBe(4);
  expect(result.successfulConversions).toBe(4);
  expect(result.failedConversions).toBe(0);
  expect(result.groups).toHaveLength(2);
  expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
  expect(events.find((event) => event.type === 'start').totalStats.total).toBe(4);
  expect(fs.readFileSync(path.join(root, 'jpg', 'keep.txt'), 'utf8')).toBe('do not delete');
  expect(fs.readFileSync(path.join(root, 'same.png'))).toEqual(original);
  expect(fs.readdirSync(path.join(root, 'jpg')).sort()).toEqual([
    'keep.txt',
    'same.jpg',
    'same_1.jpg'
  ]);
  expect(fs.existsSync(path.join(sub, 'jpg', 'live.jpg'))).toBe(true);
  expect(fs.readdirSync(path.join(sub, 'jpg'))).toHaveLength(2);
  for (const group of result.groups) {
    for (const filename of fs
      .readdirSync(group.outputDir)
      .filter((name) => name.endsWith('.jpg'))) {
      expect((await sharp(path.join(group.outputDir, filename)).metadata()).format).toBe('jpeg');
    }
  }
});

it('flattens transparent PNG pixels to white instead of black', async () => {
  const input = path.join(root, 'transparent.png');
  await sharp({ create: { width: 4, height: 4, channels: 4, background: '#00000000' } })
    .png()
    .toFile(input);
  const result = await batchProcessImages([input], root, reporter());
  expect(result.success).toBe(true);
  const pixel = await sharp(path.join(root, 'jpg', 'transparent.jpg'))
    .raw()
    .toBuffer();
  expect([...pixel.slice(0, 3)]).toEqual([255, 255, 255]);
});

it('skips an existing output and keeps accurate processed/skipped statistics', async () => {
  const input = path.join(root, 'photo.png');
  await image().png().toFile(input);
  await batchProcessImages([input], root, reporter());
  const output = path.join(root, 'jpg', 'photo.jpg');
  const before = fs.readFileSync(output);
  const result = await batchProcessImages([input], root, reporter(), { skipExisting: true });
  expect(result.stats).toMatchObject({
    processedFiles: 1,
    successfulConversions: 1,
    skippedFiles: 1
  });
  expect(fs.readFileSync(output)).toEqual(before);
  expect(fs.readdirSync(path.dirname(output))).toEqual(['photo.jpg']);
});

it('reports broken input as failure and cleans only its own temporary output', async () => {
  const input = path.join(root, 'broken.png');
  fs.writeFileSync(input, 'not an image');
  const result = await batchProcessImages([input], root, reporter());
  expect(result.success).toBe(false);
  expect(result.stats).toMatchObject({ processedFiles: 1, failedConversions: 1 });
  expect(fs.readdirSync(path.join(root, 'jpg'))).toEqual([]);
});

it('stops between images and retains completed results', async () => {
  const files = [path.join(root, 'a.png'), path.join(root, 'b.png')];
  for (const file of files) await image().png().toFile(file);
  let cancelled = false;
  const logs = reporter();
  logs.logSuccess = () => {
    cancelled = true;
  };
  const result = await batchProcessImages(files, root, logs, {
    concurrency: 1,
    shouldCancel: () => cancelled
  });
  expect(result.stats).toMatchObject({
    cancelled: true,
    processedFiles: 1,
    successfulConversions: 1
  });
  expect(fs.readdirSync(path.join(root, 'jpg'))).toEqual(['a.jpg']);
});

it('rejects a file as scan root and excludes custom output from recursive scans', async () => {
  const input = path.join(root, 'a.png');
  await image().png().toFile(input);
  expect(scanDirectoryRecursive(input).success).toBe(false);
  const output = path.join(root, 'exports');
  fs.mkdirSync(output);
  await image().jpeg().toFile(path.join(output, 'already.jpg'));
  const result = scanDirectoryRecursive(root, { excludedDirs: [output] });
  expect(result.totalStats.total).toBe(1);
});

it('does not recurse into directory symlinks', () => {
  if (process.platform === 'win32') return;
  fs.writeFileSync(path.join(root, 'a.heic'), 'fake');
  fs.symlinkSync(root, path.join(root, 'cycle'));
  expect(scanDirectoryRecursive(root).totalStats.total).toBe(1);
});

it('rejects invalid quality before creating an output directory', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await batchProcessImages([], root, reporter(), { quality: 101 });
  errors.mockRestore();
  expect(result.success).toBe(false);
  expect(fs.existsSync(path.join(root, 'jpg'))).toBe(false);
});
