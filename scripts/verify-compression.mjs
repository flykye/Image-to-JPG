import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomFillSync, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// A real high-detail 16 MP source makes quality=100 exceed the public 20 MB
// limit. The process must re-encode the PNG source at 95, without resizing it.
const root = fileURLToPath(new URL('../', import.meta.url));
const exe = process.argv[2] ? path.resolve(process.argv[2]) : process.execPath;
const prefix = process.argv[2] ? [] : [path.join(root, 'src/cli/index.js')];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'compression-real-'));
try {
  const input = path.join(temp, 'inputs');
  fs.mkdirSync(input);
  const source = path.join(input, 'noise.png');
  const pixels = randomFillSync(Buffer.alloc(4000 * 4000 * 3));
  await sharp(pixels, { raw: { width: 4000, height: 4000, channels: 3 } })
    .png()
    .toFile(source);
  const hash = () => createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = hash();
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, [...prefix, input, '-q', '100', '--force-under-20mb', '--jsonl'], {
      windowsHide: true
    });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      stdout += text;
    });
    child.stderr.on('data', (text) => {
      stderr += text;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      try {
        assert.equal(signal, null, stderr);
        assert.equal(code, 0, stderr);
        resolve(
          stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        );
      } catch (error) {
        reject(error);
      }
    });
  });
  const retries = result.filter((event) => event.type === 'compression-retry');
  assert(retries.length >= 1, 'Fixture did not trigger a real size retry');
  for (let index = 0; index < retries.length; index++) {
    assert.equal(retries[index].quality, Math.max(1, 95 - index * 5));
    assert(retries[index].outputSize >= 20_000_000);
    assert.equal(fs.realpathSync(retries[index].input), fs.realpathSync(source));
  }
  const final = result.at(-1).result;
  assert.equal(final.status, 'success');
  const file = final.files[0];
  assert.equal(file.attempts, retries.length + 1);
  assert(file.outputSize < 20_000_000);
  assert.equal(file.outputSize, fs.statSync(file.output).size);
  const metadata = await sharp(file.output).metadata();
  assert.equal(metadata.width, 4000);
  assert.equal(metadata.height, 4000);
  assert.equal(hash(), before, 'Original source was modified');
  console.log(
    JSON.stringify(
      {
        verified: true,
        dimensions: '4000x4000',
        inputBytes: file.inputSize,
        firstOutputBytes: retries[0].outputSize,
        finalOutputBytes: file.outputSize,
        finalQuality: file.quality,
        attempts: file.attempts,
        durationMs: Date.now() - started
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
