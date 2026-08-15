# Game adapter runbook

This is the implementation and acceptance contract for connecting a native
game runtime to WASM Game Framework. Follow it for every title and profile.
Compiling, linking, serving a canvas, or reaching a menu does not by itself
prove that an adapter is complete.

## 1. Keep the boundary clean

The framework owns the document, launcher, loading surface, setup gate,
responsive canvas CSS, preferences, fullscreen request, PWA metadata,
pointer-lock lifecycle, and browser cache. A downstream game publishes:

```text
wasm-game.json
wasm-game-data.json
game-adapter.js
engine JavaScript/WebAssembly
game-specific public icons and backgrounds
```

Do not add downstream `index.html`, CSS, service workers, web manifests,
launcher markup, pointer-lock managers, or viewport styling. If several games
share an engine, put native and JavaScript seams in the engine-family adapter
and keep title adapters declarative.

Run the static package gate against the staged public directory:

```bash
node /path/to/wasm-game-framework/scripts/check-game-package.js build/site
```

The browser checks later in this runbook are still required.

## 2. Declare the browser contract

Every merged suite variant must resolve to an explicit browser policy. This is
a representative dynamic renderer:

```json
{
  "id": "example",
  "title": "Example Game",
  "icon": "/example.ico",
  "background": "/example-background.jpg",
  "pwa": {
    "shortName": "Example",
    "themeColor": "#402010",
    "backgroundColor": "#000000",
    "icons": [
      { "src": "/example-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/example-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  },
  "displayMode": "dynamic",
  "nativeManaged": true,
  "syncBackbuffer": false,
  "resizeTransition": "immediate",
  "pointerWidth": 640,
  "pointerHeight": 480,
  "pointerFit": "contain",
  "pointerLock": true,
  "fullscreen": true,
  "identity": true,
  "graphics": true,
  "adapter": "/game-adapter.js"
}
```

Use `4:3` or `16:9` when the renderer must retain that aspect. Use `dynamic`
only when the native renderer can change its actual backbuffer and projection.
`pointerWidth` and `pointerHeight` describe the native menu coordinate system,
not the render target. A 640×480 menu can live over a 1720×900 backbuffer.

Launcher `description` is optional. Normal launcher and PWA copy describes the
game, not setup, file placement, storage, or caching. Put file instructions in
`provisioningText`; the framework shows them only while required data is
missing.

## 3. Implement the adapter seam

Register one object:

```js
globalThis.WasmGameAdapter = Object.freeze({
  async init(context) {},
  async start(context) {},
  readEngineState(context) { return 'menu'; },
  readCaptureIntent(context) { return false; },
  resize(detail, context) {},
  pointerMove(detail, event, context) {},
  pointerButton(detail, event, context) {},
  preferencesChanged(values, context) {},
  inputCaptureChanged(captured, context) {},
  captureLost(detail, context) {},
  contextLost(event, context) {},
  contextRestored(event, context) {}
});
```

Only `start()` is unconditional. The framework contract validator also
requires:

- `resize()` when `nativeManaged` is true;
- `pointerMove()` and `pointerButton()` when a native pointer space is declared;
- `readEngineState()` and `captureLost()` when pointer lock is enabled.

`init()` loads policy and installs native callbacks without starting the game.
`start()` consumes the already-saved preferences, restores validated data,
starts the engine once, and reports loading progress. Starting a second time
must either resume the existing runtime safely or perform a deliberate clean
restart; it must never create a second main loop.

## 4. Report authoritative runtime state

Use native cvars, exported functions, QVM/module callbacks, snapshots, or
equivalent engine truth. Do not infer state from a timeout, canvas visibility,
pointer lock, or the last button the browser clicked.

| State | Meaning | Pointer capture |
|---|---|---|
| `launcher` | Framework options are visible | Released |
| `loading` | Engine, map, or connection is not player-controllable | Released unless launch capture intent is active |
| `menu` | Native main/menu UI owns absolute pointer input | Released |
| `gameplay` | A valid player snapshot/world is controllable | Captured |
| `paused` | In-game menu or pause UI is active | Released |
| `debrief` | Score/intermission UI is active | Released |
| `crashed` | Native runtime cannot continue | Released |

Do not mark gameplay at engine initialization. For network games, wait for the
first valid active snapshot. For single-player games, wait until the world and
player controller are active. Emit menu/paused/debrief immediately when native
UI opens so pointer lock is released on that same frame.

## 5. Capture and release input correctly

The framework is the only code that calls `requestPointerLock()` or
`exitPointerLock()`. Adapters report state and translate native events; they do
not compete with the framework for browser capture.

Browsers require a trusted click for the first pointer-lock request. Async
JOIN, New Game, and Resume actions therefore need a native capture-intent bit:

1. `pointerButton(detail, event)` delivers the native menu action while the
   browser's trusted pointer event is still active.
2. At pointerdown, the framework snapshots `readCaptureIntent()` and tracks the
   pointer ID and button. Intent already true at this point is stale and cannot
   authorize this gesture.
3. Native dispatch may raise intent while handling pointerdown, between events
   on a native frame, or while handling the matching pointerup. Alternatively,
   the adapter exposes a predeclared capture target for that exact JOIN/New
   Game/Resume control. Do not infer intent from an arbitrary click.
4. At matching pointerup, a false-to-true intent edge lets the framework call
   `requestPointerLock()` on the same trusted event stack. Queued SDL work may
   honestly leave `readEngineState()` at `menu` or `paused` for this callback.
5. On the following native tick, state reports `loading` and then `gameplay`,
   allowing the ordinary persistent capture rules to retain lock. The bit
   clears on success, failure, disconnect, cancellation, or Escape. A failed
   transition reports `menu`/`paused` again so capture is released.

Pointer ID/button mismatch, `pointercancel`, and `lostpointercapture` clear the
gesture without authorization. The event-scoped exception never changes
`captureDesired()`: outside the matching trusted pointerup, only `loading` with
current intent or authoritative `gameplay` may capture or retain lock.

The framework also checks again on the next animation frame for engines whose
native transition becomes visible late. That is a compatibility fallback, not
the primary request: Chrome may reject it because transient activation has
already ended. Acceptance must prove the synchronous path. A delayed-only
intent is not considered a working JOIN or Resume capture implementation.

Never fake `gameplay` merely to obtain capture. Apart from the exact rising
JOIN/New Game/Resume gesture above, never capture while a main, pause, limbo,
chat, console, scoreboard, or debrief cursor is active.

When capture is lost during gameplay, `captureLost()` must invoke exactly one
native pause/menu action. Avoid a second legacy `pointerlockchange` listener
that injects another Escape. `inputCaptureChanged()` updates native relative
mouse mode when the engine needs an explicit signal. Browser shortcuts remain
available whenever capture is released.

Acceptance sequence:

```text
launcher: released
native menu: released, host cursor hidden over canvas
JOIN/New Game click: trusted capture intent
loading: honest loading state, intent retained
first controllable frame: gameplay + captured
Escape: paused/menu + released
Resume click: captured again
disconnect/debrief/crash: released
```

## 6. Map menu pointer coordinates

The framework maps browser client coordinates through the live CSS canvas
rectangle into the declared virtual menu size. The adapter forwards the
resulting absolute `detail.x`/`detail.y` and button state to the native input
queue.

- Initialize each native main-menu cursor to a known virtual point, normally
  the center.
- Reset the adapter's previous absolute point only on an actual transition into
  that menu.
- Preserve independent in-game menu initialization when the engine has one.
- Use `pointerFit: "contain"` when a fixed-aspect UI is centered inside a
  dynamic render target.
- Do not add browser offsets, widescreen bias, DPR, or CSS compensation in the
  adapter; the framework already removed those.
- Relative gameplay mouse movement uses `movementX`/`movementY` only while
  captured. It must not reuse absolute menu coordinates.

Verify the native and hidden host cursor at the center and four near-corner
points, before and after both a narrow and wide resize. Verify the main menu
and in-game menu separately.

## 7. Resize the real backbuffer

There are three different sizes:

1. CSS viewport size, owned by the framework;
2. physical canvas/backbuffer size, owned according to the manifest policy;
3. virtual menu coordinates, fixed by the native UI and unrelated to 1 or 2.

For a fixed software renderer, declare `4:3` (or `16:9`) and usually
`syncBackbuffer: true`. For a dynamic native renderer, declare
`nativeManaged: true`, `syncBackbuffer: false`, and implement `resize(detail)`:

```js
resize(detail) {
  const width = Math.max(2, detail.requestedWidth);
  const height = Math.max(2, detail.requestedHeight);
  nativeSetResolution(width, height);
  module.setCanvasSize(width, height);
}
```

The adapter must update the drawing buffer, native viewport, projection, and
resolution cvars in the same animation frame when the engine permits it. Do not
leave a one-second desktop debounce in the browser build. Do not clamp the
physical render target to the virtual 640×480 menu size. If the engine has a
real lower limit, document and test the smallest accepted native resolution
while allowing CSS containment below it without distortion.

Publish forced/native resolution state before changing a canvas whose resize
listeners can feed its dimensions back into the engine. Do not pass a runtime's
`noUpdates`/`suppressResize` flag unless the adapter has a separately tested
native callback that updates the viewport and projection; suppressing the SDL
resize event while changing only the browser canvas produces a stretched or
stale renderer.

Use `resizeTransition: "immediate"` only when the adapter follows that rule.
The framework resamples viewport geometry across multiple frames after Chrome
enters or exits fullscreen, then sends the settled dimensions. The adapter must
accept every callback, including fullscreen exit, browser chrome changes, and
portrait/narrow windows.

At each test size prove:

- CSS canvas equals the intended contained/filled rectangle;
- canvas width/height and native resolution cvars agree;
- WebGL viewport matches the drawing buffer;
- circles, faces, HUD elements, and menu pointers are not stretched;
- no stale black strip remains after two animation frames for an immediate
  renderer.

## 8. Apply identity and quality at the correct time

Sanitize the framework player name for the engine's command/cvar syntax. Apply
it in initial arguments and again after native configuration files load but
before the first connection. Configuration execution commonly overwrites the
startup value with `Player`; a launcher-only assertion will miss that bug.
Verify the actual server/scoreboard name.

Read initial profile, FPS, and dynamic-quality preferences in `start()`. Apply
later changes through `preferencesChanged()`. Profiles must change the native
renderer settings they claim to change. FPS targets must be measured, not only
written to a cvar. A profile that changes aspect policy calls
`context.shell.setDisplay()` or `setDisplayMode()` and immediately resizes the
native backbuffer.

WASD and mouse defaults must be installed after any native config that can
overwrite them. Do not make vertical mouse look available in games whose
original gameplay has no vertical aiming unless that profile explicitly adds
it.

## 9. Data, persistence, audio, and recovery

Use `context.dataClient.load()` with a versioned
`createOwnerDataSet()`/game-data set and mount only validated entries. The
container remains the source; IndexedDB is the browser fast path. Once required
data is ready, the normal launcher contains no setup or storage commentary.

Put format and title recognition in a downstream `.mjs` validator referenced by
`wasm-game-data.json`, never in the framework. The same pure module must run in
Node and the browser. It receives `{ name, size, policy, read, digest }` and
returns `{ accepted: true, identity?, version?, fingerprint?, metadata? }` or
`{ accepted: false, error }`. Declare a finite `sizes` list or `maxSize`, an
explicit validator `version`, and bounded read budgets. Root/variant validator
defaults may be overridden per file; set `validator: false` for files that use
only filename/size/magic/hash checks. Bump the validator version whenever its
semantics change.

Initialize save/config persistence before allowing play and flush it on native
save events, visibility loss, and clean unload when practical. Do not persist
read-only game archives into the save filesystem.

Resume audio from framework user-gesture events. Verify music, positional
effects, weapons, enemies, UI sounds, focus loss, and resume independently;
hearing one category does not prove the backend is correct.

On WebGL context loss report `paused`, stop native rendering safely, and show a
recoverable diagnostic. `contextRestored()` must rebuild renderer resources or
perform a native renderer restart. A fatal native error reports `crashed` and
must not leave capture active.

## 10. Required acceptance pass

Run static tests, a production Docker image, and a real Chromium-family browser.
Firefox is a useful second implementation check but does not replace Chromium.
Test one game at a time.

For every runnable variant record evidence for:

1. missing-data setup and ready-state launcher;
2. second load from browser cache without setup UI;
3. player name/profile/FPS handoff;
4. native main-menu pointer center and corners;
5. narrow, wide, fullscreen-enter, and fullscreen-exit native resolution;
6. New Game/JOIN loading state and first controllable frame;
7. automatic capture, WASD, relative mouse, Escape release, and Resume capture;
8. console/chat/debrief input where the game provides it;
9. representative level rendering and audio categories;
10. save/config persistence and hard refresh;
11. PWA manifest, icons, service worker, and install metadata;
12. `/data` and `/local-data` inaccessible while allowlisted game-data routes
    work;
13. no downstream-authored document, CSS, service worker, or web manifest;
14. no game archives or generated WASM/data artifacts tracked in Git.

For an engine that cannot yet reach gameplay, execute every item reachable at
its honest milestone and document the exact native blocker. Do not mark an
unreached behavior as passed because its adapter contains a plausible hook.

## 11. Common failure signatures

- **Name becomes Player:** native config loaded after startup arguments; reapply
  identity immediately before connection.
- **Main cursor offset but pause cursor works:** main-menu native cursor was not
  initialized or its virtual origin differs; do not change framework mapping.
- **One-second black area during resize:** desktop video-restart debounce remains
  in the browser path.
- **Canvas stretches:** CSS resized but native backbuffer/projection did not, or
  fixed and dynamic aspect policies were mixed.
- **No automatic capture after JOIN:** loading was confused with gameplay, or
  capture intent was not emitted during the trusted click.
- **Escape injects twice:** framework `captureLost()` and a legacy
  `pointerlockchange` handler both opened the menu.
- **Some sounds work:** the music and effects paths use different mixers or
  asset lookups; test categories independently.
- **Second launch freezes:** a second main loop was created or native shutdown
  did not complete.
