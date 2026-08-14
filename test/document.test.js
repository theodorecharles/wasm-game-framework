'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'dist', 'wolfwasm-bootstrap.js'), 'utf8');

assert.match(html, /data-shell-launcher/);
assert.match(html, /data-shell-loading/);
assert.match(html, /data-shell-runtime/);
assert.match(html, /data-shell-provisioning/);
assert.match(html, /data-shell-data-ready/);
assert.equal((html.match(/<canvas\b/g) || []).length, 1);
assert.doesNotMatch(html, /legally owned|never uploaded|browser also caches/i,
  'the normal framework document must not show stale storage-policy prose');
assert.match(bootstrap, /fetch\('\/wasm-game\.json'/);
assert.match(bootstrap, /WasmGameAdapter\.start/);
assert.match(bootstrap, /createContainerDataClient\(\{ variant/);
assert.match(bootstrap, /displayMode: config\.displayMode/);
assert.match(bootstrap, /adapter\?\.readEngineState/);
assert.match(bootstrap, /adapter\?\.resize/);
assert.match(bootstrap, /includeOptional: true/);
assert.match(bootstrap, /config\.background/);
assert.match(bootstrap, /--ww-shell-background-image/);
assert.match(bootstrap, /link\[rel="icon"\]/);
assert.match(html, /data-shell-game-icon/);
assert.match(html, /data-shell-launch-fullscreen/);
assert.match(html, /rel="manifest" href="\/app\.webmanifest"/);
assert.match(html, /meta name="theme-color"/);
assert.match(bootstrap, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
assert.match(bootstrap, /app\.webmanifest\?variant=/);
assert.match(bootstrap, /requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
assert.match(bootstrap, /fullscreen: elements\.launchFullscreen/);

console.log('canonical framework document and adapter bootstrap tests passed');
