'use strict';

const assert = require('node:assert/strict');
const {
  fitRect,
  mapPointerPoint,
  resolveDisplayRect,
  detectCapabilities,
  requireCapabilities,
  createQualityController,
  createPersistentFs,
  createDiagnostics,
  createDataCache,
  createOwnerDataSet,
  createContainerDataClient,
  validateOwnerFile,
  mountOwnerFiles
} = require('../dist/wasm-game-framework.js');
const frameworkPackage = require('../package.json');

assert.equal(
  require('../dist/wasm-game-framework.js').version,
  frameworkPackage.version,
  'the public browser API version must match the released package'
);

assert.equal(typeof createContainerDataClient, 'function');
assert.equal(typeof detectCapabilities, 'function');
assert.equal(typeof requireCapabilities, 'function');
assert.equal(typeof createQualityController, 'function');
assert.equal(typeof createPersistentFs, 'function');
assert.equal(typeof createDiagnostics, 'function');

assert.deepEqual(fitRect(1920, 1080, 4 / 3, 'contain'), { width: 1440, height: 1080 });
assert.deepEqual(fitRect(800, 1200, 4 / 3, 'contain'), { width: 800, height: 600 });
assert.deepEqual(fitRect(1633, 594, 4 / 3, 'fill'), { width: 1633, height: 594 });
assert.deepEqual(mapPointerPoint({ left: 100, top: 50, width: 800, height: 600 }, 500, 350, 640, 480), {
  x: 320, y: 240, normalizedX: 0.5, normalizedY: 0.5, inside: true,
  targetWidth: 640, targetHeight: 480,
  clientRect: { left: 100, top: 50, width: 800, height: 600 },
  surfaceRect: { left: 100, top: 50, width: 800, height: 600 }
});
assert.deepEqual(
  mapPointerPoint({ left: 0, top: 0, width: 1646, height: 876 }, 823, 438, 640, 480, { fit: 'contain' }),
  {
    x: 320, y: 240, normalizedX: 0.5, normalizedY: 0.5, inside: true,
    targetWidth: 640, targetHeight: 480,
    clientRect: { left: 239, top: 0, width: 1168, height: 876 },
    surfaceRect: { left: 0, top: 0, width: 1646, height: 876 }
  }
);
const q3Pointer = mapPointerPoint(
  { left: 0, top: 0, width: 1646, height: 876 }, 1050, 300, 640, 480, { fit: 'contain' }
);
assert.ok(Math.abs(q3Pointer.x - 444.3835616438356) < 1e-9);
assert.ok(Math.abs(q3Pointer.y - 164.3835616438356) < 1e-9);
assert.deepEqual(fitRect(1600, 900, 16 / 9, 'contain'), { width: 1600, height: 900 });
assert.deepEqual(fitRect(803, 856, 4 / 3, 'contain'), { width: 803, height: 602.25 });
assert.deepEqual(resolveDisplayRect(1920, 1080, '4:3'), {
  width: 1440, height: 1080, displayMode: '4:3', nativeSynchronized: true
});
assert.deepEqual(resolveDisplayRect(1200, 1000, '16:9'), {
  width: 1200, height: 675, displayMode: '16:9', nativeSynchronized: true
});
assert.deepEqual(resolveDisplayRect(1633, 594, 'dynamic'), {
  width: 1633, height: 594, displayMode: 'dynamic', nativeSynchronized: true
});
assert.deepEqual(resolveDisplayRect(1633, 594, 'dynamic', {
  nativeManaged: true, bufferWidth: 800, bufferHeight: 600
}), {
  width: 792, height: 594, displayMode: 'dynamic', nativeSynchronized: false
});
assert.deepEqual(resolveDisplayRect(1633, 594, 'dynamic', {
  nativeManaged: true, bufferWidth: 800, bufferHeight: 600, resizeTransition: 'immediate'
}), {
  width: 1633, height: 594, displayMode: 'dynamic', nativeSynchronized: false
});
assert.deepEqual(resolveDisplayRect(1633, 594, 'dynamic', {
  nativeManaged: true, bufferWidth: 1633, bufferHeight: 594
}), {
  width: 1633, height: 594, displayMode: 'dynamic', nativeSynchronized: true
});
assert.match(
  require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/wasm-game-framework.css'), 'utf8'),
  /data-shell-engine-state="menu"/,
  'the shared shell must hide the host cursor while a native menu owns it'
);
const sharedCss = require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/wasm-game-framework.css'), 'utf8');
const sharedJs = require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/wasm-game-framework.js'), 'utf8');
assert.ok(
  sharedJs.indexOf("canvas.addEventListener('pointerup', publishPointerButton)") <
    sharedJs.indexOf("canvas.addEventListener('pointerup', captureAfterInteraction)"),
  'native pointer-up delivery must be registered before deferred capture evaluation'
);
assert.match(sharedJs, /captureFrame = requestAnimationFrame\(\(\) => \{/,
  'capture must be evaluated after the native engine receives a frame');
assert.match(sharedJs, /!captured && typeof config\.readEngineState === 'function'/,
  'pointer-lock loss must refresh native state before invoking capture-lost fallback');
assert.match(sharedCss, /\(hover: none\) and \(pointer: coarse\)/, 'desktop notice must require a mobile-like primary pointer');
assert.doesNotMatch(sharedCss, /max-width:[^}]+desktop-notice/s, 'a narrow desktop window must not trigger the mobile notice');

(async () => {
  const cache = createDataCache({ namespace: 'framework-test', version: 'fixture-v1' });
  await cache.clear();

  let loads = 0;
  const first = await cache.getOrLoad({
    key: 'PAK0.PAK',
    load: async () => {
      loads += 1;
      return new Blob(['PACK-fixture']);
    },
    validate: async file => assert.equal(await file.slice(0, 4).text(), 'PACK'),
    metadata: { expectedSize: 12 }
  });
  assert.equal(first.cached, false);
  assert.equal(loads, 1);

  const second = await cache.getOrLoad({
    key: 'pak0.pak',
    load: async () => {
      loads += 1;
      return new Blob(['should-not-load']);
    },
    validateCached: async file => assert.equal(await file.slice(0, 4).text(), 'PACK')
  });
  assert.equal(second.cached, true);
  assert.equal(loads, 1, 'a cache hit must not call the loader');
  assert.equal(second.metadata.expectedSize, 12);

  const concurrentCache = createDataCache({ namespace: 'framework-concurrency-test', version: 'fixture-v1' });
  await concurrentCache.clear();
  let concurrentLoads = 0;
  const load = () => concurrentCache.getOrLoad({
    key: 'pak1.pak',
    load: async () => {
      concurrentLoads += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Blob(['PACK-shared']);
    }
  });
  await Promise.all([load(), load(), load()]);
  assert.equal(concurrentLoads, 1, 'concurrent requests must share one load');

  let replacements = 0;
  const replacement = await cache.getOrLoad({
    key: 'pak0.pak',
    validateCached: async () => { throw new Error('fixture rejected'); },
    load: async () => {
      replacements += 1;
      return new Blob(['PACK-replacement']);
    }
  });
  assert.equal(replacement.cached, false);
  assert.equal(replacements, 1);
  assert.equal(await replacement.file.text(), 'PACK-replacement');

  await Promise.all([cache.clear(), concurrentCache.clear()]);

  const pak = new Blob(['PACKowner-data']);
  Object.defineProperty(pak, 'name', { value: 'PAK0.PAK' });
  await validateOwnerFile(pak, { key: 'pak0', names: ['pak0.pak'], size: 14, magic: 'PACK' });
  await assert.rejects(
    validateOwnerFile(pak, { key: 'pak0', names: ['pak0.pak'], size: 9, magic: 'PACK' }),
    /expected 9/
  );

  const ownerData = createOwnerDataSet({
    namespace: 'framework-owner-set-test',
    version: 'fixture-v1',
    files: [{ key: 'pak0', names: ['pak0.pak'], size: 14, magic: 'PACK', mountName: 'pak0.pak' }]
  });
  await ownerData.clear();
  const dataSet = await ownerData.load([pak], { persist: false });
  assert.equal(dataSet.entries.length, 1);
  assert.equal(dataSet.entries[0].cached, false);
  const restored = await ownerData.load([], { persist: false });
  assert.equal(restored.entries[0].cached, true, 'owner set restores without asking for source files');

  const optionalData = createOwnerDataSet({
    namespace: 'framework-optional-set-test',
    version: 'fixture-v1',
    files: [{ key: 'optional', name: 'optional.pak', required: false, magic: 'PACK' }]
  });
  await optionalData.clear();
  assert.equal((await optionalData.load([], { persist: false })).entries.length, 0);

  let expensiveValidations = 0;
  const trustedData = createOwnerDataSet({
    namespace: 'framework-trusted-cache-test',
    version: 'digest-policy-v1',
    files: [{
      key: 'pak0', name: 'pak0.pak', size: 14, magic: 'PACK', validateCached: false,
      validate: async () => { expensiveValidations += 1; }
    }]
  });
  await trustedData.clear();
  await trustedData.load([pak], { persist: false });
  await trustedData.load([], { persist: false });
  assert.equal(expensiveValidations, 1, 'trusted versioned cache restores must not repeat an expensive digest');

  const writes = [];
  const fakeFs = {
    mkdirTree(path) { writes.push(['mkdir', path]); },
    open(path) { const stream = { path, fd: 7, bytes: [] }; writes.push(['open', path]); return stream; },
    ftruncate(fd, size) { writes.push(['ftruncate', fd, size]); },
    write(stream, bytes) { stream.bytes.push(...bytes); writes.push(['write', stream.path, bytes.length]); },
    close(stream) { writes.push(['close', stream.path]); },
    chmod(path, mode) { writes.push(['chmod', path, mode]); }
  };
  const mounted = await mountOwnerFiles(fakeFs, dataSet, { root: '/id1', chunkBytes: 4 });
  assert.equal(mounted.mode, 'memfs');
  assert.ok(writes.some(event => event[0] === 'open' && event[1] === '/id1/pak0.pak'));
  assert.ok(writes.some(event => event[0] === 'ftruncate' && event[1] === 7 && event[2] === pak.size));

  const arrayWrites = [];
  const arrayFs = {
    mkdirTree(path) { arrayWrites.push(['mkdir', path]); },
    open(path) { const stream = { path, bytes: [] }; arrayWrites.push(['open', path]); return stream; },
    write(stream, bytes) { stream.bytes.push(...bytes); arrayWrites.push(['write', stream.path, bytes.length]); },
    close(stream) { arrayWrites.push(['close', stream.path]); },
    chmod(path, mode) { arrayWrites.push(['chmod', path, mode]); }
  };
  const arrayMounted = await mountOwnerFiles(arrayFs, dataSet.entries, { root: '/baseq2', chunkBytes: 4 });
  assert.equal(arrayMounted.files.length, 1, 'a direct entry array must not be confused with Array.prototype.entries');
  assert.ok(arrayWrites.some(event => event[0] === 'open' && event[1] === '/baseq2/pak0.pak'));

  const nestedEntries = [{ file: pak, mountName: 'movie/LOGO.SMK' }];
  const nestedWrites = [];
  const nestedFs = {
    mkdirTree(path) { nestedWrites.push(['mkdir', path]); },
    open(path) { nestedWrites.push(['open', path]); return { path }; },
    write() {}, close() {}, chmod() {}
  };
  await mountOwnerFiles(nestedFs, nestedEntries, {
    root: '/blood', mode: 'memfs', preservePaths: true, chunkBytes: 4, preallocate: false
  });
  assert.ok(nestedWrites.some(event => event[0] === 'mkdir' && event[1] === '/blood/movie'));
  assert.ok(nestedWrites.some(event => event[0] === 'open' && event[1] === '/blood/movie/LOGO.SMK'));
  await assert.rejects(
    mountOwnerFiles(nestedFs, [{ file: pak, mountName: '../escape.pak' }], {
      root: '/blood', mode: 'memfs', preservePaths: true
    }),
    /Invalid owner-data mount path/
  );

  let legacyStream;
  const legacyFs = {
    mkdirTree() {},
    open(path) { legacyStream = { path, node: { contents: [], contentMode: 2 } }; return legacyStream; },
    write() { throw new Error('legacy MEMFS must not use its array-growing write path'); },
    close() {},
    chmod() {}
  };
  const legacyMounted = await mountOwnerFiles(legacyFs, dataSet.entries, { root: '/baseq3', chunkBytes: 4 });
  assert.equal(legacyMounted.mode, 'memfs');
  assert.ok(legacyStream.node.contents instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(legacyStream.node.contents), 'PACKowner-data');
  assert.equal(legacyStream.node.contentMode, 3);

  const legacyPathCalls = [];
  const legacyPathFs = {
    createPath(parent, segment) { legacyPathCalls.push(['createPath', parent, segment]); },
    stat(path) {
      if (path === '/base/baseq3/pak0.pak') return { size: pak.size };
      return { size: 0 };
    },
    open() { throw new Error('a matching persistent owner file must be reused'); },
    chmod(path, mode) { legacyPathCalls.push(['chmod', path, mode]); }
  };
  const reused = await mountOwnerFiles(legacyPathFs, dataSet.entries, {
    root: '/base/baseq3', mode: 'memfs', chunkBytes: 4
  });
  assert.equal(reused.mode, 'memfs');
  assert.ok(legacyPathCalls.some(event => event[0] === 'createPath' && event[2] === 'baseq3'));
  assert.ok(legacyPathCalls.some(event => event[0] === 'chmod' && event[1] === '/base/baseq3/pak0.pak'));

  const replaced = [];
  const mismatchFs = {
    mkdirTree() {},
    stat(path) { if (path.endsWith('pak0.pak')) return { size: 1 }; return { size: 0 }; },
    chmod(path, mode) { replaced.push(['chmod', path, mode]); },
    unlink(path) { replaced.push(['unlink', path]); },
    open(path) { replaced.push(['open', path]); return { path, bytes: [] }; },
    write(stream, bytes) { stream.bytes.push(...bytes); },
    close() {}
  };
  await mountOwnerFiles(mismatchFs, dataSet.entries, { root: '/baseq3', chunkBytes: 4 });
  assert.ok(replaced.some(event => event[0] === 'unlink' && event[1] === '/baseq3/pak0.pak'));
  assert.ok(replaced.some(event => event[0] === 'open' && event[1] === '/baseq3/pak0.pak'));

  await Promise.all([ownerData.clear(), optionalData.clear(), trustedData.clear()]);
  console.log('shared web shell geometry, owner-data cache, validation, and mount tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
