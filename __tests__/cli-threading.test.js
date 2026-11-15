const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');

const cli = path.resolve(__dirname, '../src/cli/index.js');
const heic = path.join(__dirname, 'fixtures/heic-rotation.heic');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// These are process-liveness guards, not performance assertions. A test may
// start several independent worker pools and decode every output afterwards.
const processDeadlineMs = 10000;
const integrationDeadlineMs = 20000;
let root, input, output, png, jpg;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-threads-'));
  input = path.join(root, '输入 空格');
  output = path.join(root, '结果 JPG');
  fs.mkdirSync(input);
  png = await sharp({ create: { width: 20, height: 16, channels: 4, background: '#44668880' } })
    .png()
    .toBuffer();
  jpg = await sharp(png).jpeg().toBuffer();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function execute(args, { jsonl = false, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, jsonl ? '--jsonl' : '--json'], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, IMAGE_TO_JPG_CANCEL_FILE: '' }
    });
    let stdout = '',
      stderr = '',
      lineBuffer = '',
      protocolError,
      timedOut = false;
    const events = [];
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, processDeadlineMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      stdout += data;
      if (!jsonl || protocolError) return;
      lineBuffer += data;
      let boundary;
      while ((boundary = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, boundary);
        lineBuffer = lineBuffer.slice(boundary + 1);
        try {
          const event = JSON.parse(line);
          events.push(event);
          onEvent?.(event, child);
        } catch (error) {
          protocolError = error;
          child.kill('SIGKILL');
          break;
        }
      }
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut)
        return reject(new Error(`CLI did not exit before its liveness deadline: ${stderr}`));
      if (protocolError) return reject(protocolError);
      try {
        if (jsonl && lineBuffer.trim()) throw new Error('Incomplete JSONL terminal frame');
        resolve({
          code,
          signal,
          stdout,
          stderr,
          events,
          result: jsonl ? events.at(-1)?.result : JSON.parse(stdout)
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function allFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    expect(entry.name.startsWith('.image-to-jpg-')).toBe(false);
    if (entry.isDirectory()) files.push(...allFiles(name));
    else files.push(fs.realpathSync(name));
  }
  return files;
}

function expectAccounting(result) {
  expect(result.processed).toBe(result.converted + result.skipped + result.failed);
  expect(result.total).toBe(result.processed + result.pending);
  expect(result.files).toHaveLength(result.total);
  for (const [status, count] of [
    ['converted', result.converted],
    ['skipped', result.skipped],
    ['failed', result.failed],
    ['pending', result.pending]
  ]) {
    expect(result.files.filter((file) => file.status === status)).toHaveLength(count);
  }
}

function expectExecution(result, count) {
  expect(result.execution).toMatchObject({ mode: 'worker_threads', requestedConcurrency: count });
  expect(result.execution.peakActive).toBeGreaterThanOrEqual(1);
  expect(result.execution.peakActive).toBeLessThanOrEqual(count);
  expect(result.execution.workersCreated).toBeGreaterThanOrEqual(1);
  expect(result.execution.workersCreated).toBeLessThanOrEqual(count);
  expect(result.execution.memoryBudgetMb).toBeGreaterThan(0);
  expect(typeof result.execution.memoryLimited).toBe('boolean');
}

it(
  'defaults to one global four-thread pool and returns only machine-readable stdout',
  async () => {
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(input, `image-${i}.png`), png);
    const child = await execute([input, '-o', output]);
    expect(child.code).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.result).toMatchObject({
      schemaVersion: 1,
      status: 'success',
      converted: 12,
      failed: 0,
      pending: 0
    });
    expectExecution(child.result, 4);
    expectAccounting(child.result);
    expect(allFiles(output)).toHaveLength(12);
  },
  integrationDeadlineMs
);

it.each([10, 20])(
  'uses at most %i global workers across folders and preserves colliding source names and bytes',
  async (concurrency) => {
    const originals = new Map();
    for (let i = 0; i < 8; i++) {
      const directory = path.join(input, `文件夹 ${i}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'photo.png'), png);
      fs.writeFileSync(path.join(directory, 'photo.jpg'), jpg);
      fs.copyFileSync(heic, path.join(directory, 'photo.heic'));
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        originals.set(fs.realpathSync(file), digest(file));
      }
    }
    const child = await execute([
      input,
      '-r',
      '-o',
      output,
      '-c',
      String(concurrency),
      '--force-under-20mb'
    ]);
    expect(child.code).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.result).toMatchObject({ status: 'success', converted: 24, failed: 0 });
    expectExecution(child.result, concurrency);
    expectAccounting(child.result);
    expect(new Set(child.result.files.map((file) => file.output)).size).toBe(24);
    for (const file of child.result.files) {
      expect(digest(file.input)).toBe(originals.get(file.input));
      expect(path.relative(fs.realpathSync(input), path.dirname(file.input))).toBe(
        path.relative(fs.realpathSync(output), path.dirname(file.output))
      );
      const metadata = await sharp(file.output).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(file.outputSize).toBe(fs.statSync(file.output).size);
      expect(file.outputSize).toBeLessThan(20000000);
    }
    expect(allFiles(output)).toHaveLength(24);
    const outputHashes = new Map(
      child.result.files.map((file) => [file.output, digest(file.output)])
    );
    const skipped = await execute([
      input,
      '-r',
      '-o',
      output,
      '-c',
      String(concurrency),
      '--existing',
      'skip'
    ]);
    expect(skipped.code).toBe(0);
    expect(skipped.result).toMatchObject({ converted: 0, skipped: 24, failed: 0, pending: 0 });
    expect(skipped.result.execution.workersCreated).toBe(0);
    expectAccounting(skipped.result);
    for (const [file, hash] of outputHashes) expect(digest(file)).toBe(hash);
  },
  integrationDeadlineMs
);

it(
  'keeps worker conversion errors out of stdout while finishing other directories',
  async () => {
    for (let i = 0; i < 4; i++) {
      const directory = path.join(input, `directory-${i}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'photo.png'), png);
    }
    fs.writeFileSync(path.join(input, 'broken.png'), 'invalid PNG data');
    const child = await execute([input, '-r', '-o', output, '-c', '10']);
    expect(child.code).toBe(1);
    expect(child.signal).toBeNull();
    expect(child.result).toMatchObject({
      status: 'partial',
      total: 5,
      converted: 4,
      failed: 1,
      pending: 0
    });
    expect(child.result.files.find((file) => file.status === 'failed').error.code).toBe(
      'CONVERSION_FAILED'
    );
    expect(child.stderr).toContain('CONVERSION_FAILED');
    expectExecution(child.result, 10);
    expectAccounting(child.result);
    expect(allFiles(output)).toHaveLength(4);
  },
  integrationDeadlineMs
);

it(
  'streams worker-pool information and exactly one final result after all work',
  async () => {
    fs.writeFileSync(path.join(input, 'photo.png'), png);
    const child = await execute([input, '-o', output, '-c', '10'], { jsonl: true });
    expect(child.code).toBe(0);
    expect(child.signal).toBeNull();
    expect(child.events.every((event) => event.schemaVersion === 1)).toBe(true);
    const pools = child.events.filter((event) => event.type === 'worker-pool');
    expect(pools.length).toBeGreaterThan(0);
    for (const state of pools) {
      expect(state.requestedConcurrency).toBe(10);
      expect(state.effectiveConcurrency).toBeGreaterThanOrEqual(1);
      expect(state.effectiveConcurrency).toBeLessThanOrEqual(10);
      expect(state.memoryBudgetMb).toBeGreaterThan(0);
      expect(typeof state.message).toBe('string');
    }
    expect(child.events.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(child.events.at(-1).type).toBe('result');
    expect(child.events.filter((event) => event.type === 'success')).toHaveLength(1);
    expect(child.result.status).toBe('success');
    expectAccounting(child.result);
  },
  integrationDeadlineMs
);

async function cancellationCase(signal) {
  const originals = new Map();
  for (let i = 0; i < 100; i++) {
    const file = path.join(input, `image-${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(file, png);
    originals.set(fs.realpathSync(file), digest(file));
  }
  const marker = path.join(root, 'stop-request');
  let requested = false;
  const child = await execute([input, '-o', output, '-c', '20', '--cancel-file', marker], {
    jsonl: true,
    onEvent(event, process) {
      if (!requested && event.type === 'processing') {
        requested = true;
        if (signal) process.kill(signal);
        else fs.writeFileSync(marker, 'cancel');
      }
    }
  });
  expect(requested).toBe(true);
  expect(child.code).toBe(signal === 'SIGTERM' ? 143 : 130);
  expect(child.signal).toBeNull();
  expect(child.events.filter((event) => event.type === 'result')).toHaveLength(1);
  expect(child.events.at(-1).type).toBe('result');
  expect(child.result).toMatchObject({
    status: 'cancelled',
    total: 100,
    failed: 0,
    scanComplete: true
  });
  expect(child.result.pending).toBeGreaterThan(0);
  expectAccounting(child.result);
  expectExecution(child.result, 20);
  const published = allFiles(output);
  expect(published.sort()).toEqual(
    child.result.files
      .filter((file) => file.status === 'converted')
      .map((file) => file.output)
      .sort()
  );
  for (const file of child.result.files) {
    expect(digest(file.input)).toBe(originals.get(file.input));
    if (file.status === 'converted')
      expect((await sharp(file.output).metadata()).format).toBe('jpeg');
    else expect(file.output).toBeNull();
  }
}

it(
  'cancels a twenty-thread job via the portable marker and cleans queued staging directories',
  async () => {
    await cancellationCase(null);
  },
  integrationDeadlineMs
);

(process.platform === 'win32' ? it.skip : it)(
  'returns a complete cancelled result after SIGTERM with twenty workers',
  async () => {
    await cancellationCase('SIGTERM');
  },
  integrationDeadlineMs
);
