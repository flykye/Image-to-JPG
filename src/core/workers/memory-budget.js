const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { JobError } = require('../services/job-error');

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const WORKER_BASE_BYTES = 64 * MIB;

function defaultMemoryBudget() {
  const constrained = process.constrainedMemory?.() || 0;
  const physical = os.totalmem();
  const availableLimit = constrained > 0 ? Math.min(physical, constrained) : physical;
  // macOS free RAM excludes reclaimable caches; using it alone needlessly
  // serializes otherwise healthy machines. This is an admission estimate,
  // not an OS-enforced cap on native/WASM allocations.
  // Keep the same quarter-RAM budget on smaller machines, while allowing
  // high-memory machines to admit twenty full-resolution conversion workers.
  return Math.max(256 * MIB, Math.min(16 * GIB, Math.floor(availableLimit / 4)));
}

async function estimateTaskBytes(task) {
  let stat;
  try {
    stat = await fs.promises.stat(task.input);
    if (!stat.isFile()) throw new Error('Input is not a regular file');
  } catch (error) {
    throw new JobError('READ_ERROR', error.message, task.input, error.code);
  }
  const options = task.options || {};
  const copiesJpg =
    task.type === 'jpg' &&
    (!options.compressJpg || stat.size / 1_000_000 <= (options.compressAboveMb ?? 0)) &&
    (!options.forceUnder20Mb || stat.size < 20_000_000);
  if (copiesJpg) return WORKER_BASE_BYTES;
  // No ZIP extraction in the scheduler. LIVP's decoded dimensions are unknown
  // until the worker opens its image, so reserve a conservative unknown-image slot.
  if (task.type !== 'livp') {
    try {
      const metadata = await sharp(task.input).metadata();
      const pixels = metadata.width * metadata.height;
      if (Number.isFinite(pixels) && pixels > 0) {
        return Math.ceil(WORKER_BASE_BYTES + pixels * 16 + stat.size * 2);
      }
    } catch {
      // DNG/custom decoders may work even when sharp cannot inspect the header.
    }
  }
  return Math.ceil(512 * MIB + stat.size * 2);
}

module.exports = { defaultMemoryBudget, estimateTaskBytes, WORKER_BASE_BYTES, MIB, GIB };
