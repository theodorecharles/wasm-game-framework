'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const checker = path.join(__dirname, '..', 'scripts', 'check-game-package.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-framework-package-'));

function writeManifest(value) {
  fs.writeFileSync(path.join(root, 'wasm-game.json'), JSON.stringify(value));
}

function run() {
  return spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
}

function variant(title, persistence) {
  return {
    title,
    icon: '/icon.svg',
    displayMode: '4:3',
    pointerLock: false,
    fullscreen: true,
    controller: { mode: 'disabled' },
    persistence,
    pwa: {
      shortName: title,
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
    }
  };
}

try {
  fs.writeFileSync(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'game-adapter.js'), 'globalThis.WasmGameAdapter={start(){}};\n');

  writeManifest({
    id: 'fixture-suite', adapter: '/game-adapter.js', defaultVariant: 'one',
    variants: {
      one: variant('One', { root: '/save' }),
      two: variant('Two', { root: '/save' })
    }
  });
  let result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /persistence root \/save collides/);

  writeManifest({
    id: 'fixture-suite', adapter: '/game-adapter.js', defaultVariant: 'one',
    variants: {
      one: variant('One', { root: '/save/{variant}' }),
      two: variant('Two', { root: '/save/{variant}' })
    }
  });
  result = run();
  assert.equal(result.status, 0, result.stderr);

  const missing = variant('Missing', false);
  delete missing.controller;
  writeManifest({ id: 'missing-controller', adapter: '/game-adapter.js', ...missing });
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /controller capability must be explicit/);

  const missingPersistence = variant('Missing persistence', false);
  delete missingPersistence.persistence;
  writeManifest({ id: 'missing-persistence', adapter: '/game-adapter.js', ...missingPersistence });
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /persistence capability must be explicit/);

  console.log('explicit controller/persistence declarations and suite IDBFS isolation checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
