const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  defaultMemoryBudget,
  estimateTaskBytes,
  WORKER_BASE_BYTES,
  MIB,
  GIB
} = require('../src/core/workers/memory-budget');

afterEach(() => jest.restoreAllMocks());

describe('default worker memory admission budget', () => {
  beforeEach(() => {
    jest.spyOn(process, 'constrainedMemory').mockReturnValue(0);
  });

  it.each([
    [8, 2],
    [16, 4],
    [32, 8],
    [64, 16],
    [128, 16]
  ])('uses a %i GiB host budget of %i GiB', (physicalGiB, expectedGiB) => {
    jest.spyOn(os, 'totalmem').mockReturnValue(physicalGiB * GIB);
    expect(defaultMemoryBudget()).toBe(expectedGiB * GIB);
  });

  it.each([
    [64, 8, 2],
    [64, 16, 4],
    [64, 32, 8],
    [8, 64, 2]
  ])(
    'respects physical %i GiB and constrained %i GiB limits with a %i GiB budget',
    (physicalGiB, constrainedGiB, expectedGiB) => {
      jest.spyOn(os, 'totalmem').mockReturnValue(physicalGiB * GIB);
      process.constrainedMemory.mockReturnValue(constrainedGiB * GIB);
      expect(defaultMemoryBudget()).toBe(expectedGiB * GIB);
    }
  );

  it('retains the minimum budget for a small constrained runtime', () => {
    jest.spyOn(os, 'totalmem').mockReturnValue(64 * GIB);
    process.constrainedMemory.mockReturnValue(512 * MIB);
    expect(defaultMemoryBudget()).toBe(256 * MIB);
  });
});

describe('JPG output-limit memory admission', () => {
  let root, input;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jpg-memory-'));
    input = path.join(root, 'image.jpg');
    await sharp({ create: { width: 32, height: 24, channels: 3, background: '#567890' } })
      .jpeg()
      .toFile(input);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([
    { compressJpg: false },
    { compressJpg: true, compressAboveMb: 100 }
  ])('reserves encoding memory for an oversized copy result: %j', async (options) => {
    fs.truncateSync(input, 20_000_000);
    const task = { input, type: 'jpg', options };
    expect(await estimateTaskBytes(task)).toBe(WORKER_BASE_BYTES);
    const withLimit = await estimateTaskBytes({
      ...task,
      options: { ...options, forceUnder20Mb: true }
    });
    // A post-conversion size check will re-encode this copied result, so the
    // scheduler must not reserve only the cheap copy path's fixed overhead.
    expect(withLimit).toBeGreaterThan(WORKER_BASE_BYTES + 40_000_000);
  });

  it('keeps a JPG copied below the strict limit on the inexpensive path', async () => {
    fs.truncateSync(input, 19_999_999);
    expect(
      await estimateTaskBytes({
        input,
        type: 'jpg',
        options: { compressJpg: false, forceUnder20Mb: true }
      })
    ).toBe(WORKER_BASE_BYTES);
  });
});
