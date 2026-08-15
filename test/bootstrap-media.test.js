'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'dist/wasm-game-bootstrap.js'), 'utf8');

assert.match(html, /id="media-entry-row"[\s\S]*data-shell-media-entry/,
  'the media selector must have its own hideable row without hiding Add-media controls');
assert.match(bootstrap, /globalThis\.WASM_GAME_MEDIA/,
  'the bootstrap must consume the server-injected media deployment lock');
assert.match(bootstrap, /params\.has\('media'\)/,
  'an explicit media query must be distinguishable from an omitted query');
assert.match(bootstrap,
  /createContainerDataClient\(\{[\s\S]*media: mediaDeployment\.value,[\s\S]*mediaExplicit: mediaDeployment\.explicit,[\s\S]*mediaLocked: mediaDeployment\.locked/,
  'the resolved direct-media policy must reach the data client');
assert.match(bootstrap, /elements\.mediaEntryRow\.hidden = mediaDeployment\.locked/,
  'a hard lock must hide only the media selector row');
assert.match(bootstrap,
  /const unavailableSelection =[\s\S]*selection\?\.explicit && !selection\.available[\s\S]*elements\.play\.disabled =[\s\S]*unavailableSelection/,
  'an unavailable explicit selection must fail closed with Play disabled');
assert.match(bootstrap, /The requested media is unavailable\. Choose another entry or add it to continue\./,
  'the fail-closed state must explain how to recover');
assert.match(bootstrap, /url\.searchParams\.set\('media', id\)/);
assert.match(bootstrap, /history\.replaceState\(history\.state, '', url\.href\)/,
  'changing a query-selected entry must update the current URL without reloading the game suite');
const changeHandler = bootstrap.match(/elements\.mediaEntry\.addEventListener\('change',[\s\S]*?\n  \}\);/)?.[0] || '';
assert.match(changeHandler, /dataClient\.media\.select/);
assert.match(changeHandler, /updateMediaUrl/);
assert.doesNotMatch(changeHandler, /location\.href\s*=/,
  'media changes must not discard the unified console selector state through navigation');

console.log('direct-media launcher bootstrap contract tests passed');
