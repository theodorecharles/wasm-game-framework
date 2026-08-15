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
the same centered contain geometry as display fitting. Engine state remains the
capture authority: menus release pointer lock, while the declarative
`menuCursor` policy selects an engine-rendered pointer, the browser pointer, or
a pointer-free menu. Captured gameplay always hides the host pointer and
receives relative movement deltas.

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
  policy, multi-frame post-fullscreen viewport settlement, fullscreen, and
  context-loss boundaries;
- player identity, graphics/FPS preferences, runtime state, pointer capture,
  cursor release, browser-shortcut boundaries, and desktop capability notice;
- launch-card USB/Bluetooth controller discovery and stable selection,
  animation-frame Gamepad polling, normalized WASD/mouse actions, raw custom
  frames, connection lifecycle, and optional haptics;
- browser/platform capability detection and actionable unsupported-browser
  diagnostics;
- validated fixed-file and selected-media caching in IndexedDB, downstream
  format-validator modules with identical Node/browser semantics, and durable-
  storage requests;
- a generic private media library with atomic multi-file entry installation,
  opaque safe listings, explicit selection, bounded validation reads, and no
  engine or media-format knowledge;
- first-run validated container provisioning into persistent `/data`, exact
  same-origin download allowlists, and automatic removal of setup UI afterward;
- cache-first game-data sets and read-only WORKERFS/chunked MEMFS mounting;
- variant-scoped save/config/keybinding/save-RAM/memory-card persistence,
  pre-main restore, serialized autosave, and import/export boundaries;
- audio gesture unlock, focus/device suspension recovery, and master controls;
- loading progress, log/crash surfaces, retry, and WebGL context-loss recovery;
- FPS telemetry and optional automatic quality-profile control;
- suite versus locked single-title deployments;
- website-triggered server wake, status, random-map startup, human population,
  keep-alive, and idle shutdown contracts;
- the versioned, data-free static image base used by downstream games.

The framework never knows a game archive format, title filename, renderer
command, game cvar, or network protocol. It owns bounded file reads, digests,
atomic installation, cache plumbing, and status/error handling. Downstream
engine/game modules own format recognition and title policy. Validator module
versions and policy are part of browser and server validation cache keys.

Fixed files and library media are separate first-class contracts. Fixed files
retain their stable keys and compatibility APIs. Library entries have opaque
IDs, safe public summary metadata, and a private detail document only after an
entry is selected. A bundle is staged below `.incoming`, validated as one set,
and renamed into the visible entries directory only after every declared byte
arrives and the downstream bundle validator accepts it. Browser caching is
scoped to one selected entry per library; switching entries clears the old
selection before populating the new one.

## Engine-family layer

An engine family depends on an exact framework release and owns only reusable
native seams: Emscripten main-loop integration, WebGL/renderer adaptation,
audio backend, filesystem layout, save persistence, input action translation,
network transport, and dedicated-server adapter. Examples are `idtech3-wasm`,
`idtech4-wasm`, `build-wasm`, `goldsource-wasm`, and `source-wasm`.

## Game layer

A game adapter contains title policy: bounded game-file declarations and
downstream validation,
branding from installed media, game defaults, SP/MP availability, launch
arguments, renderer profiles, map rotation, bot policy, and the smallest
source patch that cannot honestly be shared by its engine siblings.

Every adapter must report `menu`, `gameplay`, `paused`, `debrief`, and `crashed`
transitions; acknowledge dynamic native buffer sizes; provide the engine action
used when pointer capture is lost; and translate the common WASD/mouse policy
into native bindings. It does not implement its own launcher, provisioning
screen, pointer-lock manager, mobile warning, or canvas sizing CSS.

Every merged game manifest explicitly declares controller and persistence
capabilities. Controller discovery and polling stay in the framework; mappings
to native keys, mouse axes/buttons, virtual console pads, or other engine input
live in the adapter. A persistence-enabled adapter mounts and restores the
framework IDBFS root before native configuration or save loading begins.

The canonical bootstrap validates the adapter seam before enabling Play. A
package that declares native-managed resizing must implement `resize()`. A
package that declares a native menu coordinate space must implement both
`pointerMove()` and `pointerButton()`. A package that enables gameplay pointer
capture must implement `readEngineState()` and `captureLost()`. Engine-family
tests must additionally prove identity handoff, exact loading/menu/gameplay
transitions, immediate native backbuffer acknowledgement, capture on gameplay
entry and Resume, release on Escape, profile application, and save/data-cache
behavior in a real browser.

Engine repositories run the reusable static half of that gate against their
staged public directory:

```bash
node ../wasm-game-framework/scripts/check-game-package.js build/site
```

This validates every suite variant, declared display and pointer geometry,
required adapter methods, PWA names/icons, fullscreen policy, and the boundary
between normal launcher copy and missing-data instructions. It complements—it
does not replace—the interactive state, input, resize, audio, and rendering
checks above.

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
they never copy game data.
