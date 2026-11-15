const fs = require('fs');
const path = require('path');
const { JobError } = require('../services/job-error');
const keyOf = (value) => value.normalize('NFC').toLowerCase();

function planOutputNames(files, types, reservedNames = []) {
  const names = new Map(),
    claimed = new Set(reservedNames.map(keyOf));
  for (const file of files) {
    const ext = path.extname(file);
    const original =
      types.get(file) === 'jpg' && ['.jpg', '.jpeg'].includes(ext.toLowerCase())
        ? path.basename(file)
        : `${path.basename(file, ext)}.jpg`;
    const suffix = path.extname(original),
      base = original.slice(0, -suffix.length);
    let candidate = original,
      index = 0;
    while (claimed.has(keyOf(candidate))) candidate = `${base}_${++index}${suffix}`;
    claimed.add(keyOf(candidate));
    names.set(file, candidate);
  }
  return { names, claimed };
}

function existingJpeg(target, maxBytes = null) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.size < 3)
    throw new JobError('OUTPUT_INVALID', 'Existing target is not a regular nonempty JPEG', target);
  if (maxBytes && stat.size >= maxBytes)
    throw new JobError(
      'OUTPUT_TOO_LARGE',
      `Existing output must be smaller than ${maxBytes} bytes; use rename to create a compliant result`,
      target
    );
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const header = Buffer.alloc(3);
    fs.readSync(fd, header, 0, 3, 0);
    if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
      throw new JobError('OUTPUT_INVALID', 'Existing target has no JPEG signature', target);
    }
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function publishOutput(source, expected, policy, claimed, maxBytes = null) {
  const ext = path.extname(expected),
    base = expected.slice(0, -ext.length);
  for (let suffix = 0; ; suffix++) {
    const target = suffix ? `${base}_${suffix}${ext}` : expected;
    if (suffix && claimed.has(keyOf(path.basename(target)))) continue;
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      return { output: target, skipped: false };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (policy === 'skip' && existingJpeg(target, maxBytes))
        return { output: target, skipped: true };
      if (policy === 'error') throw new JobError('OUTPUT_EXISTS', 'Output already exists', target);
    }
  }
}

module.exports = { planOutputNames, existingJpeg, publishOutput };
