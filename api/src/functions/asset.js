'use strict';

const { app } = require('@azure/functions');
const { downloadBuffer } = require('../lib/storage');
const { isValidId, isValidAssetName } = require('../lib/images');

/*
 * Serves re-encoded images from the private container.
 * Everything we store here is a WebP we produced ourselves, but we still send
 * nosniff + an explicit image content-type so a blob can never be interpreted
 * as active content by the browser.
 */
app.http('asset', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'asset/{id}/{name}',
  handler: async (request, context) => {
    const { id, name } = request.params;
    if (!isValidId(id) || !isValidAssetName(name)) {
      return { status: 400, body: 'Invalid asset reference.' };
    }

    let result;
    try {
      result = await downloadBuffer(`${id}/${name}`);
    } catch (err) {
      context.error('asset download failed:', err);
      return { status: 502, body: 'Storage unavailable.' };
    }

    if (!result) {
      return { status: 404, body: 'Not found.' };
    }

    // Only ever advertise image content types for assets.
    const contentType = /^image\//.test(result.contentType)
      ? result.contentType
      : 'application/octet-stream';

    return {
      status: 200,
      body: result.buffer,
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    };
  }
});
