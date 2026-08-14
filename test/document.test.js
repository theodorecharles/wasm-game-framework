'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'dist', 'wasm-game-bootstrap.js'), 'utf8');
const framework = fs.readFileSync(path.join(root, 'dist', 'wasm-game-framework.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'dist', 'wasm-game-framework.css'), 'utf8');

for (const currentFile of ['wasm-game-framework.js', 'wasm-game-framework.css', 'wasm-game-bootstrap.js']) {
  assert.equal(fs.existsSync(path.join(root, 'dist', currentFile)), true, `${currentFile} must be published`);
}
for (const legacyFile of ['wolfwasm-shell.js', 'wolfwasm-shell.css', 'wolfwasm-bootstrap.js']) {
  assert.equal(fs.existsSync(path.join(root, 'dist', legacyFile)), false, `${legacyFile} must not remain`);
}
assert.doesNotMatch(`${html}\n${bootstrap}\n${framework}\n${stylesheet}`, /WolfWasm|wolfwasm|ww-shell|--ww-/,
  'the public framework surface must use only generic names');
assert.match(framework, /root\.WasmGameFramework = api/);

assert.match(html, /data-shell-launcher/);
assert.match(html, /data-shell-loading/);
assert.match(html, /data-shell-runtime/);
assert.match(html, /data-shell-provisioning/);
assert.match(html, /data-shell-data-ready/);
assert.equal((html.match(/<canvas\b/g) || []).length, 1);
assert.doesNotMatch(html, /legally owned|legal game data|illegal|piracy|entitlement|never uploaded|browser also caches/i,
  'the normal framework document must not show stale storage-policy prose');
assert.doesNotMatch(
  bootstrap,
  /state\.ready\s*\?\s*['"`]\s*(?:game data|files?|cache|container|directory|folder)/i,
  'a ready container must not display file, storage, or cache instructions'
);
assert.match(bootstrap, /fetch\('\/wasm-game\.json'/);
assert.match(bootstrap, /WasmGameAdapter\.start/);
assert.match(bootstrap, /text\(elements\.description, config\.description\)/,
  'launcher description must be controlled only by the game manifest');
assert.doesNotMatch(bootstrap, /elements\.description[^\n]*(?:game data|files?|cache)/i,
  'an omitted launcher description must not receive framework fallback copy');
assert.match(bootstrap, /createContainerDataClient\(\{ variant/);
assert.match(bootstrap, /displayMode: config\.displayMode/);
assert.match(bootstrap, /adapter\?\.readEngineState/);
assert.match(bootstrap, /adapter\?\.resize/);
assert.match(bootstrap, /includeOptional: true/);
assert.match(bootstrap, /config\.background/);
assert.match(bootstrap, /--wasm-game-framework-background-image/);
assert.match(bootstrap, /link\[rel="icon"\]/);
assert.match(html, /data-shell-game-icon/);
assert.match(html, /data-shell-launch-fullscreen/);
assert.match(html, /rel="manifest" href="\/app\.webmanifest"/);
assert.match(html, /meta name="theme-color"/);
assert.match(html, /rel="icon" href="data:,"/);
assert.match(bootstrap, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
assert.match(bootstrap, /app\.webmanifest\?variant=/);
assert.match(bootstrap, /requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
assert.match(bootstrap, /fullscreen: elements\.launchFullscreen/);

console.log('canonical framework document and adapter bootstrap tests passed');
