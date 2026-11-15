import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const target =
  process.argv[2] ||
  `${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}`;
const platform = target.replace('/', '-');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const archive = path.join(
  root,
  'dist',
  `cli-${platform}`,
  `batch-image-processor-${version}-${platform}.zip`
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'CLI 打包验证 '));
const unpack = path.join(temp, '完整 解压');
const exe = path.join(
  unpack,
  `batch-image-processor${target.startsWith('windows/') ? '.exe' : ''}`
);
const input = path.join(temp, '输入 照片');
const output = path.join(temp, '输出 JPG');
const env = {
  ...process.env,
  PATH: '',
  NODE_OPTIONS: '--invalid-node-option',
  NODE_PATH: '/invalid-node-path'
};
let checks = 0;

function invoke(args, expectedCode) {
  const child = spawnSync(exe, ['--json', ...args], {
    cwd: temp,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, expectedCode, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.version, version);
  checks++;
  return result;
}

function cancel(signal = false) {
  const marker = path.join(temp, `cancel-${signal}`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      exe,
      [
        input,
        '-o',
        path.join(temp, `cancel-output-${signal}`),
        '-c',
        '20',
        '--jsonl',
        '--cancel-file',
        marker
      ],
      {
        cwd: temp,
        env,
        windowsHide: true
      }
    );
    let stdout = '',
      stderr = '',
      requested = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Cancellation timed out'));
    }, 30000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      stdout += text;
      if (!requested && stdout.includes('"type":"processing"')) {
        requested = true;
        if (signal) child.kill('SIGTERM');
        else fs.writeFileSync(marker, 'cancel');
      }
    });
    child.stderr.on('data', (text) => {
      stderr += text;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, terminated) => {
      clearTimeout(timeout);
      try {
        assert.equal(terminated, null, stderr);
        assert.equal(code, signal ? 143 : 130, stderr);
        const events = stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.equal(events.filter((event) => event.type === 'result').length, 1);
        const result = events.at(-1).result;
        assert.equal(result.status, 'cancelled');
        assert.equal(result.scanComplete, true);
        assert(result.pending > 0);
        assert.equal(result.processed, result.converted + result.failed + result.skipped);
        assert(
          !fs
            .readdirSync(path.join(temp, `cancel-output-${signal}`))
            .some((name) => name.startsWith('.image-to-jpg-'))
        );
        checks++;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

try {
  new AdmZip(archive).extractAllTo(unpack, true, true);
  assert.equal(invoke(['--version'], 0).status, 'version');
  assert.equal(invoke([], 2).error.code, 'INVALID_ARGUMENT');
  fs.mkdirSync(input);
  assert.equal(invoke([input], 0).status, 'no_files');
  const png = await sharp({
    create: { width: 20, height: 16, channels: 4, background: '#33775580' }
  })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(input, '照片.png'), png);
  const first = invoke([input, '-o', output], 0);
  assert.equal(first.converted, 1);
  assert.equal(first.execution.mode, 'worker_threads');
  assert.equal(first.execution.requestedConcurrency, 4);
  assert.equal((await sharp(first.files[0].output).metadata()).format, 'jpeg');
  assert.deepEqual(fs.readFileSync(path.join(input, '照片.png')), png);
  assert.equal(invoke([input, '-o', output, '--existing', 'skip'], 0).skipped, 1);
  fs.writeFileSync(path.join(input, 'broken.png'), 'broken');
  assert.equal(invoke([input, '-o', output], 1).status, 'partial');
  fs.unlinkSync(path.join(input, 'broken.png'));
  for (const folder of ['a', 'b']) {
    fs.mkdirSync(path.join(input, folder));
    fs.writeFileSync(path.join(input, folder, '照片.png'), png);
  }
  const recursive = invoke([input, '-r', '-o', output, '--existing', 'skip'], 0);
  assert.equal(recursive.converted, 2);
  assert.equal(recursive.skipped, 1);
  assert.equal(new Set(recursive.files.map((file) => file.output)).size, 3);
  const jpgInput = path.join(input, 'existing.jpg');
  const jpg = await sharp(png).jpeg().toBuffer();
  fs.writeFileSync(jpgInput, jpg);
  const threshold = invoke([input, '-o', output, '--compress-above-mb', '5', '-q', '60'], 0);
  const copied = threshold.files.find((file) => file.type === 'jpg');
  assert.equal(copied.quality, null);
  assert.deepEqual(fs.readFileSync(copied.output), jpg);
  fs.copyFileSync(
    path.join(root, '__tests__/fixtures/heic-rotation.heic'),
    path.join(input, 'rotated.heic')
  );
  const heic = invoke([input, '-o', output, '-q', '75'], 0).files.find(
    (file) => file.type === 'heic'
  );
  assert.equal(heic.quality, 75);
  const heicMetadata = await sharp(heic.output).metadata();
  assert.equal(heicMetadata.width, 200);
  assert.equal(heicMetadata.height, 320);
  fs.truncateSync(jpgInput, 20_000_000);
  const limited = invoke(
    [input, '-o', output, '--compress-above-mb', '100', '--force-under-20mb', '-q', '82'],
    0
  );
  const compressed = limited.files.find((file) => file.type === 'jpg');
  assert.equal(compressed.quality, 82);
  assert.equal(compressed.attempts, 2);
  assert(compressed.outputSize < 20_000_000);
  assert.equal(fs.statSync(jpgInput).size, 20_000_000);
  const threadedInput = path.join(temp, '多线程 输入');
  fs.mkdirSync(threadedInput);
  for (let i = 0; i < 24; i++) {
    const folder = path.join(threadedInput, `folder-${i}`);
    fs.mkdirSync(folder);
    fs.copyFileSync(
      path.join(root, '__tests__/fixtures/heic-rotation.heic'),
      path.join(folder, 'same.heic')
    );
  }
  for (const concurrency of [10, 20]) {
    const threaded = invoke(
      [
        threadedInput,
        '-r',
        '-c',
        String(concurrency),
        '-o',
        path.join(temp, `threaded-output-${concurrency}`)
      ],
      0
    );
    assert.equal(threaded.converted, 24);
    assert.equal(threaded.execution.requestedConcurrency, concurrency);
    assert(threaded.execution.peakActive > 1 && threaded.execution.peakActive <= concurrency);
    assert(threaded.execution.workersCreated <= concurrency);
    assert.equal(new Set(threaded.files.map((file) => file.output)).size, 24);
    for (const file of threaded.files) {
      const info = await sharp(file.output).metadata();
      assert.equal(info.width, 200);
      assert.equal(info.height, 320);
    }
  }
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(input, `cancel-${i}.png`), png);
  await cancel();
  if (process.platform !== 'win32') await cancel(true);
  console.log(
    `Packaged CLI verified: ${target}; ${checks} process checks; real 4/10/20 worker threads, cross-directory scheduling, HEIC, JPG threshold, strict 20 MB and cancellation.`
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
