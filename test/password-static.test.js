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

async function waitFor(url, diagnostics) {
  let last = 'no response';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`password static server did not start: ${last}\n${diagnostics.join('')}`);
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wasm-game-password-test.'));
  const site = path.join(root, 'site');
  const shell = path.join(root, 'shell');
  const data = path.join(root, 'data');
  const port = await availablePort();
  await Promise.all([fsp.mkdir(site), fsp.mkdir(shell), fsp.mkdir(data)]);
  await fsp.writeFile(path.join(site, 'wasm-game.json'), JSON.stringify({ id: 'protected', title: 'Protected' }));
  await fsp.copyFile(path.join(__dirname, '..', 'dist', 'index.html'), path.join(shell, 'index.html'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'static-server.js')], {
    env: {
      ...process.env,
      WASM_GAME_SITE_ROOT: site,
      WASM_GAME_SHELL_ROOT: shell,
      WASM_GAME_DATA_ROOT: data,
      WASM_GAME_HTTP_PORT: String(port),
      WASM_GAME_PASSWORD: 'play-me'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const diagnostics = [];
  child.stdout.on('data', chunk => diagnostics.push(chunk.toString()));
  child.stderr.on('data', chunk => diagnostics.push(chunk.toString()));
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/`, diagnostics);
    let response = await fetch(`${base}/auth/status`);
    assert.deepEqual(await response.json(), { required: true, authenticated: false });
    response = await fetch(`${base}/game-data/status`);
    assert.equal(response.status, 401);
    response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'play-me' })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    response = await fetch(`${base}/game-data/status`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ready, true);
    for (const privatePath of ['/data', '/local-data']) {
      response = await fetch(`${base}${privatePath}`, { headers: { cookie } });
      assert.equal(response.status, 404);
    }
    const manifest = await (await fetch(`${base}/app.webmanifest`)).text();
    assert.doesNotMatch(manifest, /play-me|WASM_GAME_PASSWORD/);
  } finally {
    const exited = child.exitCode === null
      ? new Promise(resolve => child.once('exit', resolve))
      : Promise.resolve();
    child.kill('SIGTERM');
    await exited;
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log('password-gated static server integration tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
