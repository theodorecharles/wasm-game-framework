'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createMediaLibraryStore, normalizeMediaLibrary } = require('../server/media-library');

function source(value) {
  return Readable.from([Buffer.from(value)]);
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wasm-media-library.'));
  const dataRoot = path.join(root, 'data');
  const siteRoot = path.join(root, 'site');
  await Promise.all([fsp.mkdir(dataRoot), fsp.mkdir(siteRoot)]);
  await fsp.copyFile(path.join(__dirname, 'fixtures/data-validator.mjs'), path.join(siteRoot, 'data-validator.mjs'));
  const manifest = {
    namespace: 'fixture-media', version: 'media-v1', minimumEntries: 1, maxEntries: 2,
    maxFilesPerEntry: 4, maxFileBytes: 64, maxEntryBytes: 128, maxBrowserCacheBytes: 96,
    publicMetadata: ['kind', 'files'],
    validator: {
      module: '/data-validator.mjs', export: 'validateMediaFixture', version: 'media-fixture-v1',
      policy: {
        primary: 'game.cue', requiredFiles: ['track01.bin'], signature: 'MEDIA',
        label: 'Fixture Disc', identity: 'fixture-disc', kind: 'disc'
      },
      maxReadBytes: 16, maxTotalReadBytes: 16
    }
  };
  const normalized = normalizeMediaLibrary(manifest);
  assert.equal(normalized.namespace, 'fixture-media');
  assert.equal(normalized.minimumEntries, 1);
  assert.equal(normalized.launcherVisibleWhenReady, true,
    'ROM-style libraries keep the selector visible by default');
  assert.equal(normalizeMediaLibrary({ ...manifest, launcherVisibleWhenReady: false }).launcherVisibleWhenReady, false);
  const store = createMediaLibraryStore({ dataRoot, validatorRoot: siteRoot, manifest });

  assert.equal((await store.status()).ready, false);
  assert.equal((await store.status()).launcherVisibleWhenReady, true);
  const upload = await store.beginUpload({ files: [
    { name: 'game.cue', size: 16 }, { name: 'track01.bin', size: 5 }
  ] });
  await store.acceptUploadFile(upload.id, upload.files[0].id, source('MEDIA descriptor'));
  await assert.rejects(store.commitUpload(upload.id), /missing track01\.bin/,
    'an incomplete bundle must never become visible');
  assert.deepEqual(await store.listEntries(), []);
  await store.acceptUploadFile(upload.id, upload.files[1].id, source('track'));
  const installed = await store.commitUpload(upload.id);
  assert.equal(installed.label, 'Fixture Disc');
  assert.equal(installed.fileCount, 2);
  assert.equal(installed.totalSize, 21);
  assert.deepEqual(installed.metadata, { kind: 'disc', files: 2 });
  const encodedSummary = JSON.stringify(installed);
  assert.doesNotMatch(encodedSummary, /game\.cue|track01\.bin|media\/fixture-media|\.incoming/,
    'public listing metadata must not disclose private paths or file names');
  assert.equal((await store.status()).ready, true);

  const detail = await store.detail(installed.id);
  assert.equal(detail.primary, 'game.cue');
  assert.deepEqual(detail.files.map(file => file.name), ['game.cue', 'track01.bin']);
  assert.equal(detail.cacheVersion, `media-v1:${installed.id}`);
  const track = await store.entryFilePath(installed.id, detail.files[1].id);
  assert.deepEqual(await fsp.readFile(track.path), Buffer.from('track'));

  const rejected = await store.beginUpload({ files: [{ name: 'game.cue', size: 4 }] });
  await store.acceptUploadFile(rejected.id, rejected.files[0].id, source('NOPE'));
  await assert.rejects(store.commitUpload(rejected.id), /Media bundle was rejected/);
  assert.equal((await store.listEntries()).length, 1, 'a rejected bundle must leave no partial entry');
  await assert.rejects(store.beginUpload({ files: [
    { name: 'same.bin', size: 1 }, { name: 'SAME.BIN', size: 1 }
  ] }), /Duplicate media-bundle path/);
  await assert.rejects(store.beginUpload({ files: [{ name: '../escape.bin', size: 1 }] }), /Invalid media-bundle path/);

  const held = await store.beginUpload({ files: [{ name: 'held.bin', size: 1 }] });
  await assert.rejects(store.beginUpload({ files: [{ name: 'overflow.bin', size: 1 }] }), /entry limit/,
    'active uploads must reserve an entry slot');
  await store.abortUpload(held.id);

  await fsp.rm(root, { recursive: true, force: true });
  console.log('atomic private media-library store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
