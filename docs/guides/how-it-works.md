# How it works

The framework is a versioned browser application. Games configure it. They do
not fork it.

## One document

`dist/index.html` is the only authored page. When `wasm-game.json` exists,
the static server serves that document at `/` and at every extensionless
client route. The page loads three immutable package files:

```html
<link rel="stylesheet" href="/shared-shell/wasm-game-framework.css">
<script src="/shared-shell/wasm-game-framework.js"></script>
<script src="/shared-shell/wasm-game-bootstrap.js"></script>
```

The bootstrap fetches `/wasm-game.json`, merges the selected variant, builds
the shell with `WasmGameFramework.configure()`, and loads `game-adapter.js`.
Play calls `adapter.start(context)` once.

## A small state machine

```text
provisioning → launcher → loading → menu → gameplay → paused / debrief
                                                     ↘ crashed
```

The adapter reports state. The framework decides capture, cursor visibility,
and which surface is showing. Gameplay captures; menus release. A JOIN or
New Game click may reserve pointer lock on that trusted gesture through
`readCaptureIntent()`, even if native state is still `menu` until the next
frame.

## Two durable data layers

1. An operator provisions allowlisted files once onto the container `/data`
   volume. The server never exposes `/data` or `/local-data`.
2. Each browser downloads validated files and keeps them in origin-private
   IndexedDB. Reloads hit the cache.

Saves, configs, keybindings, screenshots, and memory cards are a third
thing: a variant-scoped IDBFS mount. Clearing the game-data cache must not
erase saves, and the other way around.

## Policy, not format knowledge

The framework bounds reads, digests, atomic installs, and cache keys. A
downstream `.mjs` module decides whether a file is Doom, a PlayStation disc,
or an OpenRCT2 tree. The same module runs in Node during upload and in the
browser during cache restore.

Media libraries are the same idea for a variable collection. Entries have
opaque 32-hex IDs. `/?game=ps1&media=<id>` preselects one. `WASM_GAME_MEDIA`
locks one. A missing explicit ID fails closed. It never silently launches
the first cart.

## Suite versus single title

One family repository can emit a suite image and locked title images from
the same site. `WASM_GAME_VARIANT=suite` shows the selector.
`WASM_GAME_VARIANT=doom2` hides it and freezes that title. Each variant
still validates its own files.

## Servers sleep

For hosted multiplayer, Play posts `/wake`. The supervisor starts one native
dedicated process, waits until it is actually accepting game traffic, and
stops it after the last admitted human leaves. Loading the page or opening
`/ws` must not spawn that process. Bots do not keep it alive.

## Why the scaffold looks empty

`npx create-wasm-game` gives you a passing contract and a placeholder
`createNativeModule()`. The interesting work is still native: renderer,
input queue, filesystem, and honest state. The framework is finished when
those seams are honest, not when the JavaScript file is long.
