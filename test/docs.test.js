'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const framework = require('../dist/wasm-game-framework.js');
const contracts = require('../docs/contracts');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-docs-'));

const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-docs.js'), out], {
  encoding: 'utf8',
  env: { ...process.env, DOCS_BASE: '' }
});
assert.equal(result.status, 0, result.stderr || result.stdout);

const llms = fs.readFileSync(path.join(out, 'llms.txt'), 'utf8');
const full = fs.readFileSync(path.join(out, 'llms-full.txt'), 'utf8');
const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const start = fs.readFileSync(path.join(out, 'getting-started.html'), 'utf8');
const build = fs.readFileSync(path.join(out, 'build-a-game.html'), 'utf8');

assert.equal(pkg.version, framework.version);
assert.equal(pkg.version, contracts.VERSION);
assert.match(llms, new RegExp(`Current version: ${pkg.version}`));
assert.match(full, new RegExp(`## Current version`));
assert.match(index, new RegExp(pkg.version));
assert.match(index, /npx create-wasm-game/);
assert.match(start, /npx create-wasm-game/);
assert.match(start, /npm create wasm-game@latest/);
assert.match(build, /npx create-wasm-game/);
assert.match(build, /How to use|Build a game|Scaffold/i);

for (const heading of contracts.REQUIRED_LLM_HEADINGS) {
  assert.match(llms.includes(heading) ? heading : full, /./);
  assert.match(full, new RegExp(`## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

assert.match(full, /menuCursor/);
assert.match(full, /wasdMouse/);
assert.match(full, /IdleServiceSupervisor|\/wake/);
assert.match(full, /npx create-wasm-game/);

for (const name of contracts.BROWSER_EXPORTS) {
  assert.match(full, new RegExp(name));
}

for (const item of contracts.everyNavPage()) {
  const file = path.join(out, item.href);
  assert.ok(fs.existsSync(file), `missing ${item.href}`);
  const html = fs.readFileSync(file, 'utf8');
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  for (const link of links) {
    if (!link.startsWith('/') || link.startsWith('//')) continue;
    if (link.startsWith('/#')) continue;
    const pathname = link.split('#')[0];
    if (pathname === '/') continue;
    const target = path.join(out, pathname.replace(/^\//, ''));
    assert.ok(fs.existsSync(target) || fs.existsSync(`${target}.html`), `broken link ${link} on ${item.href}`);
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.match(fs.readFileSync(path.join(out, 'architecture.html'), 'utf8'), /Canonical document boundary/);
assert.match(fs.readFileSync(path.join(out, 'adapter-runbook.html'), 'utf8'), /Keep the boundary clean/);
assert.match(fs.readFileSync(path.join(out, 'server-runbook.html'), 'utf8'), /Define the process boundary/);
assert.match(fs.readFileSync(path.join(out, 'readme.html'), 'utf8'), /WASM Game Framework/);

assert.equal(framework.version, pkg.version);
assert.ok(readme.includes(pkg.version));

fs.rmSync(out, { recursive: true, force: true });
console.log('docs build, version, required LLM headings, and internal links passed');
