'use strict';

const { app } = require('@azure/functions');
const { downloadBuffer } = require('../lib/storage');
const { isValidId } = require('../lib/images');

app.http('config', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config/{id}',
  handler: async (request, context) => {
    const id = request.params.id;
    if (!isValidId(id)) {
      return { status: 400, jsonBody: { error: 'Invalid id.' } };
    }

    let result;
    try {
      result = await downloadBuffer(`${id}/config.json`);
    } catch (err) {
      context.error('config download failed:', err);
      return { status: 502, jsonBody: { error: 'Storage unavailable.' } };
    }

    if (!result) {
      return { status: 404, jsonBody: { error: 'Not found.' } };
    }

    return {
      status: 200,
      body: result.buffer,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=60'
      }
    };
  }
});
