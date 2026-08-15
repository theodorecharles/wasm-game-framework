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
    { id: 'b'.repeat(32), label: 'Beta', fileCount: 1, totalSize: 8 }
  ];
  const bytes = new Map([[entries[0].id, 'MEDIA-A1'], [entries[1].id, 'MEDIA-B']]);
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
        limits: { maxBrowserCacheBytes: 64 }
      }
    });
    const detailMatch = /^\/game-data\/media\/entries\/([a-f0-9]{32})$/.exec(url.pathname);
    if (detailMatch) {
      const id = detailMatch[1];
      return Response.json({
        ...entries.find(entry => entry.id === id), primary: 'game.bin',
        files: [{ id: 'file-0', name: 'game.bin', size: bytes.get(id).length }],
        validator: declaration, cacheVersion: `v1:${id}`
      });
    }
    const fileMatch = /^\/game-data\/media\/entries\/([a-f0-9]{32})\/files\/file-0$/.exec(url.pathname);
    if (fileMatch) {
      downloads.push(fileMatch[1]);
      return new Response(bytes.get(fileMatch[1]), { headers: { 'content-length': String(bytes.get(fileMatch[1]).length) } });
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
