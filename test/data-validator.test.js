'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  createOwnerDataSet,
  dataValidatorCacheTag,
  normalizeDataValidatorDeclaration,
  ownerFileValidation,
  runDataValidator,
  validateOwnerFile
} = require('../dist/wasm-game-framework.js');

function namedBlob(value, name) {
  const blob = new Blob([value]);
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

(async () => {
  const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures/data-validator.mjs')).href;
  let moduleLoads = 0;
  const loadModule = async modulePath => {
    assert.equal(modulePath, '/data-validator.mjs');
    moduleLoads += 1;
    return import(fixtureUrl);
  };
  const source = namedBlob('GAME-v1-payload', 'game.bin');
  const declaration = normalizeDataValidatorDeclaration({
    module: '/data-validator.mjs', export: 'validateFixture', version: 'fixture-validator-v2',
    policy: { signature: 'GAME', identity: 'fixture', contentVersion: 'v1', digest: 'SHA-256' },
    maxReadBytes: 16, maxTotalReadBytes: 16
  });
  assert.notEqual(
    dataValidatorCacheTag(declaration),
    dataValidatorCacheTag({ ...declaration, version: 'fixture-validator-v3' }),
    'validator module versions participate in validation cache identity'
  );
  assert.notEqual(
    dataValidatorCacheTag(declaration),
    dataValidatorCacheTag({ ...declaration, policy: { ...declaration.policy, identity: 'changed' } }),
    'validator policies participate in validation cache identity'
  );
  const expectedDigest = crypto.createHash('sha256').update('GAME-v1-payload').digest('hex');
  const first = await runDataValidator(source, declaration, { loadModule });
  assert.equal(first.accepted, true);
  assert.equal(first.identity, 'fixture');
  assert.equal(first.version, 'v1');
  assert.equal(first.fingerprint, expectedDigest);
  assert.equal(first.validatorVersion, 'fixture-validator-v2');
  assert.deepEqual(first.metadata, { signature: 'GAME', inspected: 4 });
  assert.equal(first.bytesRead, 4);
  await runDataValidator(source, declaration, { loadModule });
  assert.equal(moduleLoads, 1, 'validator module imports are cached for a loader/module pair');

  await validateOwnerFile(source, {
    key: 'game', name: 'game.bin', maxSize: 64, sha256: [expectedDigest], validator: declaration
  }, null, { loadModule });
  assert.equal(ownerFileValidation(source).identity, 'fixture', 'browser owner-file validation retains validator metadata');
  await assert.rejects(
    validateOwnerFile(namedBlob('NOPE-v1-payload', 'game.bin'), {
      key: 'game', name: 'game.bin', maxSize: 64, validator: declaration
    }, null, { loadModule }),
    /expected GAME signature/
  );
  await assert.rejects(
    validateOwnerFile(source, {
      key: 'game', name: 'game.bin', maxSize: 64, sha256: ['0'.repeat(64)]
    }),
    /unrecognized SHA-256 digest/
  );

  await assert.rejects(runDataValidator(source, {
    ...declaration, policy: { signature: 'GAME', readBytes: 5 }, maxReadBytes: 4
  }, { loadModule }), /per-call limit of 4 bytes/);
  await assert.rejects(runDataValidator(source, {
    ...declaration, policy: { signature: 'GAME', readBeyond: true }
  }, { loadModule }), /extends beyond the end of the file/);
  await assert.rejects(runDataValidator(source, {
    ...declaration, policy: { signature: 'GAME', secondRead: true }, maxTotalReadBytes: 4
  }, { loadModule }), /total limit of 4 bytes/);
  await assert.rejects(runDataValidator(source, {
    ...declaration, policy: { throwMessage: 'fixture exploded\nwith controls' }
  }, { loadModule }), /Data validator failed: fixture exploded with controls/);
  assert.throws(
    () => normalizeDataValidatorDeclaration({ module: '/../escape.mjs' }),
    /traversal-safe/
  );

  const dataSet = createOwnerDataSet({
    namespace: 'generic-validator-test', version: 'data-v1',
    validator: {
      module: '/data-validator.mjs', export: 'validateFixture', version: 'fixture-validator-v2',
      maxReadBytes: 16, policy: { signature: 'GAME', identity: 'root-default' }
    },
    files: [{
      key: 'game', name: 'game.bin', maxSize: 64,
      validator: { policy: { identity: 'file-override' } }
    }]
  });
  await dataSet.clear();
  const loaded = await dataSet.load([source], { persist: false, validationOptions: { loadModule } });
  assert.equal(loaded.entries[0].metadata.dataValidation.identity, 'file-override');
  assert.equal(loaded.entries[0].metadata.dataValidation.validatorVersion, 'fixture-validator-v2');

  const changedVersion = createOwnerDataSet({
    namespace: 'generic-validator-test', version: 'data-v1',
    validator: {
      module: '/data-validator.mjs', export: 'validateFixture', version: 'fixture-validator-v3',
      maxReadBytes: 16, policy: { signature: 'GAME' }
    },
    files: [{ key: 'game', name: 'game.bin', maxSize: 64 }]
  });
  await assert.rejects(
    changedVersion.load([], { persist: false, validationOptions: { loadModule } }),
    /Required owner file game\.bin was not provided/,
    'validator version changes must invalidate the browser record'
  );
  await dataSet.load([source], { persist: false, validationOptions: { loadModule } });
  const changedPolicy = createOwnerDataSet({
    namespace: 'generic-validator-test', version: 'data-v1',
    validator: {
      module: '/data-validator.mjs', export: 'validateFixture', version: 'fixture-validator-v2',
      maxReadBytes: 16, policy: { signature: 'GAME', identity: 'changed-policy' }
    },
    files: [{ key: 'game', name: 'game.bin', maxSize: 64 }]
  });
  await assert.rejects(
    changedPolicy.load([], { persist: false, validationOptions: { loadModule } }),
    /Required owner file game\.bin was not provided/,
    'validator policy changes must invalidate the browser record'
  );
  await Promise.all([dataSet.clear(), changedVersion.clear(), changedPolicy.clear()]);

  console.log('generic downstream data-validator contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
