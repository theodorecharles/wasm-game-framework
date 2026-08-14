# WASM Game Framework

This repository is the single launcher, loading-surface, controls, viewport,
owner-data, PWA, and container-lifecycle contract used by a portfolio of native
game engines compiled to WebAssembly. It follows the proven WolfET browser
shell so each engine supplies policy rather than maintaining a different web
application.

Current release: **0.7.0**

Live example: [Wolfenstein: Enemy Territory](https://wolfet.tedcharles.net/)
uses the framework's launcher, persistent game-data provisioning, browser
cache, responsive canvas, input-capture lifecycle, graphics profiles,
fullscreen launch, and idle dedicated-server wakeup.

## Projects and release status

Projects are listed as **Live** when a public deployment is available and
**Still in development** while work continues toward a release.

| Engine family | Games | Status | Current repositories |
| --- | --- | --- | --- |
| id Tech 1 | Doom, Doom II, TNT, Plutonia, Heretic, Hexen, Strife, Chex Quest | **Still in development** | Canonical `idtech1-wasm` family repository is being prepared |
| id Tech 2 | Quake, Quake II | **Still in development** | [quake1-wasm](https://github.com/theodorecharles/quake1-wasm), [quake2-wasm](https://github.com/theodorecharles/quake2-wasm); canonical `idtech2-wasm` family repository is planned |
| id Tech 3 | Quake III Arena | **Still in development** | [quake3-wasm](https://github.com/theodorecharles/quake3-wasm) |
| id Tech 3 | Return to Castle Wolfenstein | **Still in development** | [rtcw-wasm](https://github.com/theodorecharles/rtcw-wasm) |
| id Tech 3 | Wolfenstein: Enemy Territory | **Live** | [wolfet-wasm](https://github.com/theodorecharles/wolfet-wasm), [live deployment](https://wolfet.tedcharles.net/) |
| id Tech 4 | Doom 3, Resurrection of Evil | **Still in development** | [doom3-wasm](https://github.com/theodorecharles/doom3-wasm); canonical `idtech4-wasm` family repository is being prepared |
| id Tech 4 | Quake 4 | **Still in development** | [quake4-wasm](https://github.com/theodorecharles/quake4-wasm); canonical `idtech4-wasm` family repository is being prepared |
| Build | Blood | **Still in development** | [blood-wasm](https://github.com/theodorecharles/blood-wasm); canonical `build-wasm` family repository is planned |
| Build | Duke Nukem 3D | **Still in development** | Canonical `build-wasm` family repository is planned |
| GoldSource | Half-Life, Opposing Force, Blue Shift, Counter-Strike | **Still in development** | Canonical `goldsource-wasm` family repository is being prepared |
| Source | Half-Life 2, Counter-Strike: Source | **Still in development** | Canonical `source-wasm` family repository is planned |
| Wolf3D | Wolfenstein 3D, Spear of Destiny | **Still in development** | Canonical `wolf3d-wasm` repository is being prepared |
| DOSBox | Jill of the Jungle and future DOS titles | **Still in development** | Canonical `dosbox-wasm` repository is planned |
| Standalone | Call of Duty 2 | **Still in development** | Canonical `cod2-wasm` repository is being prepared |

The intended public shape is one repository per reusable engine family, not
one repository per executable and not one monorepo for unrelated engines. A
family repository owns shared native/Emscripten adaptations and can emit both
a suite image and independently branded game images. Existing per-game
repositories remain available until the corresponding family repository
reaches feature parity; they will then be archived with a clear “moved to”
link rather than deleted.

## Quick start

The framework repository is self-contained. It does not include a game engine,
compiled game WASM, or proprietary game data:

```bash
git clone https://github.com/theodorecharles/wasm-game-framework.git
cd wasm-game-framework
npm test
./scripts/build-base-image.sh wasm-game-framework:0.7.0
```

To integrate a separate downstream game, point the installer and image builder
at that game's compiled web directory:

```bash
game_site=/absolute/path/to/my-game-wasm/web
./scripts/install-browser-package.sh "$game_site/shared-shell" copy
./scripts/build-static-image.sh "$game_site" my-game-wasm:dev
```

A framework-served downstream directory contains `wasm-game.json`,
`wasm-game-data.json`, `game-adapter.js`, its compiled engine artifacts, and
public title assets. The framework supplies the document, launcher, styling,
data boundary, and browser lifecycle; it does not supply the native port.

Mount a persistent `/data` volume when running that image. On first use, the
administrator uploads the exact legally owned files allowed by
`wasm-game-data.json`; subsequent visitors see the normal launcher, and each
browser keeps a validated private IndexedDB cache for fast reloads.

The enforced dependency direction is documented in [ARCHITECTURE.md](ARCHITECTURE.md):
framework behavior flows into an engine-family adapter, then into a small game
adapter. Framework releases are linked during local development and copied
with a version/SHA manifest for reproducible offline images.

The browser document itself is framework-owned. A downstream game does not
ship or maintain `index.html`; it ships only `wasm-game.json`,
`game-adapter.js`, compiled engine artifacts, and game-specific public assets.
When `wasm-game.json` exists, the framework server serves its canonical
`dist/index.html` for `/` and client-side routes.

The canonical document loads the same immutable package files:

```html
<link rel="stylesheet" href="/shared-shell/wasm-game-framework.css">
<script src="/shared-shell/wasm-game-framework.js"></script>
<script src="/shared-shell/wasm-game-bootstrap.js"></script>
```

Then it calls `WasmGameFramework.configure()` with only engine-specific policy:

- a `4:3`, `16:9`, or `dynamic` display contract;
- whether canvas pixels should be crisp;
- whether a graphics profile and dynamic-quality controls are meaningful;
- whether multiplayer identity is currently meaningful;
- an optional resize callback for engines that can change their backbuffer.

The declarative boundary looks like this:

```json
{
  "id": "quake2",
  "title": "Quake II",
  "kicker": "id Tech 2",
  "icon": "/quake2.ico",
  "iconPixelated": false,
  "background": "/quake2-background.jpg",
  "backgroundPosition": "center",
  "backgroundSize": "cover",
  "pwa": {
    "shortName": "Quake II",
    "themeColor": "#5f190d",
    "backgroundColor": "#000000",
    "icons": [
      { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  },
  "displayMode": "dynamic",
  "nativeManaged": true,
  "identity": true,
  "graphics": true,
  "profiles": [
    { "value": "original", "label": "Original" },
    { "value": "modern", "label": "Modernized" }
  ],
  "fpsTargets": [30, 60, 120],
  "adapter": "/game-adapter.js"
}
```

`game-adapter.js` registers one object, not markup:

```js
globalThis.WasmGameAdapter = {
  async init(context) {},
  async start(context) {},
  readEngineState(context) { return 'menu'; },
  resize(detail, context) {},
  captureLost(detail, context) {}
};
```

The adapter owns native engine seams and validation policy. The framework owns
all launcher, provisioning, loading, preference, canvas, mobile notice, and
capture markup and behavior.

`icon` is also installed as the tab favicon. Suite variants override it so the
launcher and browser tab use the same authentic, redistributable title icon;
`iconPixelated` is available for intentionally low-resolution originals.

The same manifest supplies installable-app metadata under `pwa`. The framework
serves a variant-aware `/app.webmanifest`, registers its own service worker,
and opens installed games in standalone landscape mode. Supply authentic
192x192 and 512x512 PNGs, or a scalable SVG with `sizes: "any"`, so Chrome can
offer **Install app** with the correct game artwork. The service worker uses a
network-first fallback only for the small framework shell. It deliberately
does not duplicate engine artifacts or proprietary game data; validated owner
files remain in the framework's versioned IndexedDB cache.

The display mode is title/profile policy, not necessarily a user-facing
control. `4:3` and `16:9` always contain the canvas with black bars and never
distort it. `dynamic` fills the live viewport. A native-managed dynamic engine
receives the requested dimensions and the shell keeps showing its last valid
backbuffer aspect until the engine confirms the new one, preventing resize
stretching.

Engines that can resize promptly may set `resizeTransition: "immediate"`.
That fills the new viewport in the same animation frame while the native
backbuffer is being updated, avoiding a visible black interval during resize.

Examples: Wolf3D and original/smooth Doom use `4:3`; modernized Doom, WolfET,
Quake III, and modernized Quake use `dynamic`. An adapter changes the active
profile with `shell.setDisplayMode()`.

## Launcher and runtime state

The framework owns the browser-facing state machine:

```text
provisioning -> launcher -> loading -> menu -> gameplay -> paused/debrief
                                                    \-> crashed
```

Engine adapters call `shell.setEngineState(state)`. The framework focuses the
canvas and permits pointer capture only in `gameplay`; entering a menu, pause,
debrief, launcher, or crash state releases it. Browser defaults for gameplay
keys are suppressed only while input is actually captured, so Ctrl+Shift+R,
copy/paste, and normal page controls continue to work outside play. A lost
capture invokes the adapter's `onCaptureLost` hook so games can open their
native pause menu.

Native menus declare `pointerWidth` and `pointerHeight` in `wasm-game.json`.
The framework maps client coordinates through the canvas's actual CSS rectangle
and calls `pointerMove(detail, event, context)` and
`pointerButton(detail, event, context)` in that virtual coordinate space.
Menu, paused, and debrief states hide the host cursor over the canvas, leaving
only the engine-rendered cursor visible without acquiring pointer lock.
Widescreen renderers whose native UI remains centered at a fixed aspect set
`pointerFit: "contain"`; the transform then removes the exact letterbox or
pillarbox offset before converting into native menu coordinates.

`createPreferences()` owns persistent player name, quality profile, dynamic
quality, target-FPS, and “Launch fullscreen” controls. Fullscreen is requested
directly from the Play click so browser user-activation rules are satisfied;
set `fullscreen: false` only for a title that cannot support it, or
`defaultFullscreen: true` when fullscreen should start checked. The common selectors are
`data-shell-player-name`, `data-shell-quality-profile`,
`data-shell-dynamic-quality`, and `data-shell-target-fps`. The shell also adds
a compact “best on desktop” notice for small/coarse-pointer devices.

Proprietary game data does not belong in this package.

## Container provisioning and browser cache

There are deliberately two durable data layers:

1. The administrator provisions legally owned files once into the container's
   persistent `/data` volume.
2. Each browser downloads each validated file from that container once and
   retains it in origin-private IndexedDB for fast reloads.

Every game image includes `wasm-game-data.json`, an exact filename,
size/signature, and preferably SHA-256 allowlist. While required files are
missing or invalid, `createContainerDataClient().applyGate()` shows only the
elements marked `data-shell-provisioning`. The first-run picker uploads exact
files to `/game-data/setup/<key>`; the framework server validates before an
atomic write to `/data`. Set `WASM_SETUP_TOKEN` to require that token during
provisioning. As soon as `/game-data/status` reports ready, provisioning is
hidden for every visitor and only the regular launcher is shown.

The data server exposes neither `/data` nor `/local-data`. Once the complete
allowlist is valid, it serves only `/game-data/files/<key>`. Arbitrary names,
path traversal, invalid sizes/signatures/hashes, and replacement of
already-valid files are rejected.

Example site manifest:

```json
{
  "namespace": "quake",
  "version": "steam-v1",
  "files": [
    {
      "key": "pak0",
      "name": "pak0.pak",
      "path": "id1/pak0.pak",
      "size": 18689235,
      "magic": "PACK",
      "sha256": "..."
    }
  ]
}
```

Suite images may put independent policies under a top-level `variants` map.
The launcher passes its selected deployment key to
`createContainerDataClient({ variant })`, and every status, setup, and file
request is scoped to that exact variant. A unified Doom image can therefore
launch after provisioning Doom II alone; it does not demand every IWAD. A
single-title image uses its locked `WASM_GAME_VARIANT` when the query is
omitted.

```json
{
  "namespace": "doom-suite",
  "version": "iwads-v1",
  "variants": {
    "doom":  { "files": [{ "key": "iwad", "name": "doom.wad",  "path": "doom/doom.wad" }] },
    "doom2": { "files": [{ "key": "iwad", "name": "doom2.wad", "path": "doom2/doom2.wad" }] }
  }
}
```

Files marked `"required": false` do not block readiness. A missing optional
file is skipped during browser-cache restore, and an administrator may add it
later through the same exact allowlisted setup endpoint. Calling
`provision(source, { includeOptional: true })` explicitly requests that later
optional-data pass.

`WasmGameFramework.createDataCache()` stores already validated owner files as
Blobs in a per-game IndexedDB database. `getOrLoad()` checks that private cache
first, deduplicates simultaneous requests, and calls the container download
loader only on a true miss. A cache-version bump invalidates prior records
without redownloading unchanged code assets. `persist()` requests durable
browser storage during the Play gesture and reports quota estimates.

```js
const data = WasmGameFramework.createDataCache({
  namespace: 'doom-suite',
  version: 'iwad-policy-v1'
});
await data.persist();
const entry = await data.getOrLoad({
  key: 'doom2.wad',
  load: () => fetch('/game-data/files/doom2').then(r => r.blob()),
  validate: validateDoomIwad
});
// entry.cached is true after a hard refresh; no game-data request was made.
```

Validation policy remains engine-owned. A record is trusted on later loads
only inside the same namespace/version, so changing allowed sizes, hashes, or
formats must bump that version. IndexedDB is origin-private; provisioning
uploads only to the user's own same-origin container.

For very large archives whose full digest was already verified during initial
ingestion, a file policy may set `validateCached: false`. Cache restores still
check the exact policy version, filename, size, and signature but skip the
expensive custom digest callback. Changing any allowlist digest must therefore
bump the owner-data-set version.

For a multi-file game, `createOwnerDataSet()` applies the engine/game policy,
restores every valid file cache-first, requests only missing files, and asks
for durable storage. `mountOwnerFiles()` then presents the results read-only
through WORKERFS when available or copies them to MEMFS in bounded chunks.
This is the standard owner-data path for every downstream engine.
Build-engine games and other layouts with meaningful subdirectories can pass
`preservePaths: true`; the framework then creates traversal-safe relative
directories in MEMFS and retains policy `mountName` paths such as
`movie/LOGO.SMK` instead of flattening them.

The matching server package exports `IdleServiceSupervisor`. It deduplicates
simultaneous wake requests, chooses a random rotation map, tracks fully joined
human population, honors `KEEP_ALIVE`, and stops an idle dedicated server after
`IDLE_TIMEOUT`. Browser launchers call `createWakeClient()` from their Play
gesture so loading feedback starts immediately while the native server wakes.

## Suite and single-title images

`WasmGameFramework.resolveDeployment()` is the common deployment contract for a
shared engine family. A suite image leaves its title selector visible. A
single-title image injects `WASM_GAME_VARIANT` before the launcher loads; the
same launcher then selects and locks that title and hides only the selector.
URL query selection remains available in suite builds for portal shortcuts.

```html
<script src="/wasm-game-config.js"></script>
<script src="/shared-shell/wasm-game-framework.js"></script>
<script>
  const deployment = WasmGameFramework.resolveDeployment({
    selector: '#game',
    variants: gameDefinitions,
    defaultVariant: 'doom'
  });
</script>
```

The Doom, GoldSource, and Source families use this once to emit both forms:

- unified suite image: `WASM_GAME_VARIANT=suite`;
- individually branded image: `WASM_GAME_VARIANT=doom2`, `opfor`, `hl2`, etc.

This is a presentation/deployment lock, not a data entitlement mechanism.
Every variant still validates owner-provided data independently.

The generic static-image builder first creates the exact versioned
`wasm-game-framework:<version>` base image, then layers only a game site and
variant lock on it. It never copies owner data into an image:

```bash
./scripts/build-static-image.sh ../crispy-doom-wasm/web doom-wasm:dev suite
./scripts/build-static-image.sh ../crispy-doom-wasm/web doom2-wasm:dev doom2
```

Downstream CI may set `WASM_GAME_FRAMEWORK_IMAGE` to a published immutable
framework base. Without that override, every local game-image build rebuilds
the versioned base from the sibling framework checkout so uncommitted framework
work flows into local downstream images too.

At runtime `/data` is an owner-mounted persistent volume. The framework server
is the sole provisioning and download boundary described above.

## Development

Run the complete Node test suite with `npm test`. It covers the canonical
document, launcher and viewport behavior, lifecycle supervision, validated
provisioning, private data delivery, PWA metadata, and service-worker policy.
Docker smoke tests should additionally verify that `/data` is never publicly
served and that the image reports the exact framework package version.

Never submit framework or downstream engine changes to any upstream project.
