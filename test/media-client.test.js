'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createContainerDataClient } = require('../dist/wasm-game-framework.js');

const previous = {
  document: global.document, fetch: global.fetch, indexedDB: global.indexedDB,
  localStorage: global.localStorage, location: global.location, navigator: global.navigator
};

(async () => {
  const selections = new Map();
  const downloads = [];
  const entries = [
    { id: 'a'.repeat(32), label: 'Alpha', fileCount: 1, totalSize: 9 },
    { id: 'b'.repeat(32), label: 'Beta', fileCount: 1, totalSize: 8 },
    { id: 'c'.repeat(32), label: 'Bulk', fileCount: 24, totalSize: 192 }
  ];
  const bytes = new Map([[entries[0].id, 'MEDIA-A1'], [entries[1].id, 'MEDIA-B']]);
  let activeDownloads = 0;
  let maximumActiveDownloads = 0;
  const declaration = {
    module: '/data-validator.mjs', export: 'validateMediaFixture', version: 'media-fixture-v1',
    policy: { primary: 'game.bin', signature: 'MEDIA' }, maxReadBytes: 16, maxTotalReadBytes: 16
  };
  global.location = new URL('http://fixture.test/');
  global.document = { querySelector: () => null, querySelectorAll: () => [] };
  global.indexedDB = undefined;
  global.localStorage = {
    getItem: key => selections.get(key) || null,
    setItem: (key, value) => selections.set(key, String(value))
  };
  Object.defineProperty(global, 'navigator', {
    configurable: true, value: { storage: { persisted: async () => true, estimate: async () => ({ usage: 17 }) } }
  });
  global.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/game-data/status') return Response.json({
      configured: true, fixedReady: true, ready: true, files: [],
      mediaLibrary: {
        configured: true, namespace: 'client-fixture', version: 'v1', ready: true,
        minimumEntries: 1, entries,
        limits: { maxBrowserCacheBytes: 512 }
      }
    });
    const detailMatch = /^\/game-data\/media\/entries\/([a-f0-9]{32})$/.exec(url.pathname);
    if (detailMatch) {
      const id = detailMatch[1];
      const files = id === entries[2].id
        ? Array.from({ length: 24 }, (_, index) => ({
          id: `file-${index.toString(36)}`,
          name: index ? `asset-${index}.bin` : 'game.bin',
          size: 8
        }))
        : [{ id: 'file-0', name: 'game.bin', size: bytes.get(id).length }];
      return Response.json({
        ...entries.find(entry => entry.id === id), primary: 'game.bin',
        files,
        validator: declaration, cacheVersion: `v1:${id}`
      });
    }
    const fileMatch = /^\/game-data\/media\/entries\/([a-f0-9]{32})\/files\/(file-[a-z0-9]+)$/.exec(url.pathname);
    if (fileMatch) {
      downloads.push(fileMatch[1]);
      const body = fileMatch[1] === entries[2].id ?
        (fileMatch[2] === 'file-0' ? 'MEDIA-C1' : `ASSET-${fileMatch[2].slice(5).padStart(2, '0')}`.slice(0, 8)) :
        bytes.get(fileMatch[1]);
      if (fileMatch[1] === entries[2].id) {
        activeDownloads += 1;
        maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
        await new Promise(resolve => setTimeout(resolve, 5));
        activeDownloads -= 1;
      }
      return new Response(body, { headers: { 'content-length': String(body.length) } });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures/data-validator.mjs')).href;
  const validationOptions = { loadModule: async () => import(fixtureUrl) };
  const client = createContainerDataClient();

  const alpha = await client.media.load(entries[0].id, { validationOptions });
  assert.equal(alpha.primary, 'game.bin');
  assert.equal(alpha.entries[0].mountName, 'game.bin');
  assert.deepEqual(downloads, [entries[0].id]);
  await client.media.load(entries[0].id, { validationOptions });
  assert.deepEqual(downloads, [entries[0].id], 'reloading the selected entry must use the private cache');

  await client.media.load(entries[1].id, { validationOptions });
  assert.deepEqual(downloads, [entries[0].id, entries[1].id]);
  assert.equal(await alpha.cache.get('file-0'), null,
    'switching selection must remove the prior entry from the library cache');
  await client.media.load(entries[0].id, { validationOptions });
  assert.deepEqual(downloads, [entries[0].id, entries[1].id, entries[0].id],
    'a deselected entry must be downloaded again after the selected-only cache changes');

  const directClient = createContainerDataClient({
    media: entries[0].id, mediaExplicit: true, mediaSource: 'query'
  });
  const directLibrary = await directClient.media.status();
  assert.equal(directClient.media.selected(directLibrary), entries[0].id);
  directClient.media.select(entries[1].id, directLibrary);
  assert.equal(directClient.media.selected(directLibrary), entries[1].id,
    'a query-selected media entry must remain changeable');

  const missingClient = createContainerDataClient({
    media: 'd'.repeat(32), mediaExplicit: true, mediaSource: 'query'
  });
  assert.equal(missingClient.media.selected(directLibrary), '',
    'an unavailable explicit media ID must never select the first installed entry');
  await assert.rejects(missingClient.media.load(undefined, { validationOptions }), error =>
    error.code === 'MEDIA_SELECTION_UNAVAILABLE');

  const lockedClient = createContainerDataClient({
    media: entries[0].id, mediaExplicit: true, mediaLocked: true, mediaSource: 'deployment'
  });
  assert.equal(lockedClient.media.select(entries[1].id, directLibrary), entries[0].id,
    'a deployment lock must ignore downstream selection attempts');
  await assert.rejects(lockedClient.media.load(entries[1].id, { validationOptions }), error =>
    error.code === 'MEDIA_SELECTION_LOCKED');

  const progress = [];
  const bulk = await client.media.load(entries[2].id, {
    validationOptions,
    concurrency: 6,
    onProgress(detail) {
      if (detail.phase === 'cached-media') progress.push(detail.index);
    }
  });
  assert.equal(bulk.entries.length, 24);
  assert.deepEqual(bulk.entries.map(entry => entry.mountName),
    ['game.bin', ...Array.from({ length: 23 }, (_, index) => `asset-${index + 1}.bin`)],
    'parallel restoration must preserve manifest order');
  assert(maximumActiveDownloads > 1 && maximumActiveDownloads <= 6,
    `media concurrency must stay bounded, observed ${maximumActiveDownloads}`);
  assert.deepEqual(progress, Array.from({ length: 24 }, (_, index) => index),
    'parallel completion progress must remain monotonic');

  const tooLargeStatus = global.fetch;
  global.fetch = async input => {
    const response = await tooLargeStatus(input);
    const url = new URL(String(input));
    if (url.pathname === '/game-data/status') {
      const body = await response.json();
      body.mediaLibrary.limits.maxBrowserCacheBytes = 1;
      return Response.json(body);
    }
    return response;
  };
  await assert.rejects(client.media.load(entries[0].id, { validationOptions }), error =>
    error.code === 'MEDIA_RANDOM_ACCESS_REQUIRED');

  console.log('selected-only browser media cache and fail-closed size gate tests passed');
})().finally(() => {
  global.document = previous.document;
  global.fetch = previous.fetch;
  global.indexedDB = previous.indexedDB;
  global.localStorage = previous.localStorage;
  global.location = previous.location;
  Object.defineProperty(global, 'navigator', { configurable: true, value: previous.navigator });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
