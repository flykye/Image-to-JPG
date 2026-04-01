const fs = require('fs');
const path = require('path');

const EXTENSION_TYPE_MAP = {
  '.heic': 'heic',
  '.livp': 'livp',
  '.png': 'png',
  '.dng': 'dng',
  '.tif': 'tiff',
  '.tiff': 'tiff',
  '.jpg': 'jpg',
  '.jpeg': 'jpg'
};

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif']);

function readHeader(filePath, length = 64) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function detectHeaderType(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // PNG signature
  if (buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A) {
    return 'png';
  }

  // JPEG signature
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }

  // HEIC/HEIF via ftyp brand
  if (buffer.length >= 12) {
    const boxType = buffer.toString('ascii', 4, 8);
    if (boxType === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (HEIC_BRANDS.has(brand)) {
        return 'heic';
      }
    }
  }

  // ZIP signature (used by LIVP)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const sig = (buffer[2] << 8) | buffer[3];
    if (sig === 0x0304 || sig === 0x0506 || sig === 0x0708) {
      return 'zip';
    }
  }

  // TIFF signature (used by DNG)
  if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
    (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
    const ascii = buffer.toString('ascii');
    if (ascii.toUpperCase().includes('DNG')) {
      return 'dng';
    }
    return 'tiff';
  }

  return null;
}

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const extType = EXTENSION_TYPE_MAP[ext] || null;

  let headerType = null;
  try {
    const header = readHeader(filePath);
    headerType = detectHeaderType(header);
  } catch (error) {
    // If header read fails, fall back to extension-based detection
    return { type: extType, headerType: null, extType, warning: null, error };
  }

  let type = null;
  let effectiveHeaderType = headerType;
  if (headerType === 'zip') {
    type = extType === 'livp' ? 'livp' : null;
    if (extType === 'livp') effectiveHeaderType = 'livp';
  } else if (headerType === 'tiff') {
    type = 'tiff';
    effectiveHeaderType = 'tiff';
  } else if (headerType) {
    type = headerType;
  } else {
    type = extType;
  }

  let warning = null;
  if (effectiveHeaderType && extType && effectiveHeaderType !== extType) {
    warning = `Extension indicates ${extType.toUpperCase()} but file header indicates ${effectiveHeaderType.toUpperCase()}. Using header type.`;
  }

  return { type, headerType, extType, warning };
}

module.exports = {
  detectFileType
};
