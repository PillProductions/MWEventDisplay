'use strict';

const { app } = require('@azure/functions');
const { uploadBuffer, uploadJson } = require('../lib/storage');
const {
  generateId,
  isValidId,
  sanitizeImage,
  MAX_SLIDES,
  MAX_IMAGE_BYTES
} = require('../lib/images');
const { sanitizeConfig, safeAssetRef } = require('../lib/config');
const { isUploadAuthorized } = require('../lib/auth');

/* A base64 image payload (vs. an existing ref we just pass through). */
function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

/* Hard cap on the whole request body (base64 inflates ~33%). */
const MAX_BODY_BYTES = 60 * 1024 * 1024; // 60 MB

function bad(status, message) {
  return { status, jsonBody: { error: message } };
}

app.http('save', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'save',
  handler: async (request, context) => {
    // Optional shared-secret gate (no-op unless UPLOAD_KEY app setting is set).
    if (!isUploadAuthorized(request.headers.get('x-upload-key'))) {
      return { status: 401, jsonBody: { error: 'Upload key required or invalid.' } };
    }

    // Cheap pre-check before reading the (potentially large) body.
    const declaredLen = Number(request.headers.get('content-length') || 0);
    if (declaredLen && declaredLen > MAX_BODY_BYTES) {
      return bad(413, 'Payload too large.');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return bad(400, 'Invalid JSON body.');
    }

    const images = body && typeof body.images === 'object' ? body.images : {};
    const id = generateId();

    // Sanitize text/config first (cheap, fail fast).
    const config = sanitizeConfig(body && body.config);

    try {
      // ---- Logo ----------------------------------------------------------
      // images.logo may be a new upload (data URL) or omitted (keep config ref).
      if (isDataUrl(images.logo)) {
        const out = await sanitizeImage(images.logo);
        const name = `logo.${out.ext}`;
        await uploadBuffer(`${id}/${name}`, out.buffer, out.contentType);
        config.logo = `/api/asset/${id}/${name}`;
      } else if (typeof images.logo === 'string') {
        const ref = safeAssetRef(images.logo);
        if (ref) config.logo = ref;
      }

      // ---- Slides --------------------------------------------------------
      // images.slides is the FULL ordered list. Each entry is either a new
      // upload (data URL) or an existing/default reference we pass through.
      if (Array.isArray(images.slides) && images.slides.length) {
        if (images.slides.length > MAX_SLIDES) {
          return bad(400, `Too many background images (max ${MAX_SLIDES}).`);
        }
        const slideRefs = [];
        let uploadIdx = 0;
        for (const entry of images.slides) {
          if (isDataUrl(entry)) {
            const out = await sanitizeImage(entry);
            const name = `slide-${uploadIdx++}.${out.ext}`;
            await uploadBuffer(`${id}/${name}`, out.buffer, out.contentType);
            slideRefs.push(`/api/asset/${id}/${name}`);
          } else {
            const ref = safeAssetRef(entry);
            if (ref) slideRefs.push(ref);
          }
        }
        config.slides = slideRefs;
      }
    } catch (err) {
      context.warn('Image processing rejected:', err.message);
      return bad(400, `Image rejected: ${err.message}`);
    }

    if (!isValidId(id)) {
      // Should never happen, but never write a malformed id.
      return bad(500, 'Internal id generation error.');
    }

    try {
      await uploadJson(`${id}/config.json`, config);
    } catch (err) {
      context.error('Failed to persist config:', err);
      return bad(502, 'Storage unavailable.');
    }

    return {
      status: 201,
      jsonBody: { id },
      headers: { 'Cache-Control': 'no-store' }
    };
  }
});

module.exports = { MAX_BODY_BYTES, MAX_IMAGE_BYTES };
