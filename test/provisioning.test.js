'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createProvisioningStore, normalizeManifest, normalizeManifestCollection } = require('../server/provisioning');

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wasm-game-data-test.'));
  try {
    const valid = Buffer.from('PACKowner-data');
    const manifest = normalizeManifest({
      namespace: 'quake-test',
      version: 'fixture-v1',
      files: [{
        key: 'pak0', name: 'pak0.pak', path: 'id1/pak0.pak', size: valid.length, magic: 'PACK',
        sha256: crypto.createHash('sha256').update(valid).digest('hex')
      }]
    });
    const store = createProvisioningStore({ dataRoot: root, manifest });
    const missing = await store.status();
    assert.equal(missing.ready, false);
    assert.equal(missing.files[0].error, 'missing');
    assert.equal(store.filePath(store.policyFor('pak0')), path.join(root, 'id1/pak0.pak'));
    await assert.rejects(store.acceptUpload('../pak0', Readable.from(valid)), /Invalid game-data key/);
    await assert.rejects(store.acceptUpload('pak0', Readable.from(Buffer.from('BAD!owner-data'))), /rejected/);
    assert.equal(fs.existsSync(path.join(root, 'id1/pak0.pak')), false, 'rejected uploads must not persist');
    const accepted = await store.acceptUpload('pak0', Readable.from(valid));
    assert.equal(accepted.valid, true);
    assert.equal((await store.status()).ready, true);
    assert.equal(await fsp.readFile(path.join(root, 'id1/pak0.pak'), 'utf8'), valid.toString());
    await assert.rejects(store.acceptUpload('pak0', Readable.from(valid)), /already valid/);

    const suite = normalizeManifestCollection({
      namespace: 'doom-suite', version: 'suite-v1', variants: {
        doom: { files: [{ key: 'doom', name: 'doom.wad', minSize: 1 }] },
        doom2: { files: [{ key: 'doom2', name: 'doom2.wad', minSize: 1 }] }
      }
    });
    assert.deepEqual(Array.from(suite.keys()), ['doom', 'doom2']);
    assert.equal(suite.get('doom').namespace, 'doom-suite-doom');
    assert.equal(suite.get('doom2').version, 'suite-v1');

    const optionalStore = createProvisioningStore({
      dataRoot: root,
      manifest: {
        namespace: 'optional-test', version: 'v1', files: [
          { key: 'pak0', name: 'pak0.pak', path: 'id1/pak0.pak', size: valid.length, magic: 'PACK' },
          { key: 'music', name: 'music.ogg', path: 'music/music.ogg', required: false, minSize: 1 }
        ]
      }
    });
    const optionalStatus = await optionalStore.status();
    assert.equal(optionalStatus.ready, true, 'a missing optional owner file must not block launch');
    assert.equal(optionalStatus.files[1].valid, false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log('container game-data provisioning validation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
