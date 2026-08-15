'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  normalizeMediaRelativeName,
  runMediaBundleValidator
} = require('../dist/wasm-game-framework.js');

function namedBlob(value, name) {
  const blob = new Blob([value]);
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

(async () => {
  const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures/data-validator.mjs')).href;
  const declaration = {
    module: '/data-validator.mjs', export: 'validateMediaFixture', version: 'media-fixture-v1',
    policy: {
      primary: 'disc/game.cue', requiredFiles: ['disc/track01.bin'], signature: 'MEDIA',
      label: 'Atomic fixture', identity: 'fixture-disc', kind: 'multi-file'
    },
    maxReadBytes: 16, maxTotalReadBytes: 16
  };
  const loadModule = async modulePath => {
    assert.equal(modulePath, '/data-validator.mjs');
    return import(fixtureUrl);
  };
  const sources = [
    namedBlob('MEDIA fixture descriptor', 'disc/game.cue'),
    namedBlob('track payload', 'disc/track01.bin')
  ];
  const result = await runMediaBundleValidator(sources, declaration, { loadModule });
  assert.equal(result.accepted, true);
  assert.equal(result.primary, 'disc/game.cue');
  assert.equal(result.label, 'Atomic fixture');
  assert.equal(result.identity, 'fixture-disc');
  assert.equal(result.bytesRead, 5);
  assert.equal(result.readCalls, 1);
  assert.deepEqual(result.metadata, { kind: 'multi-file', totalSize: 37, files: 2 });

  const missing = await runMediaBundleValidator([sources[0]], declaration, { loadModule });
  assert.equal(missing.accepted, false);
  assert.match(missing.error, /missing referenced file/);
  await assert.rejects(
    runMediaBundleValidator([sources[0], namedBlob('x', 'DISC/GAME.CUE')], declaration, { loadModule }),
    /Duplicate media-bundle path/
  );
  const noPrimary = await runMediaBundleValidator(sources, {
    ...declaration, policy: { ...declaration.policy, primary: 'absent.bin' }
  }, { loadModule });
  assert.equal(noPrimary.accepted, false);
  assert.match(noPrimary.error, /missing primary file/);
  await assert.rejects(
    runMediaBundleValidator(sources, {
      ...declaration, policy: { ...declaration.policy, secondRead: true }, maxTotalReadBytes: 5
    }, { loadModule }),
    /total bundle limit of 5 bytes/
  );
  for (const invalid of ['', '/root.bin', '../escape.bin', 'disc//track.bin', 'C:\\track.bin', 'line\nbreak.bin', `${'x'.repeat(256)}.bin`]) {
    assert.throws(() => normalizeMediaRelativeName(invalid), /Invalid media-bundle path/);
  }

  console.log('generic multi-file media-validator contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
