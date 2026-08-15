'use strict';

const assert = require('node:assert/strict');
const { createDataCache, requestStorageDurability } = require('../dist/wasm-game-framework.js');

(async () => {
  assert.equal(await requestStorageDurability({ storage: null, timeoutMs: 10 }), false,
    'an absent StorageManager API is a normal unsupported result');

  let requested = 0;
  assert.equal(await requestStorageDurability({
    storage: { persisted: async () => true, persist: async () => { requested += 1; return false; } },
    timeoutMs: 10
  }), true);
  assert.equal(requested, 0, 'an existing durability grant must not be requested again');

  assert.equal(await requestStorageDurability({
    storage: { persisted: async () => false, persist: async () => true }, timeoutMs: 10
  }), true, 'a granted request reports durable storage');

  assert.equal(await requestStorageDurability({
    storage: { persisted: async () => false, persist: async () => false }, timeoutMs: 10
  }), false, 'a denied request remains best-effort');

  assert.equal(await requestStorageDurability({
    storage: { persisted: async () => false, persist: async () => { throw new Error('denied'); } }, timeoutMs: 10
  }), false, 'a rejected request must not reject startup');

  const started = Date.now();
  assert.equal(await requestStorageDurability({
    storage: { persisted: async () => false, persist: () => new Promise(() => {}) }, timeoutMs: 20
  }), false, 'a never-settling request must time out');
  assert.ok(Date.now() - started < 250, 'a pending browser permission must remain tightly bounded');

  const previousNavigator = global.navigator;
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      storage: {
        persisted: async () => false,
        persist: () => new Promise(() => {}),
        estimate: async () => ({ usage: 23 })
      }
    }
  });
  try {
    const cacheStarted = Date.now();
    assert.deepEqual(await createDataCache({
      namespace: 'durability-timeout-fixture', version: '1', durabilityTimeoutMs: 20
    }).persist(), { persisted: false, estimate: { usage: 23 } });
    assert.ok(Date.now() - cacheStarted < 250,
      'the selected-media cache persistence seam must inherit the bounded request');
  } finally {
    Object.defineProperty(global, 'navigator', { configurable: true, value: previousNavigator });
  }

  assert.equal(await requestStorageDurability({
    storage: { persist: async () => true }, timeoutMs: 10
  }), true, 'persist() works when persisted() is absent');

  console.log('bounded storage durability true, false, reject, absent, and timeout contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
