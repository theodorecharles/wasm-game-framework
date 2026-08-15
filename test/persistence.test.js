'use strict';

const assert = require('node:assert/strict');
const {
  createPersistentFs,
  createPersistenceManager,
  resolvePersistenceRoot
} = require('../dist/wasm-game-framework.js');

assert.equal(resolvePersistenceRoot('/save/{variant}', { namespace: 'idtech1', variant: 'doom2' }), '/save/doom2');
assert.equal(resolvePersistenceRoot('/persistent/{namespace}', { namespace: 'idtech3/quake3', variant: 'quake3' }),
  '/persistent/idtech3-quake3');
assert.throws(() => resolvePersistenceRoot('/save/{variant}/../escape', { variant: 'doom' }), /traversal/);

class Events {
  constructor() {
    this.listeners = new Map();
    this.visibilityState = 'visible';
  }

  addEventListener(type, callback) {
    const values = this.listeners.get(type) || [];
    values.push(callback);
    this.listeners.set(type, values);
  }

  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }

  dispatch(type) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({ type });
  }
}

function fakeFs(options = {}) {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  let syncFailures = Number(options.syncFailures) || 0;
  const FS = {
    filesystems: options.idbfs === false ? {} : { IDBFS: { name: 'IDBFS' } },
    mount(type, mountOptions, root) { calls.push(['mount', type, mountOptions, root]); },
    syncfs(populate, callback) {
      calls.push(['syncfs', Boolean(populate)]);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      setTimeout(() => {
        active -= 1;
        if (syncFailures > 0) {
          syncFailures -= 1;
          callback(new Error('fixture sync failure'));
        } else callback(options.syncError || null);
      }, 1);
    }
  };
  if (options.legacy) {
    FS.createPath = (parent, name) => calls.push(['createPath', parent, name]);
  } else {
    FS.mkdirTree = root => calls.push(['mkdirTree', root]);
  }
  return { FS, calls, maximumActive: () => maximumActive };
}

async function tick(milliseconds = 8) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

(async () => {
  const visibility = new Events();
  const page = new Events();
  const primary = fakeFs();
  const states = [];
  const manager = createPersistenceManager({
    namespace: 'doom-2',
    root: '/save/doom2',
    visibilityTarget: visibility,
    pageTarget: page,
    debounceMs: 0,
    intervalMs: 0,
    requestDurability: false,
    onStatus: state => states.push(state)
  });

  assert.equal(manager.namespace, 'doom-2');
  assert.equal(manager.root, '/save/doom2');
  const mount = await manager.attach(primary.FS);
  assert.equal(mount.root, '/save/doom2');
  assert.deepEqual(primary.calls.slice(0, 3), [
    ['mkdirTree', '/save/doom2'],
    ['mount', primary.FS.filesystems.IDBFS, {}, '/save/doom2'],
    ['syncfs', true]
  ]);
  assert.deepEqual(mount.status(), {
    namespace: 'doom-2', root: '/save/doom2', initialized: true,
    supported: true, dirty: false, lastSavedAt: 0, lastError: null
  });

  mount.markDirty();
  assert.equal(mount.status().dirty, true);
  await tick();
  assert.equal(primary.calls.filter(call => call[0] === 'syncfs' && call[1] === false).length, 1,
    'markDirty must debounce a browser write');
  assert.equal(mount.status().dirty, false);
  assert.ok(mount.status().lastSavedAt > 0);

  visibility.visibilityState = 'hidden';
  visibility.dispatch('visibilitychange');
  page.dispatch('pagehide');
  await tick(12);
  assert.ok(primary.calls.filter(call => call[0] === 'syncfs' && call[1] === false).length >= 3,
    'visibility and page exit must flush writable state');
  assert.equal(primary.maximumActive(), 1, 'IDBFS operations must remain serialized');

  assert.equal(manager.status().attached, 1);
  await manager.save();
  await manager.destroy();
  const callsAfterDestroy = primary.calls.length;
  visibility.dispatch('visibilitychange');
  page.dispatch('pagehide');
  await tick();
  assert.equal(primary.calls.length, callsAfterDestroy, 'destroy must remove lifecycle flush listeners');
  assert.ok(states.length >= 3);

  const legacy = fakeFs({ legacy: true });
  const legacyMount = createPersistentFs({
    FS: legacy.FS, namespace: 'legacy quake', root: '/home/quake/id1',
    intervalMs: 0, autoSave: false, requestDurability: false
  });
  assert.equal(await legacyMount.initialize(), true);
  assert.deepEqual(legacy.calls.filter(call => call[0] === 'createPath'), [
    ['createPath', '/', 'home'],
    ['createPath', '/home', 'quake'],
    ['createPath', '/home/quake', 'id1']
  ]);
  await legacyMount.destroy();

  const unsupported = fakeFs({ idbfs: false });
  const unavailable = createPersistentFs({ FS: unsupported.FS, intervalMs: 0 });
  assert.equal(await unavailable.initialize(), false);
  assert.equal(unavailable.status().supported, false);
  assert.equal(await unavailable.save(), false);
  await unavailable.destroy();
  const unsupportedManager = createPersistenceManager({ intervalMs: 0 });
  await assert.rejects(unsupportedManager.attach(unsupported.FS), /does not expose Emscripten IDBFS/);
  assert.equal(unsupportedManager.status().attached, 0);

  const concurrent = fakeFs();
  const concurrentMount = createPersistentFs({
    FS: concurrent.FS, root: '/persist/concurrent', intervalMs: 0,
    autoSave: false, requestDurability: false
  });
  assert.deepEqual(await Promise.all([concurrentMount.initialize(), concurrentMount.initialize()]), [true, true]);
  assert.equal(concurrent.calls.filter(call => call[0] === 'mount').length, 1,
    'simultaneous restore calls must share one IDBFS mount');
  assert.equal(concurrent.calls.filter(call => call[0] === 'syncfs' && call[1] === true).length, 1,
    'simultaneous restore calls must share one populate operation');
  await concurrentMount.destroy();

  const retry = fakeFs({ syncFailures: 1 });
  const retryMount = createPersistentFs({
    FS: retry.FS, root: '/persist/retry', intervalMs: 0,
    autoSave: false, requestDurability: false
  });
  await assert.rejects(retryMount.initialize(), /fixture sync failure/);
  assert.equal(retryMount.status().initialized, false);
  assert.equal(await retryMount.initialize(), true, 'a failed browser restore must be retryable');
  await retryMount.destroy();

  console.log('save, config, keybinding, lifecycle flush, legacy FS, and unsupported persistence contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
