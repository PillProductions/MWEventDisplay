'use strict';

const { BlobServiceClient } = require('@azure/storage-blob');

/*
 * Returns a (cached) container client for the private "events" container.
 * Connection string comes from BLOB_CONNECTION_STRING, falling back to the
 * AzureWebJobsStorage value that Static Web Apps / Functions already define.
 */

const CONTAINER_NAME = process.env.EVENTS_CONTAINER || 'events';

let containerClientPromise = null;

function getConnectionString() {
  const conn =
    process.env.BLOB_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!conn) {
    throw new Error(
      'No storage connection string configured (set BLOB_CONNECTION_STRING or AzureWebJobsStorage).'
    );
  }
  return conn;
}

function getContainerClient() {
  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const service = BlobServiceClient.fromConnectionString(
        getConnectionString()
      );
      const container = service.getContainerClient(CONTAINER_NAME);
      // Private container (no public access). Create if missing.
      await container.createIfNotExists();
      return container;
    })().catch(err => {
      // Reset so a transient failure can be retried on the next request.
      containerClientPromise = null;
      throw err;
    });
  }
  return containerClientPromise;
}

async function uploadBuffer(blobName, buffer, contentType) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  await blob.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      blobCacheControl: 'public, max-age=31536000, immutable'
    }
  });
}

async function uploadJson(blobName, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  await blob.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: 'application/json; charset=utf-8',
      blobCacheControl: 'public, max-age=60'
    }
  });
}

async function downloadBuffer(blobName) {
  const container = await getContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  if (!(await blob.exists())) return null;
  const buffer = await blob.downloadToBuffer();
  const props = await blob.getProperties();
  return { buffer, contentType: props.contentType || 'application/octet-stream' };
}

module.exports = {
  CONTAINER_NAME,
  getContainerClient,
  uploadBuffer,
  uploadJson,
  downloadBuffer
};
