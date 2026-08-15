'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url) {
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw last || new Error('server did not start');
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wasm-media-server.'));
  const site = path.join(root, 'site');
  const data = path.join(root, 'data');
  const shell = path.join(root, 'shell');
  const port = await availablePort();
  await Promise.all([fsp.mkdir(site), fsp.mkdir(data), fsp.mkdir(shell)]);
  await fsp.writeFile(path.join(site, 'wasm-game.json'), JSON.stringify({ id: 'media-fixture', title: 'Media Fixture' }));
  await fsp.copyFile(path.join(__dirname, 'fixtures/data-validator.mjs'), path.join(site, 'data-validator.mjs'));
  await fsp.copyFile(path.join(__dirname, '..', 'dist/index.html'), path.join(shell, 'index.html'));
  await fsp.writeFile(path.join(site, 'wasm-game-data.json'), JSON.stringify({
    namespace: 'media-fixture', version: 'v1', files: [],
    mediaLibrary: {
      minimumEntries: 1, maxFilesPerEntry: 3, maxFileBytes: 64, maxEntryBytes: 128,
      maxBrowserCacheBytes: 128, publicMetadata: ['kind'],
      validator: {
        module: '/data-validator.mjs', export: 'validateMediaFixture', version: 'media-fixture-v1',
        policy: { primary: 'game.cue', requiredFiles: ['track.bin'], signature: 'MEDIA', kind: 'disc' },
        maxReadBytes: 16, maxTotalReadBytes: 16
      }
    }
  }));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server/static-server.js')], {
    env: {
      ...process.env, WASM_GAME_SITE_ROOT: site, WASM_GAME_SHELL_ROOT: shell,
      WASM_GAME_DATA_ROOT: data, WASM_GAME_HTTP_PORT: String(port), WASM_SETUP_TOKEN: 'fixture-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/`);
    let status = await (await fetch(`${base}/game-data/status`)).json();
    assert.equal(status.fixedReady, true);
    assert.equal(status.ready, false);
    assert.equal(status.mediaLibrary.entries.length, 0);

    let response = await fetch(`${base}/game-data/media/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'game.cue', size: 16 }, { name: 'track.bin', size: 5 }] })
    });
    assert.equal(response.status, 401, 'media mutation must use the setup-token gate');
    response = await fetch(`${base}/game-data/media/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-secret' },
      body: JSON.stringify({ files: [{ name: 'game.cue', size: 16 }, { name: 'track.bin', size: 5 }] })
    });
    assert.equal(response.status, 201);
    const upload = await response.json();
    for (const [index, value] of ['MEDIA descriptor', 'track'].entries()) {
      response = await fetch(`${base}/game-data/media/uploads/${upload.id}/files/${upload.files[index].id}`, {
        method: 'PUT', headers: { authorization: 'Bearer fixture-secret' }, body: value
      });
      assert.equal(response.status, 201);
    }
    response = await fetch(`${base}/game-data/media/uploads/${upload.id}/commit`, {
      method: 'POST', headers: { authorization: 'Bearer fixture-secret' }
    });
    assert.equal(response.status, 201);
    const entry = await response.json();
    assert.doesNotMatch(JSON.stringify(entry), /game\.cue|track\.bin/);

    status = await (await fetch(`${base}/game-data/status`)).json();
    assert.equal(status.ready, true);
    assert.equal(status.mediaLibrary.entries[0].id, entry.id);
    const detail = await (await fetch(`${base}/game-data/media/entries/${entry.id}`)).json();
    assert.equal(detail.files.length, 2);
    const track = detail.files.find(file => file.name === 'track.bin');
    response = await fetch(`${base}/game-data/media/entries/${entry.id}/files/${track.id}`, {
      headers: { range: 'bytes=1-3' }
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/5');
    assert.equal(await response.text(), 'rac');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log('media-library HTTP protocol and range-delivery tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
