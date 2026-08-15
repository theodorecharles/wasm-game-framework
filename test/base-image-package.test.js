'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, 'server');
const buildScript = fs.readFileSync(path.join(root, 'scripts/build-base-image.sh'), 'utf8');

assert.match(buildScript,
  /cp -a "\$\{framework_dir\}\/server\/\." "\$\{context_dir\}\/framework-server\/"/,
  'the base image must stage the complete framework server package');
assert.match(buildScript, /server\/media-library\.js/,
  'the built image self-test must load the media-library module');

for (const name of fs.readdirSync(serverDir).filter(file => file.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(serverDir, name), 'utf8');
  for (const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
    const dependency = path.resolve(serverDir, `${match[1]}.js`.replace(/\.js\.js$/, '.js'));
    assert.ok(fs.existsSync(dependency), `${name} requires missing server module ${match[1]}`);
  }
}

console.log('framework base-image server package contract passed');
