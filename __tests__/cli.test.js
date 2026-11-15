const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const sharp = require('sharp');

const cli = path.resolve(__dirname, '../src/cli/index.js');
let root, input, output, png;
const image = () =>
  sharp({ create: { width: 12, height: 10, channels: 4, background: '#50a07080' } });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-contract-'));
  input = path.join(root, '输入 空格');
  output = path.join(root, 'out');
  fs.mkdirSync(input);
  png = await image().png().toBuffer();
  fs.writeFileSync(path.join(input, 'photo.png'), png);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function invoke(args, json = true) {
  const child = spawnSync(process.execPath, [cli, ...(json ? ['--json'] : []), ...args], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, IMAGE_TO_JPG_CANCEL_FILE: '' }
  });
  expect(child.error).toBeUndefined();
  return { ...child, result: json ? JSON.parse(child.stdout) : null };
}

it('returns one versioned result with real absolute paths and preserves the input', async () => {
  const { status, stderr, result } = invoke([input, '-o', output]);
  expect(status).toBe(0);
  expect(stderr).toBe('');
  expect(result).toMatchObject({
    schemaVersion: 1,
    status: 'success',
    converted: 1,
    skipped: 0,
    failed: 0,
    pending: 0,
    scanComplete: true
  });
  expect(result.files[0]).toMatchObject({
    input: fs.realpathSync(path.join(input, 'photo.png')),
    status: 'converted',
    error: null
  });
  expect(path.isAbsolute(result.files[0].output)).toBe(true);
  expect((await sharp(result.files[0].output).metadata()).format).toBe('jpeg');
  expect(fs.readFileSync(path.join(input, 'photo.png'))).toEqual(png);
});

it.each([
  ['quality low', ['-q', '0']],
  ['quality high', ['-q', '101']],
  ['quality fractional', ['-q', '1.5']],
  ['quality invalid', ['-q', 'banana']],
  ['quality missing', ['-q']],
  ['concurrency low', ['-c', '0']],
  ['concurrency high', ['-c', '33']],
  ['concurrency fractional', ['-c', '1.5']],
  ['concurrency invalid', ['-c', 'banana']],
  ['concurrency missing', ['-c']],
  ['unknown option', ['--unknown']],
  ['missing output', ['-o']],
  ['empty output', ['-o', '']],
  ['invalid existing policy', ['--existing', 'overwrite']],
  ['conflicting existing policy', ['-s', '--existing', 'error']],
  ['conflicting protocols', ['--jsonl']],
  ['negative compression threshold', ['--compress-above-mb', '-1']],
  ['invalid compression threshold', ['--compress-above-mb', 'NaN']],
  ['infinite compression threshold', ['--compress-above-mb', 'Infinity']],
  ['excessive compression threshold', ['--compress-above-mb', '1000001']],
  ['missing compression threshold', ['--compress-above-mb']]
])('rejects %s with structured error and no output', (label, args) => {
  const child = invoke([input, ...args]);
  expect(child.status).toBe(2);
  expect(child.result.status).toBe('invalid');
  expect(child.result.error.code).toMatch(/^INVALID_/);
  expect(fs.existsSync(path.join(input, 'jpg'))).toBe(false);
});

it('rejects a missing target, file input and nonexistent directory as usage errors', () => {
  for (const args of [[], [path.join(input, 'photo.png')], [path.join(root, 'missing')]]) {
    const child = invoke(args);
    expect(child.status).toBe(2);
    expect(child.result.status).toBe('invalid');
  }
});

it('keeps help/version successful and JSON parseable', () => {
  for (const [flag, status] of [
    ['--help', 'help'],
    ['--version', 'version']
  ]) {
    const child = invoke([flag]);
    expect(child.status).toBe(0);
    expect(child.result.status).toBe(status);
  }
  const child = invoke(['--version'], false);
  expect(child.stdout.trim()).toBe(require('../package.json').version);
});

it('distinguishes an empty directory from successful conversion', () => {
  fs.unlinkSync(path.join(input, 'photo.png'));
  const child = invoke([input, '-o', output]);
  expect(child.status).toBe(0);
  expect(child.result).toMatchObject({
    status: 'no_files',
    total: 0,
    converted: 0,
    scanComplete: true
  });
  expect(fs.existsSync(output)).toBe(false);
});

it('reports partial failure on both the result and diagnostic channels', () => {
  fs.writeFileSync(path.join(input, 'broken.png'), 'invalid');
  const child = invoke([input, '-o', output]);
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('CONVERSION_FAILED');
  expect(child.result).toMatchObject({
    status: 'partial',
    total: 2,
    processed: 2,
    converted: 1,
    failed: 1
  });
  expect(child.result.files.find((file) => file.status === 'failed').error.code).toBe(
    'CONVERSION_FAILED'
  );
});

it('preserves subdirectories and gives each same-name source its own result', async () => {
  for (const folder of ['a', 'b']) {
    fs.mkdirSync(path.join(input, folder));
    fs.writeFileSync(path.join(input, folder, 'photo.png'), png);
  }
  fs.writeFileSync(path.join(input, 'photo.jpg'), await image().jpeg().toBuffer());
  const first = invoke([input, '-r', '-c', '4', '-o', output]);
  expect(first.status).toBe(0);
  expect(first.result.converted).toBe(4);
  expect(new Set(first.result.files.map((file) => file.output)).size).toBe(4);
  expect(fs.existsSync(path.join(output, 'a', 'photo.jpg'))).toBe(true);
  expect(fs.existsSync(path.join(output, 'b', 'photo.jpg'))).toBe(true);
  const second = invoke([input, '-r', '-c', '4', '-o', output, '--skip-existing']);
  expect(second.status).toBe(0);
  expect(second.result).toMatchObject({ converted: 0, skipped: 4, failed: 0 });
  expect(second.result.files.map((file) => file.output)).toEqual(
    first.result.files.map((file) => file.output)
  );
});

it.each(['directory', 'empty', 'png'])(
  'does not count an invalid existing %s as a successful JPEG',
  (kind) => {
    fs.mkdirSync(output);
    const target = path.join(output, 'photo.jpg');
    if (kind === 'directory') fs.mkdirSync(target);
    else fs.writeFileSync(target, kind === 'empty' ? '' : png);
    const child = invoke([input, '-o', output, '--existing', 'skip']);
    expect(child.status).toBe(1);
    expect(child.result).toMatchObject({ converted: 0, skipped: 0, failed: 1 });
    expect(child.result.files[0].error.code).toBe('OUTPUT_INVALID');
  }
);

it('keeps rename and error policies explicit and preserves prior output', () => {
  const first = invoke([input, '-o', output]);
  const original = fs.readFileSync(first.result.files[0].output);
  const second = invoke([input, '-o', output, '--existing', 'rename']);
  expect(second.status).toBe(0);
  expect(second.result.files[0].output).not.toBe(first.result.files[0].output);
  const third = invoke([input, '-o', output, '--existing', 'error']);
  expect(third.status).toBe(1);
  expect(third.result.files[0].error.code).toBe('OUTPUT_EXISTS');
  expect(fs.readFileSync(first.result.files[0].output)).toEqual(original);
});

it('excludes a nested custom output directory from subsequent scans', () => {
  output = path.join(input, 'exports');
  expect(invoke([input, '-r', '-o', output]).result.total).toBe(1);
  expect(invoke([input, '-r', '-o', output, '-s']).result).toMatchObject({ total: 1, skipped: 1 });
  expect(invoke([input, '-o', input]).status).toBe(2);
});

const permissions = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;
permissions('reports unreadable subdirectories instead of claiming complete success', () => {
  const locked = path.join(input, 'locked');
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, 'hidden.png'), png);
  fs.chmodSync(locked, 0);
  try {
    const child = invoke([input, '-r', '-o', output]);
    expect(child.status).toBe(1);
    expect(child.result).toMatchObject({ status: 'partial', converted: 1, scanComplete: false });
    expect(child.result.scanErrors[0]).toMatchObject({ code: 'SCAN_ERROR', systemCode: 'EACCES' });
    expect(child.stderr).toContain('WARNING');
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

permissions('normalizes output creation errors instead of exposing an uncaught stack', () => {
  fs.chmodSync(input, 0o500);
  try {
    const child = invoke([input, '-r']);
    expect(child.status).toBe(1);
    expect(child.result.files[0].error.code).toBe('WRITE_ERROR');
    expect(child.stderr).not.toContain('at Object.mkdirSync');
  } finally {
    fs.chmodSync(input, 0o700);
  }
});

permissions('keeps unreadable image files as typed failures', () => {
  const file = path.join(input, 'photo.png');
  fs.chmodSync(file, 0);
  try {
    const child = invoke([input, '-o', output]);
    expect(child.status).toBe(1);
    expect(child.result).toMatchObject({ total: 1, failed: 1 });
    expect(child.result.files[0].error).toMatchObject({ code: 'READ_ERROR', systemCode: 'EACCES' });
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

it('honors cancellation before scanning and marks the unknown total incomplete', () => {
  const marker = path.join(root, 'cancel');
  fs.writeFileSync(marker, '');
  const child = invoke([input, '-o', output, '--cancel-file', marker]);
  expect(child.status).toBe(130);
  expect(child.result).toMatchObject({ status: 'cancelled', total: 0, scanComplete: false });
  expect(fs.existsSync(output)).toBe(false);
});

function stream(args, observe, pause = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, IMAGE_TO_JPG_CANCEL_FILE: '' }
    });
    let stdout = '',
      stderr = '';
    if (pause) {
      child.stdout.pause();
      child.stdout.once('readable', () => setImmediate(() => child.stdout.resume()));
    }
    child.stdout.on('data', (data) => {
      stdout += data;
      observe?.(stdout, child);
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

it('delivers a large failure result completely through a backpressured stdout pipe', async () => {
  fs.unlinkSync(path.join(input, 'photo.png'));
  for (let index = 0; index < 800; index++)
    fs.writeFileSync(path.join(input, `bad-${index}.png`), 'broken');
  const child = await stream([input, '-o', output, '--json'], null, true);
  expect(child.code).toBe(1);
  const result = JSON.parse(child.stdout);
  expect(result).toMatchObject({ failed: 800, processed: 800, total: 800 });
  expect(result.files).toHaveLength(800);
});

it('streams JSONL with exactly one final result event', async () => {
  const child = await stream([input, '-o', output, '--jsonl']);
  const events = child.stdout.trim().split('\n').map(JSON.parse);
  expect(child.code).toBe(0);
  expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
  expect(events.at(-1).result.converted).toBe(1);
  expect(events.every((event) => event.schemaVersion === 1)).toBe(true);
});

it('supports portable cancellation markers and cleans in-flight staging output', async () => {
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(input, `${i}.png`), png);
  const marker = path.join(root, 'cancel');
  let requested = false;
  const child = await stream([input, '-o', output, '--jsonl', '--cancel-file', marker], (text) => {
    if (!requested && text.includes('"type":"processing"')) {
      requested = true;
      fs.writeFileSync(marker, '');
    }
  });
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1)).result;
  expect(child.code).toBe(130);
  expect(result.status).toBe('cancelled');
  expect(result.scanComplete).toBe(true);
  expect(result.pending).toBeGreaterThan(0);
  expect(result.converted).toBeGreaterThanOrEqual(1);
  expect(fs.readdirSync(output).some((name) => name.startsWith('.image-to-jpg-'))).toBe(false);
});

(process.platform === 'win32' ? it.skip : it)(
  'returns a complete terminal result after SIGTERM',
  async () => {
    for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(input, `${i}.png`), png);
    let requested = false;
    const child = await stream([input, '-o', output, '--jsonl'], (text, process) => {
      if (!requested && text.includes('"type":"processing"')) {
        requested = true;
        process.kill('SIGTERM');
      }
    });
    expect(child.code).toBe(143);
    expect(child.signal).toBeNull();
    expect(JSON.parse(child.stdout.trim().split('\n').at(-1)).result.status).toBe('cancelled');
  }
);

it('enables threshold-based JPG compression and returns final size and quality', async () => {
  fs.unlinkSync(path.join(input, 'photo.png'));
  const original = await image().jpeg({ quality: 95 }).toBuffer();
  fs.writeFileSync(path.join(input, 'photo.jpg'), original);
  const copied = invoke([input, '-o', output, '--compress-above-mb', '1', '-q', '65']);
  expect(copied.status).toBe(0);
  expect(copied.result.files[0]).toMatchObject({
    inputSize: original.length,
    outputSize: original.length,
    quality: null,
    attempts: 1
  });
  expect(fs.readFileSync(copied.result.files[0].output)).toEqual(original);
  const compressed = invoke([input, '-o', output, '--compress-above-mb', '0', '-q', '65']);
  expect(compressed.status).toBe(0);
  expect(compressed.result.files[0].quality).toBe(65);
  expect(fs.readFileSync(compressed.result.files[0].output)).not.toEqual(original);
});

it('forces an exactly 20 MB JPG below the limit even when its compression threshold is higher', async () => {
  fs.unlinkSync(path.join(input, 'photo.png'));
  const file = path.join(input, 'photo.jpg');
  fs.writeFileSync(file, await image().jpeg().toBuffer());
  fs.truncateSync(file, 20_000_000);
  const child = invoke([
    input,
    '-o',
    output,
    '--compress-above-mb',
    '100',
    '--force-under-20mb',
    '-q',
    '82'
  ]);
  expect(child.status).toBe(0);
  expect(child.result.files[0]).toMatchObject({ quality: 82, inputSize: 20_000_000, attempts: 2 });
  expect(child.result.files[0].outputSize).toBeLessThan(20_000_000);
  expect((await sharp(child.result.files[0].output).metadata()).format).toBe('jpeg');
  expect(fs.statSync(file).size).toBe(20_000_000);
});
