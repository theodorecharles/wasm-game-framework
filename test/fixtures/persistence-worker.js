'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const Framework = require(workerData.frameworkScript);

const calls = [];
const FS = {
  filesystems: { IDBFS: { name: 'worker-idbfs' } },
  mkdirTree(root) { calls.push(['mkdirTree', root]); },
  mount(type, options, root) { calls.push(['mount', type.name, options, root]); },
  syncfs(populate, callback) {
    calls.push(['syncfs', Boolean(populate)]);
    setImmediate(() => callback(null));
  }
};

(async () => {
  const manager = Framework.createPersistenceManager({
    namespace: workerData.namespace,
    root: workerData.root,
    autoSave: false,
    intervalMs: 0,
    requestDurability: false
  });
  const mount = await manager.attach(FS);
  calls.push(['native-main', mount.status().initialized]);
  mount.markDirty();
  await manager.save();
  await manager.destroy();
  parentPort.postMessage({ version: Framework.version, namespace: manager.namespace, root: manager.root, calls });
})().catch(error => {
  parentPort.postMessage({ error: error.stack || String(error) });
});
