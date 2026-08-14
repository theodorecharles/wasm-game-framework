'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wasm-game-server-test.'));
  const site = path.join(root, 'site');
  const data = path.join(root, 'data');
  const shell = path.join(root, 'shell');
  const port = await availablePort();
  const pakA = Buffer.from('PACKvariant-a');
  const pakB = Buffer.from('PACKvariant-b');
  const optional = Buffer.from('OggSoptional');
  await Promise.all([fsp.mkdir(site), fsp.mkdir(data), fsp.mkdir(shell)]);
  await fsp.writeFile(path.join(site, 'index.html'), '<!doctype html><title>fixture</title>');
  await fsp.writeFile(path.join(site, 'background.bmp'), Buffer.from('BMfixture'));
  await fsp.writeFile(path.join(site, 'fixture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fsp.writeFile(path.join(site, 'wasm-game.json'), JSON.stringify({
    id: 'fixture-suite', title: 'Fixture', defaultVariant: 'alpha', variants: {
      alpha: { title: 'Alpha Game', icon: '/fixture.svg', pwa: { shortName: 'Alpha', themeColor: '#123456', icons: [
        { src: '/fixture.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
      ] } },
      beta: { title: 'Beta Game', icon: '/fixture.svg' }
    }
  }));
  await fsp.copyFile(path.join(__dirname, '..', 'dist', 'index.html'), path.join(shell, 'index.html'));
  await fsp.writeFile(path.join(site, 'wasm-game-data.json'), JSON.stringify({
    namespace: 'fixture-suite', version: 'v1', variants: {
      alpha: { files: [
        { key: 'pak', name: 'pak0.pak', path: 'alpha/pak0.pak', size: pakA.length, magic: 'PACK', sha256: crypto.createHash('sha256').update(pakA).digest('hex') },
        { key: 'music', name: 'music.ogg', path: 'alpha/music.ogg', size: optional.length, magic: 'OggS', required: false }
      ] },
      beta: { files: [
        { key: 'pak', name: 'pak0.pak', path: 'beta/pak0.pak', size: pakB.length, magic: 'PACK' }
      ] }
    }
  }));

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'static-server.js')], {
    env: {
      ...process.env,
      WASM_GAME_SITE_ROOT: site,
      WASM_GAME_SHELL_ROOT: shell,
      WASM_GAME_DATA_ROOT: data,
      WASM_GAME_HTTP_PORT: String(port),
      WASM_GAME_VARIANT: 'suite'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const documentResponse = await waitFor(`${base}/`);
    const documentText = await documentResponse.text();
    assert.match(documentText, /data-shell-launcher/);
    assert.match(documentText, /wasm-game-bootstrap\.js/);
    assert.doesNotMatch(documentText, /fixture<\/title>/, 'framework document must replace a downstream index');
    const bmpResponse = await fetch(`${base}/background.bmp`);
    assert.equal(bmpResponse.headers.get('content-type'), 'image/bmp');
    const pwaResponse = await fetch(`${base}/app.webmanifest?variant=alpha`);
    assert.equal(pwaResponse.headers.get('content-type'), 'application/manifest+json');
    const pwa = await pwaResponse.json();
    assert.equal(pwa.name, 'Alpha Game');
    assert.equal(pwa.short_name, 'Alpha');
    assert.equal(pwa.start_url, '/?game=alpha');
    assert.equal(pwa.display, 'standalone');
    assert.equal(pwa.theme_color, '#123456');
    assert.deepEqual(pwa.icons, [{ src: '/fixture.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]);
    const faviconResponse = await fetch(`${base}/favicon.ico`, { redirect: 'manual' });
    assert.equal(faviconResponse.status, 302);
    assert.equal(faviconResponse.headers.get('location'), '/fixture.svg');
    const workerResponse = await fetch(`${base}/service-worker.js`);
    assert.equal(workerResponse.headers.get('service-worker-allowed'), '/');
    const worker = await workerResponse.text();
    assert.match(worker, /wasm-game-shell-0\.7\.3/);
    assert.match(worker, /fetch\(event\.request\)/, 'shell cache must refresh from the network before using its fallback');
    assert.doesNotMatch(worker, /game-data/, 'the service worker must not duplicate owner game-data caching');
    const noVariant = await (await fetch(`${base}/game-data/status`)).json();
    assert.equal(noVariant.variantRequired, true);
    assert.deepEqual(noVariant.variants, ['alpha', 'beta']);

    let alpha = await (await fetch(`${base}/game-data/status?variant=alpha`)).json();
    assert.equal(alpha.ready, false);
    let response = await fetch(`${base}/game-data/setup/pak?variant=alpha`, { method: 'PUT', body: pakA });
    assert.equal(response.status, 201);
    alpha = await (await fetch(`${base}/game-data/status?variant=alpha`)).json();
    assert.equal(alpha.ready, true);
    assert.equal(alpha.files.find(file => file.key === 'music').valid, false);
    response = await fetch(`${base}/game-data/files/music?variant=alpha`);
    assert.equal(response.status, 404, 'missing optional data must fail promptly');
    response = await fetch(`${base}/game-data/setup/music?variant=alpha`, { method: 'PUT', body: optional });
    assert.equal(response.status, 201, 'optional data may be installed after required data is ready');
    response = await fetch(`${base}/game-data/files/music?variant=alpha`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), optional);

    const beta = await (await fetch(`${base}/game-data/status?variant=beta`)).json();
    assert.equal(beta.ready, false, 'suite variants have independent readiness');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log('variant-aware static data server tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
