# Downstream architecture

## Canonical document boundary

`wasm-game-framework/dist/index.html` is the only authored web application
document. Game repositories must not fork it. They provide a declarative
`wasm-game.json`, a `game-adapter.js` native seam, engine JS/WASM, and public
game-specific assets. The framework static server detects that manifest and
serves the canonical document at `/` and every extensionless client route.

This makes launcher copy, mobile policy, provisioning controls, cache behavior,
viewport geometry, loading diagnostics, and input capture versioned framework
features that flow downstream automatically.

The canonical document is also the PWA boundary. The framework generates the
variant-aware web app manifest, registers and versions the safe shell service
worker, and owns the remembered fullscreen-on-Play preference. Games provide
only declarative names, colors, and authentic install icons in
`wasm-game.json`; adapters never register their own workers or request browser
fullscreen from a delayed native callback.

Pointer coordinates are transformed by the framework from the live CSS canvas
rectangle into each engine's declared native menu space. Adapters never carry
page-offset compensation. Fixed-aspect native menus inside dynamic canvases use
the same centered contain geometry as display fitting. Engine state remains the capture authority: menus
release pointer lock and hide the host cursor over the native surface, while
gameplay alone may acquire relative input.

The portfolio has one dependency direction. Nothing at a lower layer is
copied back upward and no downstream repository submits patches upstream.

```text
wasm-framework
    -> engine-family-wasm
        -> game adapter
            -> suite or single-title Docker image
```

## Framework layer

`@wasm-game-framework/browser` owns behavior that is independent of a native
engine:

- launcher, loading, runtime, error, and debrief surfaces;
- variant-aware PWA metadata, install lifecycle, safe shell fallback caching,
  and fullscreen-on-Play preference;
- explicit `4:3`, `16:9`, and dynamic native-acknowledged display modes, DPR
  policy, fullscreen, and context-loss boundaries;
- player identity, graphics/FPS preferences, runtime state, pointer capture,
  cursor release, browser-shortcut boundaries, and desktop capability notice;
- browser/platform capability detection and actionable unsupported-browser
  diagnostics;
- validated owner-file caching in IndexedDB and durable-storage requests;
- first-run validated container provisioning into persistent `/data`, exact
  same-origin download allowlists, and automatic removal of setup UI afterward;
- cache-first owner-data sets and read-only WORKERFS/chunked MEMFS mounting;
- save/config persistence and import/export boundaries;
- audio gesture unlock, focus/device suspension recovery, and master controls;
- loading progress, log/crash surfaces, retry, and WebGL context-loss recovery;
- FPS telemetry and optional automatic quality-profile control;
- suite versus locked single-title deployments;
- website-triggered server wake, status, random-map startup, human population,
  keep-alive, and idle shutdown contracts;
- the versioned, retail-free static image base used by downstream games.

The framework never knows a retail filename, renderer command, game cvar,
network protocol, or copyrighted asset. Cache policy versions are supplied by
the engine/game layer; changing a policy version safely invalidates only that
title's private records.

## Engine-family layer

An engine family depends on an exact framework release and owns only reusable
native seams: Emscripten main-loop integration, WebGL/renderer adaptation,
audio backend, filesystem layout, save persistence, input action translation,
network transport, and dedicated-server adapter. Examples are `idtech3-wasm`,
`idtech4-wasm`, `build-wasm`, `goldsource-wasm`, and `source-wasm`.

## Game layer

A game adapter contains title policy: exact owner-file allowlist and validation,
branding from owner-installed media, game defaults, SP/MP availability, launch
arguments, renderer profiles, map rotation, bot policy, and the smallest
source patch that cannot honestly be shared by its engine siblings.

Every adapter must report `menu`, `gameplay`, `paused`, `debrief`, and `crashed`
transitions; acknowledge dynamic native buffer sizes; provide the engine action
used when pointer capture is lost; and translate the common WASD/mouse policy
into native bindings. It does not implement its own launcher, provisioning
screen, pointer-lock manager, mobile warning, or canvas sizing CSS.

## Propagation

During portfolio development an engine build runs:

```bash
../wasm-game-framework/scripts/install-browser-package.sh web/shared-shell link
```

The link makes local framework edits visible to every local game immediately.
Release and Docker builds use `copy`, record the exact version and SHA-256s in
`wasm-game-framework.json`, and remain self-contained/offline. CI rebuilds the
engine-family images when the pinned framework version changes. A deployed
game never loads framework code from a third-party CDN.

The Docker image builder uses a versioned `wasm-game-framework:<version>` base.
Suite and title-locked images contain only their game site on top of that base;
they never copy owner game data.
