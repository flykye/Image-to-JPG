const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectFileType } = require('../src/core/services/file-signature');
const { scanDirectory } = require('../src/core/batch');
const { factory } = require('../src/core/converters');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dng-detection-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it.each([
  [0x49, 0x49, 0x2A, 0x00, 0x08, 0, 0, 0],
  [0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 0x08]
])('routes a DNG TIFF container to the RAW fallback chain (%j)', (...header) => {
  const file = path.join(root, 'camera.DNG');
  fs.writeFileSync(file, Buffer.from(header));
  const detected = detectFileType(file);
  expect(detected.type).toBe('dng');
  expect(detected.headerType).toBe('tiff');
  expect(detected.warning).toBeNull();
  expect(factory.getConverterByType(detected.type).type).toBe('dng');
  expect(scanDirectory(root).stats).toMatchObject({ dng: 1, tiff: 0 });
});

it('still honors an incompatible JPEG signature over the DNG extension', () => {
  const file = path.join(root, 'renamed.dng');
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  expect(detectFileType(file)).toMatchObject({ type: 'jpg', headerType: 'jpg' });
});
