#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contracts = require('../docs/contracts');
const { escapeHtml, renderMarkdown } = require('./lib/markdown');

const root = contracts.repoRoot();
const outRoot = path.resolve(process.argv[2] || path.join(root, 'site'));
const base = String(process.env.DOCS_BASE || '').replace(/\/$/, '');

function href(page) {
  const clean = String(page || '').replace(/^\//, '');
  if (!base) return `/${clean}`;
  return `${base}/${clean}`;
}

function asset(name) {
  return `${base}/${name}`.replace(/\/{2,}/g, '/') || `/${name}`;
}

function rewriteLink(target) {
  const map = {
    'README.md': 'readme.html',
    './README.md': 'readme.html',
    'ARCHITECTURE.md': 'architecture.html',
    './ARCHITECTURE.md': 'architecture.html',
    'ADAPTER_RUNBOOK.md': 'adapter-runbook.html',
    './ADAPTER_RUNBOOK.md': 'adapter-runbook.html',
    'SERVER_RUNBOOK.md': 'server-runbook.html',
    './SERVER_RUNBOOK.md': 'server-runbook.html'
  };
  if (map[target]) return href(map[target]);
  if (/^https?:\/\//.test(target) || target.startsWith('mailto:')) return target;
  if (target.startsWith('#')) return target;
  if (target.endsWith('.md')) return href(target.replace(/\.md$/, '.html').split('/').pop());
  if (target.endsWith('.html') || target.endsWith('.txt')) return href(target.replace(/^\.\//, ''));
  return target;
}

function table(rows, columns) {
  if (!rows || !rows.length) return '';
  const keys = columns || Object.keys(rows[0]);
  const header = `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${keys.map(key => String(row[key] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`).join('\n');
  return `${header}\n${body}\n`;
}

function manifestExample() {
  return ['```json', JSON.stringify({
    id: 'quake2',
    title: 'Quake II',
    kicker: 'id Tech 2',
    description: 'Play Quake II in the browser.',
    icon: '/quake2.ico',
    displayMode: 'dynamic',
    nativeManaged: true,
    menuCursor: 'browser',
    fullscreen: true,
    controller: { mode: 'disabled' },
    persistence: {
      root: '/save/{variant}',
      debounceMs: 750,
      intervalMs: 5000,
      requestDurability: true
    },
    pwa: {
      shortName: 'Quake II',
      themeColor: '#5f190d',
      backgroundColor: '#000000',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }
      ]
    },
    adapter: '/game-adapter.js'
  }, null, 2), '```'].join('\n');
}

const includes = {
  'manifest-example': manifestExample,
  'manifest-fields': () => table(contracts.MANIFEST_FIELDS, ['name', 'required', 'type', 'notes']),
  'pwa-fields': () => table(contracts.PWA_FIELDS, ['name', 'required', 'type', 'notes']),
  'controller-fields': () => table(contracts.CONTROLLER_FIELDS, ['name', 'required', 'type', 'notes']),
  'persistence-fields': () => table(contracts.PERSISTENCE_FIELDS, ['name', 'required', 'type', 'notes']),
  'adapter-methods': () => table(contracts.ADAPTER_METHODS, ['name', 'required', 'when']),
  'context-fields': () => table(contracts.CONTEXT_FIELDS, ['name', 'notes']),
  'engine-states': () => table(contracts.ENGINE_STATES, ['id', 'capture', 'meaning']),
  'display-modes': () => table(contracts.DISPLAY_MODES, ['id', 'meaning']),
  'menu-cursor': () => table(contracts.MENU_CURSOR_MODES, ['id', 'meaning']),
  'controller-modes': () => table(contracts.CONTROLLER_MODES, ['id', 'meaning']),
  'data-manifest-fields': () => table(contracts.DATA_MANIFEST_FIELDS, ['name', 'required', 'type', 'notes']),
  'data-file-fields': () => table(contracts.DATA_FILE_FIELDS, ['name', 'required', 'type', 'notes']),
  'validator-fields': () => table(contracts.VALIDATOR_FIELDS, ['name', 'required', 'type', 'notes']),
  'media-fields': () => table(contracts.MEDIA_LIBRARY_FIELDS, ['name', 'required', 'type', 'notes']),
  'transformer-fields': () => table(contracts.TRANSFORMER_FIELDS, ['name', 'required', 'type', 'notes']),
  'environment': () => table(contracts.ENVIRONMENT, ['name', 'default', 'notes']),
  'static-routes': () => table(contracts.STATIC_ROUTES, ['method', 'path', 'notes']),
  'lifecycle-routes': () => table(contracts.LIFECYCLE_ROUTES, ['method', 'path', 'notes']),
  'media-errors': () => table(contracts.MEDIA_ERROR_CODES, ['code', 'meaning']),
  'browser-api': () => table(contracts.BROWSER_API, ['name', 'kind', 'summary']),
  'projects': () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const start = readme.indexOf('| Engine family |');
    if (start < 0) return '';
    return readme.slice(start).trim() + '\n';
  }
};

function applyTokens(source) {
  return String(source)
    .replaceAll('{{VERSION}}', contracts.VERSION)
    .replaceAll('{{PACKAGE_NAME}}', contracts.PACKAGE_NAME)
    .replaceAll('{{REPOSITORY_URL}}', contracts.REPOSITORY_URL)
    .replaceAll('{{PAGES_ORIGIN}}', contracts.PAGES_ORIGIN)
    .replaceAll('{{LIVE_EXAMPLE}}', contracts.LIVE_EXAMPLE.url)
    .replace(/\{\{include:([a-z0-9-]+)\}\}/g, (_, name) => {
      if (!includes[name]) throw new Error(`Unknown docs include: ${name}`);
      return includes[name]();
    });
}

function generatedPages() {
  return {
    'game-data.md': `# Game data

Validated archives are not saves. \`wasm-game-data.json\` lists the files an
operator may install onto \`/data\`. The browser then caches those files
privately.

A manifest must contain at least one fixed file or a media library.

{{include:data-manifest-fields}}

## File policy

{{include:data-file-fields}}

Optional files (\`"required": false\`) do not block Play. Call
\`provision(source, { includeOptional: true })\` to add them later.

Suite images put independent policies under \`variants\`. The launcher
passes the selected key to \`createContainerDataClient({ variant })\`.
`,
    'media-library.md': `# Media library

Use a media library when the title is a collection, not a closed file set.
The framework stores opaque 32-hex entries, lists safe public metadata, and
caches only the selected entry.

Version {{VERSION}} restores a selected entry with a bounded parallel pool
(default ${contracts.MEDIA_DEFAULTS.restoreConcurrency} workers, range
${contracts.MEDIA_DEFAULTS.concurrencyRange.join('–')}) and keeps manifest
order.

{{include:media-fields}}

## Transformer

{{include:transformer-fields}}

Returning \`{ transformed: true }\` inventories the output directory
(without following symlinks), validates, and installs atomically.

## Selection and errors

\`/?game=ps1&media=<id>\` preselects. \`WASM_GAME_MEDIA=<id>\` locks.
An unavailable explicit ID fails closed.

{{include:media-errors}}
`,
    'display.md': `# Display and resize

There are three sizes: the CSS viewport (framework), the physical
backbuffer (manifest policy), and the virtual menu coordinates (native UI).

{{include:display-modes}}

\`dynamic\` plus \`nativeManaged\` keeps the last valid native aspect until
the engine acknowledges the new buffer, so resize does not stretch faces or
HUD elements. \`resizeTransition: "immediate"\` fills the new viewport in
the same frame; use it only when \`resize()\` updates the native buffer
immediately.

The framework resamples geometry across several frames after Chrome
fullscreen changes. Accept every callback, including exit and narrow
windows.
`,
    'input.md': `# Pointer and capture

The framework is the only code that calls \`requestPointerLock()\` or
\`exitPointerLock()\`. Adapters report state and translate events.

{{include:menu-cursor}}

Omitted \`menuCursor\` defaults to \`native\` so older manifests keep
working. New manifests must declare it.

Released pointer details include mapped \`x\`, \`y\`, and
\`captured: false\`. Captured details include only \`movementX\`,
\`movementY\`, \`state\`, \`canvas\`, and \`captured: true\`. Branch on
\`detail.captured\`. Never reuse menu coordinates for look.

JOIN / New Game / Resume need \`readCaptureIntent()\` to rise during that
exact trusted gesture. Intent that was already true at pointerdown is
stale.
`,
    'controllers.md': `# Controllers

Controller mode is required. The portfolio default is \`disabled\`. The
scaffold emits that unless you pass \`--controller\`.

{{include:controller-modes}}

\`wasdMouse\` actions: ${contracts.CONTROLLER_ACTIONS.join(', ')}.

Write values into the same native input queue used by keyboard and mouse.
Do not dispatch synthetic DOM events. Remember a stable device id, never a
Gamepad index.

{{include:controller-fields}}
`,
    'persistence.md': `# Persistence

Saves are not game data. Declare \`persistence: false\` or an object with
an absolute traversal-free \`root\`. The scaffold attaches that root
before native main.

{{include:persistence-fields}}

\`npx create-wasm-game\` writes this pattern:

\`\`\`js
const module = await createNativeModule({ noInitialRun: true });
await context.persistence.attach(module.FS, {
  root: context.persistence.root
});
module.callMain(argsUsing(context.persistence.root));
\`\`\`

Call \`markDirty()\` after native writes and \`await save()\` at high-value
boundaries. Periodic flush is a fallback, not a substitute for a save hook.
`,
    'validators.md': `# Validators

A validator is a pure \`.mjs\` module. The same file runs in Node during
upload and in the browser during cache restore. It receives bounded
\`read(offset, length)\` and \`digest()\` — no filesystem, no framework
internals.

{{include:validator-fields}}

Return \`{ accepted: true, identity?, version?, fingerprint?, metadata? }\`
or \`{ accepted: false, error }\`. A media bundle validator also receives
\`{ files, totalSize, file(name) }\` and may return \`label\` and
\`primary\`.

Bump \`version\` when module semantics change. That value is part of every
cache key.
`,
    'http.md': `# HTTP and routes

The canonical static server serves the framework document, game-site
assets, provisioning, media, password, PWA, and the shell service worker.
It never serves \`/data\` or \`/local-data\`.

{{include:static-routes}}
`,
    'password.md': `# Password and PWA

Set \`WASM_GAME_PASSWORD\` to put the launcher and protected game routes
behind one shared password. A successful login sets a signed, expiring,
HttpOnly, SameSite cookie. The password never appears in a manifest,
script, URL, status payload, or log.

PWA metadata comes from \`wasm-game.json\`. The server emits
\`/app.webmanifest\` and a network-first service worker for the small
shell only. It does not cache engine artifacts or game data.

{{include:pwa-fields}}
`,
    'lifecycle.md': `# Wake and idle

Play may start a native dedicated server. Loading the page, polling
\`/status\`, or opening \`/ws\` must not.

Supervisor states: ${contracts.LIFECYCLE_STATES.join(', ')}.

{{include:lifecycle-routes}}

Count admitted human clients, including spectators. Bots, challenge slots,
and stale sockets do not count. Bots never prevent shutdown.

Use \`WasmGameFramework.createWakeClient()\` from the Play gesture and
report \`loading\` before awaiting readiness.
`,
    'docker.md': `# Docker and environment

The base image is \`wasm-game-framework:{{VERSION}}\`. A game image copies
only the site onto that base. Data stays on a volume.

\`npx create-wasm-game\` writes a \`Dockerfile\` and
\`scripts/build-image.sh\` that pin this version.

\`\`\`bash
./scripts/build-base-image.sh wasm-game-framework:{{VERSION}}
./scripts/build-static-image.sh ./web my-game-wasm:dev
docker run --rm -p 8088:8088 -v game-data:/data my-game-wasm:dev
\`\`\`

{{include:environment}}
`,
    'browser-api.md': `# Browser API

\`{{PACKAGE_NAME}}\` {{VERSION}} exports these names from
\`dist/wasm-game-framework.js\`.

{{include:browser-api}}

Shell methods from \`configure()\`: ${contracts.SHELL_METHODS.join(', ')}.
`,
    'server-api.md': `# Server API

Package exports:

- \`./server/lifecycle\` — ${contracts.SERVER_EXPORTS.lifecycle.join(', ')}
- \`./server/password-auth\` — ${contracts.SERVER_EXPORTS.passwordAuth.join(', ')}
- \`./server/provisioning\` — ${contracts.SERVER_EXPORTS.provisioning.join(', ')}
- \`./server/media-library\` — ${contracts.SERVER_EXPORTS.mediaLibrary.join(', ')}

{{include:environment}}
`,
    'testing.md': `# Tests and checker

From the framework checkout:

\`\`\`bash
npm test
node scripts/check-game-package.js path/to/web
\`\`\`

A project created with \`npx create-wasm-game\` already includes
\`test/package-contract.test.js\`, which runs that checker against
\`web/\`.

The checker requires explicit \`displayMode\`, \`menuCursor\`,
\`controller\`, \`persistence\`, and \`fullscreen\`; matching adapter
methods; existing icons; PWA shortName and icons; unique resolved
persistence roots; and neutral ready-state copy.

The adapter runbook is the interactive acceptance pass. A static pass does
not replace it.
`,
    'projects.md': `# Projects

Status uses exactly two labels: **Live** and **Still in development**.

{{include:projects}}
`
  };
}

function readGuide(id) {
  const file = path.join(root, 'docs', 'guides', `${id === 'index' ? 'index' : id}.md`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  return null;
}

function pageSource(id) {
  const authored = readGuide(id);
  if (authored) return authored;
  const generated = generatedPages();
  if (generated[`${id}.md`]) return generated[`${id}.md`];
  const source = contracts.SOURCE_DOCUMENTS.find(doc => doc.id === id);
  if (source) return fs.readFileSync(path.join(root, source.file), 'utf8');
  throw new Error(`No source for docs page ${id}`);
}

function layout({ id, title, body, headings }) {
  const nav = contracts.NAV.map(group => {
    const items = group.items.map(item => {
      const current = item.id === id ? ' aria-current="page"' : '';
      return `<a href="${href(item.href)}"${current}>${escapeHtml(item.title)}</a>`;
    }).join('\n');
    return `<section class="nav-group"><h2>${escapeHtml(group.title)}</h2>${items}</section>`;
  }).join('\n');

  const toc = headings.filter(item => item.level >= 2 && item.level <= 3).map(item => (
    `<a class="depth-${item.level}" href="#${item.slug}">${escapeHtml(item.title)}</a>`
  )).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · WASM Game Framework ${escapeHtml(contracts.VERSION)}</title>
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${asset('site.css')}">
</head>
<body data-page="${escapeHtml(id)}">
  <a class="skip" href="#content">Skip to content</a>
  <header class="site-header">
    <button class="menu-toggle" type="button" data-nav-toggle>Menu</button>
    <a class="brand" href="${href('index.html')}">
      <img src="${asset('favicon.svg')}" alt="">
      <span class="brand-mark">
        <span class="brand-kicker">WASM</span>
        <span class="brand-title">Game Framework</span>
      </span>
    </a>
    <div class="header-search">
      <input data-docs-search type="search" placeholder="Search the docs" aria-label="Search the docs">
      <div class="search-results" data-search-results></div>
    </div>
    <div class="header-meta">
      <span class="version-pill">v${escapeHtml(contracts.VERSION)}</span>
      <a href="${href('llms.txt')}">llms.txt</a>
      <a href="${escapeHtml(contracts.REPOSITORY_URL)}">GitHub</a>
    </div>
  </header>
  <div class="shell">
    <aside class="sidebar">${nav}</aside>
    <div class="content-wrap">
      <article id="content">${body}
        <p class="footer">WASM Game Framework ${escapeHtml(contracts.VERSION)} · MIT · <a href="${escapeHtml(contracts.REPOSITORY_URL)}">source</a></p>
      </article>
      <nav class="toc" aria-label="On this page"><h2>On this page</h2>${toc || '<a href="#content">Top</a>'}</nav>
    </div>
  </div>
  <script>document.documentElement.dataset.searchIndex = ${JSON.stringify(asset('search-index.json'))};</script>
  <script src="${asset('site.js')}"></script>
</body>
</html>
`;
}

function firstParagraph(markdown) {
  const match = String(markdown).replace(/^#.*$/m, '').match(/^[A-Z0-9].+$/m);
  return match ? match[0].slice(0, 220) : '';
}

function buildLlmsTxt() {
  const links = contracts.everyNavPage().map(item => (
    `- [${item.title}](${contracts.PAGES_ORIGIN}/${item.href}): ${item.id}`
  )).join('\n');
  return `# WASM Game Framework

> ${require('../package.json').description}

Current version: ${contracts.VERSION}

## Canonical contracts

- Package: ${contracts.PACKAGE_NAME}@${contracts.VERSION}
- Scaffold: \`npx create-wasm-game\` / \`npm create wasm-game@latest\`
- Display modes: ${contracts.DISPLAY_MODES.map(item => item.id).join(', ')}
- menuCursor: ${contracts.MENU_CURSOR_MODES.map(item => item.id).join(', ')}
- Controller modes: ${contracts.CONTROLLER_MODES.map(item => item.id).join(', ')}
- Engine states: ${contracts.ENGINE_STATES.map(item => item.id).join(', ')}
- Persistence must be explicit; attach before native main
- Do not emit downstream index.html, CSS, service worker, or webmanifest

## Docs

${links}

- [llms-full.txt](${contracts.PAGES_ORIGIN}/llms-full.txt)
`;
}

function buildLlmsFull(pages) {
  const parts = [
    `# WASM Game Framework ${contracts.VERSION}`,
    '',
    '## Current version',
    '',
    `${contracts.PACKAGE_NAME} ${contracts.VERSION}. Scaffold with \`npx create-wasm-game\` or \`npm create wasm-game@latest\`.`,
    '',
    '## Canonical contracts',
    '',
    `- Display modes: ${contracts.DISPLAY_MODES.map(item => item.id).join(', ')}`,
    `- menuCursor: ${contracts.MENU_CURSOR_MODES.map(item => item.id).join(', ')}`,
    `- Controller modes: ${contracts.CONTROLLER_MODES.map(item => item.id).join(', ')}`,
    `- Engine states: ${contracts.ENGINE_STATES.map(item => item.id).join(', ')}`,
    `- Lifecycle states: ${contracts.LIFECYCLE_STATES.join(', ')}`,
    `- Media restore concurrency default ${contracts.MEDIA_DEFAULTS.restoreConcurrency}`,
    `- Downstream must not ship: ${contracts.FORBIDDEN_DOWNSTREAM.join(', ')}`,
    '',
    '## wasm-game.json',
    '',
    includes['manifest-fields'](),
    '',
    '## Adapter lifecycle',
    '',
    includes['adapter-methods'](),
    '',
    includes['engine-states'](),
    '',
    '## menuCursor',
    '',
    includes['menu-cursor'](),
    '',
    '## Controller modes',
    '',
    includes['controller-modes'](),
    '',
    '## Persistence',
    '',
    includes['persistence-fields'](),
    '',
    'Attach the IDBFS root before native main. Use {variant} or {namespace} in suites.',
    '',
    '## Validators',
    '',
    includes['validator-fields'](),
    '',
    '## Media libraries',
    '',
    includes['media-fields'](),
    '',
    includes['media-errors'](),
    '',
    '## Server wake/sleep',
    '',
    includes['lifecycle-routes'](),
    '',
    `States: ${contracts.LIFECYCLE_STATES.join(', ')}. Only Play/reconnect may POST /wake.`,
    '',
    '## Docker',
    '',
    includes['environment'](),
    '',
    '## Browser API',
    '',
    includes['browser-api'](),
    '',
    `Exports: ${contracts.BROWSER_EXPORTS.join(', ')}`,
    '',
    '## Tests',
    '',
    'npm test in the framework repo. Generated projects run scripts/check-game-package.js via test/package-contract.test.js.',
    '',
    '## Examples',
    '',
    'npx create-wasm-game my-game',
    'npm create wasm-game@latest my-game -- --display-mode dynamic --menu-cursor native',
    ''
  ];

  for (const page of pages) {
    if (['index', 'getting-started', 'build-a-game', 'how-it-works', 'adapter-runbook', 'server-runbook', 'architecture'].includes(page.id)) {
      parts.push(`\n# ${page.title}\n\n${page.markdown}\n`);
    }
  }
  return parts.join('\n');
}

function build() {
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });

  const search = [];
  const rendered = [];

  for (const item of contracts.everyNavPage()) {
    const markdown = applyTokens(pageSource(item.id));
    const { html, headings } = renderMarkdown(markdown, { rewriteLink });
    const title = item.title;
    const body = item.id === 'index'
      ? `<section class="hero"><p class="lede">Reusable launcher, data, persistence, controller, viewport, PWA, and lifecycle contract for browser-native games.</p><div class="meta-row"><span class="chip">${escapeHtml(contracts.PACKAGE_NAME)}@${escapeHtml(contracts.VERSION)}</span><span class="chip">npx create-wasm-game</span><span class="chip">MIT</span></div><div class="cards"><a class="card" href="${href('getting-started.html')}"><strong>Getting started</strong><span>Create a project and pin ${escapeHtml(contracts.VERSION)}.</span></a><a class="card" href="${href('build-a-game.html')}"><strong>Build a game</strong><span>Manifest, adapter, data, image.</span></a><a class="card" href="${href('how-it-works.html')}"><strong>How it works</strong><span>Document, state, two data layers.</span></a></div></section>${html}`
      : html;
    const document = layout({ id: item.id, title, body, headings });
    fs.writeFileSync(path.join(outRoot, item.href), document);
    search.push({
      title,
      href: href(item.href),
      group: contracts.NAV.find(group => group.items.some(entry => entry.id === item.id))?.title || '',
      summary: firstParagraph(markdown),
      headings: headings.map(entry => entry.title).join(' ')
    });
    rendered.push({ id: item.id, title, markdown });
  }

  fs.writeFileSync(path.join(outRoot, 'llms.txt'), applyTokens(buildLlmsTxt()));
  fs.writeFileSync(path.join(outRoot, 'llms-full.txt'), applyTokens(buildLlmsFull(rendered)));
  fs.writeFileSync(path.join(outRoot, 'search-index.json'), JSON.stringify(search, null, 2));
  fs.writeFileSync(path.join(outRoot, 'versions.json'), `${JSON.stringify({
    current: contracts.VERSION,
    versions: [contracts.VERSION]
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(outRoot, '.nojekyll'), '');
  fs.writeFileSync(path.join(outRoot, '404.html'), layout({
    id: '404',
    title: 'Not found',
    body: '<h1>Not found</h1><p>That page is not in the WASM Game Framework docs. Start at the <a href="' + href('index.html') + '">overview</a>.</p>',
    headings: []
  }));

  const versionDir = path.join(outRoot, `v${contracts.VERSION}`);
  fs.mkdirSync(versionDir, { recursive: true });
  for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('v')) continue;
    const from = path.join(outRoot, entry.name);
    const to = path.join(versionDir, entry.name);
    if (entry.isDirectory()) continue;
    fs.copyFileSync(from, to);
  }

  for (const file of ['site.css', 'site.js', 'favicon.svg']) {
    fs.copyFileSync(path.join(root, 'docs', 'assets', file), path.join(outRoot, file));
    fs.copyFileSync(path.join(root, 'docs', 'assets', file), path.join(versionDir, file));
  }

  process.stdout.write(`built docs ${contracts.VERSION} → ${outRoot}\n`);
}

if (require.main === module) {
  try {
    build();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { build, applyTokens, href };
