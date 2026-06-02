'use strict';

/*
 * Local dev server for testing against a REAL Azure Blob storage account
 * WITHOUT the Functions / SWA tooling.
 *
 * It reuses the exact same logic the deployed Functions use:
 *   - lib/images.js   (validation + sharp re-encode)
 *   - lib/config.js   (config whitelisting)
 *   - lib/storage.js  (blob read/write)
 *
 * Run from the repo root:
 *   node api/dev-server.js
 *
 * Reads settings from api/local.settings.json (the git-ignored file) so the
 * BLOB_CONNECTION_STRING never has to be typed on the command line.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---- Load api/local.settings.json -> process.env (Functions-style) ------- */
(function loadLocalSettings() {
  const file = path.join(__dirname, 'local.settings.json');
  if (!fs.existsSync(file)) {
    console.error(
      'Missing api/local.settings.json. Copy local.settings.json.example and ' +
        'set BLOB_CONNECTION_STRING.'
    );
    process.exit(1);
  }
  try {
    const values = JSON.parse(fs.readFileSync(file, 'utf8')).Values || {};
    for (const [k, v] of Object.entries(values)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (err) {
    console.error('Could not parse api/local.settings.json:', err.message);
    process.exit(1);
  }
})();

const { sanitizeImage, isValidId, isValidAssetName, MAX_SLIDES, generateId } =
  require('./src/lib/images');
const { sanitizeConfig, safeAssetRef } = require('./src/lib/config');
const { uploadBuffer, uploadJson, downloadBuffer } = require('./src/lib/storage');
const { isUploadAuthorized } = require('./src/lib/auth');

function isDataUrl(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

const ROOT = path.join(__dirname, '..'); // repo root (static site)
const PORT = process.env.PORT || 7071;
const MAX_BODY_BYTES = 60 * 1024 * 1024;

/* ---- Static file serving -------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal.
  const safePath = path
    .normalize(urlPath)
    .replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback to index.html
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) return res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream'
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---- API handlers (mirror the Functions in src/functions/*) --------------- */

async function handleSave(req, res) {
  // Optional shared-secret gate (no-op unless UPLOAD_KEY is set).
  if (!isUploadAuthorized(req.headers['x-upload-key'])) {
    return sendJson(res, 401, { error: 'Upload key required or invalid.' });
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return sendJson(res, 400, { error: 'Invalid JSON body.' });
  }

  const images = body && typeof body.images === 'object' ? body.images : {};
  const id = generateId();
  const config = sanitizeConfig(body && body.config);

  try {
    if (isDataUrl(images.logo)) {
      const out = await sanitizeImage(images.logo);
      const name = `logo.${out.ext}`;
      await uploadBuffer(`${id}/${name}`, out.buffer, out.contentType);
      config.logo = `/api/asset/${id}/${name}`;
    } else if (typeof images.logo === 'string') {
      const ref = safeAssetRef(images.logo);
      if (ref) config.logo = ref;
    }

    if (Array.isArray(images.slides) && images.slides.length) {
      if (images.slides.length > MAX_SLIDES) {
        return sendJson(res, 400, {
          error: `Too many background images (max ${MAX_SLIDES}).`
        });
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
    console.warn('Image processing rejected:', err.message);
    return sendJson(res, 400, { error: `Image rejected: ${err.message}` });
  }

  try {
    await uploadJson(`${id}/config.json`, config);
  } catch (err) {
    console.error('Failed to persist config:', err);
    return sendJson(res, 502, { error: 'Storage unavailable.' });
  }

  return sendJson(res, 201, { id }, { 'Cache-Control': 'no-store' });
}

async function handleConfig(req, res, id) {
  if (!isValidId(id)) return sendJson(res, 400, { error: 'Invalid id.' });
  let result;
  try {
    result = await downloadBuffer(`${id}/config.json`);
  } catch (err) {
    console.error('config download failed:', err);
    return sendJson(res, 502, { error: 'Storage unavailable.' });
  }
  if (!result) return sendJson(res, 404, { error: 'Not found.' });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=60'
  });
  res.end(result.buffer);
}

async function handleAsset(req, res, id, name) {
  if (!isValidId(id) || !isValidAssetName(name)) {
    return res.writeHead(400).end('Invalid asset reference.');
  }
  let result;
  try {
    result = await downloadBuffer(`${id}/${name}`);
  } catch (err) {
    console.error('asset download failed:', err);
    return res.writeHead(502).end('Storage unavailable.');
  }
  if (!result) return res.writeHead(404).end('Not found.');
  const contentType = /^image\//.test(result.contentType)
    ? result.contentType
    : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  res.end(result.buffer);
}

/* ---- Router --------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    if (req.method === 'POST' && url === '/api/save') {
      return await handleSave(req, res);
    }
    let m = url.match(/^\/api\/config\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      return await handleConfig(req, res, decodeURIComponent(m[1]));
    }
    m = url.match(/^\/api\/asset\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      return await handleAsset(
        req,
        res,
        decodeURIComponent(m[1]),
        decodeURIComponent(m[2])
      );
    }
    if (url.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Unknown API route.' });
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    return sendJson(res, 500, { error: 'Internal error.' });
  }
});

server.listen(PORT, () => {
  const account =
    (process.env.BLOB_CONNECTION_STRING || '').match(/AccountName=([^;]+)/);
  console.log(`\n  MWEventDisplay dev server running:`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(
    `   → storage: ${account ? account[1] : '(emulator/dev storage)'}`
  );
  console.log(`   → container: ${process.env.EVENTS_CONTAINER || 'events'}\n`);
});
