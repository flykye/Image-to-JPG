const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { convertHeicToJpg, isHeicSupported } = require('../src/core/converters/heic-logic');

const fixture = path.join(__dirname, 'fixtures/heic-rotation.heic');
let temp, originalHeif;

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'heic-encoding-'));
  originalHeif = sharp.format.heif;
  // Exercise the bundled portable fallback even if a developer installed a
  // custom libvips that supports HEVC natively.
  sharp.format.heif = { input: { buffer: true, fileSuffix: ['.avif'] } };
});

afterEach(() => {
  sharp.format.heif = originalHeif;
  jest.restoreAllMocks();
  fs.rmSync(temp, { recursive: true, force: true });
});

it('distinguishes AVIF-only support from a native HEIC decoder', () => {
  expect(isHeicSupported()).toBe(false);
  sharp.format.heif = { input: { buffer: true, fileSuffix: ['.avif', '.heic'] } };
  expect(isHeicSupported()).toBe(true);
});

it('decodes a real rotated HEIC to a correctly oriented JPEG without changing its source', async () => {
  const original = fs.readFileSync(fixture);
  const output = path.join(temp, 'photo.jpg');
  const result = await convertHeicToJpg(fixture, output, { quality: 90 });
  expect(result).toMatchObject({ success: true, method: 'builtin' });
  const metadata = await sharp(output).metadata();
  expect(metadata).toMatchObject({ format: 'jpeg', width: 200, height: 320 });
  const { data, info } = await sharp(output)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const [x, y, expected] of [
    [10, 10, [30, 30, 240]],
    [190, 10, [240, 30, 30]],
    [10, 310, [240, 240, 30]],
    [190, 310, [30, 240, 30]]
  ]) {
    const offset = (y * info.width + x) * info.channels;
    for (let channel = 0; channel < 3; channel++)
      expect(Math.abs(data[offset + channel] - expected[channel])).toBeLessThanOrEqual(4);
  }
  expect(fs.readFileSync(fixture)).toEqual(original);
});

it('uses the requested JPEG quality instead of re-encoding at quality 100', async () => {
  const low = path.join(temp, 'low.jpg'),
    high = path.join(temp, 'high.jpg');
  expect((await convertHeicToJpg(fixture, low, { quality: 35 })).success).toBe(true);
  expect((await convertHeicToJpg(fixture, high, { quality: 95 })).success).toBe(true);
  expect(fs.statSync(low).size).toBeLessThan(fs.statSync(high).size);
  // DQT quantisation tables describe the encoder quality independently from
  // entropy/content; compare them to native single-encode JPEGs at each setting.
  const tables = (buffer) => {
    const result = [];
    for (let i = 2; i + 3 < buffer.length; ) {
      const marker = buffer.readUInt16BE(i);
      if (marker === 0xffda || marker === 0xffd9) break;
      const length = buffer.readUInt16BE(i + 2);
      if (marker === 0xffdb) result.push(buffer.subarray(i + 4, i + 2 + length).toString('hex'));
      i += length + 2;
    }
    return result;
  };
  for (const [quality, file] of [
    [35, low],
    [95, high]
  ]) {
    const reference = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'red' }
    })
      .jpeg({ quality })
      .toBuffer();
    expect(tables(fs.readFileSync(file))).toEqual(tables(reference));
  }
});

it('continues pixel conversion if HEIF metadata cannot be read', async () => {
  jest.spyOn(sharp.prototype, 'metadata').mockRejectedValueOnce(new Error('metadata unavailable'));
  const output = path.join(temp, 'photo.jpg');
  expect((await convertHeicToJpg(fixture, output, { quality: 80 })).success).toBe(true);
  expect((await sharp(output).metadata()).format).toBe('jpeg');
});

it('preserves a reported density without copying orientation to transformed pixels', async () => {
  jest.spyOn(sharp.prototype, 'metadata').mockResolvedValueOnce({ density: 144, orientation: 6 });
  const output = path.join(temp, 'photo.jpg');
  expect((await convertHeicToJpg(fixture, output, { quality: 90 })).success).toBe(true);
  const result = await sharp(output).metadata();
  expect(result.density).toBe(144);
  expect([undefined, 1]).toContain(result.orientation);
  expect(result.autoOrient).toMatchObject({ width: 200, height: 320 });
});
