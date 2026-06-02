'use strict';

const crypto = require('crypto');
const sharp = require('sharp');

/* -------------------------------------------------------------------------
 * Limits — tuned for digital-signage screens, generous but abuse-resistant.
 * ---------------------------------------------------------------------- */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB per source image
const MAX_SLIDES = 12; // max background images per event
const MAX_OUTPUT_WIDTH = 3840; // cap to 4K
const MAX_OUTPUT_HEIGHT = 2160;

/* MIME allowlist. NOTE: SVG is deliberately excluded — it can carry script. */
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/* -------------------------------------------------------------------------
 * Unguessable, URL-safe id (~64 bits of entropy).
 * ---------------------------------------------------------------------- */
function generateId() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, [A-Za-z0-9_-]
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ASSET_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}
function isValidAssetName(name) {
  return (
    typeof name === 'string' &&
    ASSET_NAME_RE.test(name) &&
    !name.includes('..')
  );
}

/* -------------------------------------------------------------------------
 * Parse a `data:` URL into { mime, buffer }. Throws on anything unexpected.
 * ---------------------------------------------------------------------- */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('Image is not a data URL.');
  }
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Only base64 data URLs are accepted.');
  }
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`Unsupported image type: ${mime}`);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('Image is empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the size limit.');
  }
  return { mime, buffer };
}

/* -------------------------------------------------------------------------
 * Magic-byte sniffing — declared MIME must match the real bytes.
 * (Belt-and-braces; the re-encode below is the real protection.)
 * ---------------------------------------------------------------------- */
function detectType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 &&
      buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/* -------------------------------------------------------------------------
 * The core defense: decode the bytes and re-encode to a clean WebP.
 * - failAfter / limitInputPixels guard against decompression bombs.
 * - rotate() bakes in EXIF orientation, then all metadata is dropped.
 * - Any non-image payload simply fails to decode and is rejected.
 * Returns { buffer, contentType, ext }.
 * ---------------------------------------------------------------------- */
async function sanitizeImage(dataUrl) {
  const { mime, buffer } = parseDataUrl(dataUrl);

  const sniffed = detectType(buffer);
  if (!sniffed || sniffed !== mime) {
    throw new Error('Image contents do not match the declared type.');
  }

  const clean = await sharp(buffer, {
    failOn: 'error',
    limitInputPixels: 50_000_000, // ~50 MP guard against decompression bombs
    animated: false
  })
    .rotate()
    .resize({
      width: MAX_OUTPUT_WIDTH,
      height: MAX_OUTPUT_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 82 })
    // sharp drops all input metadata by default (no withMetadata()).
    .toBuffer();

  return { buffer: clean, contentType: 'image/webp', ext: 'webp' };
}

module.exports = {
  MAX_SLIDES,
  MAX_IMAGE_BYTES,
  generateId,
  isValidId,
  isValidAssetName,
  sanitizeImage
};
