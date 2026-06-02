'use strict';

const crypto = require('crypto');

/*
 * Optional shared-secret gate for the upload endpoint.
 *
 * If the UPLOAD_KEY app setting is present, every POST /api/save must send a
 * matching `x-upload-key` header. If UPLOAD_KEY is NOT set, the gate is open
 * (preserves the original anonymous behaviour for local/dev use).
 *
 * Reads (GET /api/config, /api/asset) are never gated — the TVs stay anonymous.
 */
function uploadKeyRequired() {
  return !!process.env.UPLOAD_KEY;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/*
 * Returns true if the request is allowed to upload.
 * `provided` is the value of the x-upload-key header (or null).
 */
function isUploadAuthorized(provided) {
  if (!uploadKeyRequired()) return true;
  if (!provided) return false;
  return timingSafeEqual(provided, process.env.UPLOAD_KEY);
}

module.exports = { uploadKeyRequired, isUploadAuthorized };
