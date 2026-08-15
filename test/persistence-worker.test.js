'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

(async () => {
  const frameworkScript = path.resolve(__dirname, '../dist/wasm-game-framework.js');
  const fixture = path.resolve(__dirname, 'fixtures/persistence-worker.js');
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(fixture, {
      workerData: { frameworkScript, namespace: 'idtech4-doom3', root: '/save/doom3' }
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`worker exited with ${code}`)); });
  });
  if (result.error) throw new Error(result.error);
  assert.equal(result.version, '0.9.1');
  assert.equal(result.namespace, 'idtech4-doom3');
  assert.equal(result.root, '/save/doom3');
  assert.deepEqual(result.calls.slice(0, 4), [
    ['mkdirTree', '/save/doom3'],
    ['mount', 'worker-idbfs', {}, '/save/doom3'],
    ['syncfs', true],
    ['native-main', true]
  ], 'the worker must restore IDBFS before entering native main');
  assert.deepEqual(result.calls.filter(call => call[0] === 'syncfs').map(call => call[1]), [true, false, false],
    'the same worker-local manager must restore, explicitly flush, and flush on destroy');
  console.log('worker-local persistence manager contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
