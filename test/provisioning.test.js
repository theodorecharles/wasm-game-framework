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

    const validatorSuite = normalizeManifestCollection({
      namespace: 'validator-suite', version: 'v1',
      validator: {
        module: '/data-validator.mjs', export: 'validateFixture', version: 'shared-v2',
        policy: { signature: 'GAME', identity: 'root' }
      },
      variants: {
        alpha: { files: [{ key: 'game', name: 'game.bin', maxSize: 64, validator: { policy: { identity: 'alpha' } } }] },
        beta: { files: [{ key: 'raw', name: 'raw.bin', maxSize: 64, validator: false }] }
      }
    });
    assert.equal(validatorSuite.get('alpha').files[0].validator.module, '/data-validator.mjs');
    assert.equal(validatorSuite.get('alpha').files[0].validator.version, 'shared-v2');
    assert.equal(validatorSuite.get('alpha').files[0].validator.policy.identity, 'alpha');
    assert.equal(validatorSuite.get('beta').files[0].validator, null, 'per-file false opts out of inherited validation');

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
    assert.equal('validator' in optionalStatus.files[0], false, 'legacy status shape must not grow validator fields');
    assert.equal('validation' in optionalStatus.files[0], false, 'legacy status shape must remain compatible');

    const validatorRoot = path.join(__dirname, 'fixtures');
    const validatedRoot = path.join(root, 'validated-data');
    const validatedStore = createProvisioningStore({
      dataRoot: validatedRoot,
      validatorRoot,
      manifest: {
        namespace: 'generic-validator-test', version: 'content-v1',
        validator: {
          module: '/data-validator.mjs', export: 'validateFixture', version: 'fixture-validator-v2',
          maxReadBytes: 16, policy: { signature: 'GAME', identity: 'root-default' }
        },
        files: [{
          key: 'game', name: 'game.bin', path: 'game/game.bin', maxSize: 64,
          validator: { policy: { identity: 'server-fixture', contentVersion: 'v7', digest: 'SHA-256' } }
        }]
      }
    });
    let validatedStatus = await validatedStore.status();
    assert.equal(validatedStatus.ready, false);
    assert.equal(validatedStatus.files[0].validator.module, '/data-validator.mjs');
    assert.equal(validatedStatus.files[0].validator.version, 'fixture-validator-v2');
    assert.equal(validatedStatus.files[0].validator.policy.identity, 'server-fixture');
    await fsp.mkdir(path.join(validatedRoot, 'game'), { recursive: true });
    await fsp.writeFile(path.join(validatedRoot, 'game/game.bin'), 'OLD-invalid-data');
    await assert.rejects(
      validatedStore.acceptUpload('game', Readable.from(Buffer.from('NOPE-v1-payload'))),
      /expected GAME signature/
    );
    assert.equal(
      await fsp.readFile(path.join(validatedRoot, 'game/game.bin'), 'utf8'),
      'OLD-invalid-data',
      'a rejected upload must never replace the existing target'
    );
    const validatedBytes = Buffer.from('GAME-v1-payload');
    const validatedUpload = await validatedStore.acceptUpload('game', Readable.from(validatedBytes));
    assert.equal(validatedUpload.validation.identity, 'server-fixture');
    assert.equal(validatedUpload.validation.version, 'v7');
    assert.equal(validatedUpload.validation.fingerprint, crypto.createHash('sha256').update(validatedBytes).digest('hex'));
    assert.equal(validatedUpload.validation.bytesRead, 4, 'Node digest streams separately from bounded validator reads');
    validatedStatus = await validatedStore.status();
    assert.equal(validatedStatus.ready, true);
    assert.equal(validatedStatus.files[0].validation.identity, 'server-fixture');
    assert.equal(await fsp.readFile(path.join(validatedRoot, 'game/game.bin'), 'utf8'), 'GAME-v1-payload');
    assert.doesNotMatch(JSON.stringify(validatedStatus), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'status must not expose server filesystem paths');

    const symlinkSite = path.join(root, 'validator-site');
    const externalModule = path.join(root, 'outside-validator.mjs');
    await fsp.mkdir(symlinkSite);
    await fsp.copyFile(path.join(validatorRoot, 'data-validator.mjs'), externalModule);
    await fsp.symlink(externalModule, path.join(symlinkSite, 'escape.mjs'));
    const symlinkStore = createProvisioningStore({
      dataRoot: path.join(root, 'symlink-data'), validatorRoot: symlinkSite,
      manifest: { namespace: 'symlink-test', files: [{
        key: 'game', name: 'game.bin', maxSize: 64,
        validator: { module: '/escape.mjs', export: 'validateFixture', version: 'v1', policy: { signature: 'GAME' } }
      }] }
    });
    await assert.rejects(
      symlinkStore.acceptUpload('game', Readable.from(Buffer.from('GAME-v1-payload'))),
      /module \/escape\.mjs could not be loaded/
    );
    assert.equal(fs.existsSync(path.join(root, 'symlink-data/game.bin')), false);

    const exceptionRoot = path.join(root, 'exception-data');
    const exceptionStore = createProvisioningStore({
      dataRoot: exceptionRoot, validatorRoot,
      manifest: { namespace: 'exception-test', files: [{
        key: 'game', name: 'game.bin', maxSize: 64,
        validator: {
          module: '/data-validator.mjs', export: 'validateFixture', version: 'v1',
          policy: { throwMessage: `parser failed at ${exceptionRoot}\nsecond line` }
        }
      }] }
    });
    await assert.rejects(
      exceptionStore.acceptUpload('game', Readable.from(Buffer.from('GAME-v1-payload'))),
      error => {
        assert.equal(error.statusCode, 422);
        assert.match(error.message, /parser failed at \[path\] second line/);
        assert.doesNotMatch(error.message, new RegExp(exceptionRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      }
    );
    assert.equal(fs.existsSync(path.join(exceptionRoot, 'game.bin')), false);

    assert.throws(() => normalizeManifest({
      namespace: 'unsafe-validator', files: [{
        key: 'game', name: 'game.bin', validator: { module: '/data-validator.mjs' }
      }]
    }), /requires sizes or maxSize/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log('container game-data provisioning validation tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
