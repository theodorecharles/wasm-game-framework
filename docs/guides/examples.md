# Examples

## Scaffold

```bash
npx create-wasm-game my-game
npm create wasm-game@latest my-game -- --display-mode 16:9 --menu-cursor none
```

The generated `web/` directory is the tested example of a legal game site:
declarative manifest, adapter, optional data policy, no document, no CSS.

## Canonical fixture

The framework tests ship a tiny site at `test/fixtures/canonical-site/`.
It is the document smoke test: `displayMode: "4:3"`, `menuCursor:
"browser"`, `controller.mode: "wasdMouse"`, `persistence: false`.

## Fixed-file family

id Tech 1 declares one IWAD per variant and a shared `.mjs` validator.
Doom II can launch without Doom being installed.

## Media library

The console suite declares `mediaLibrary` per system. NES and SNES are
single-file carts. PlayStation is a CUE/BIN bundle plus a 512 KiB firmware
fixed file. PlayStation 2 sets `maxBrowserCacheBytes: 0` so a
whole-file MEMFS loader cannot pretend to support a DVD.

Direct links look like `/?game=ps1&media=<32-hex-id>`. Deployment locks use
`WASM_GAME_MEDIA`.

## Worker persistence

```js
worker.postMessage({
  type: 'persist',
  namespace: context.persistence.namespace,
  root: context.persistence.root,
  frameworkUrl: '/shared-shell/wasm-game-framework.js'
});
```

The worker imports that URL, constructs `createPersistenceManager`,
attaches, then calls native main.

## Wake a dedicated server

```js
const wake = WasmGameFramework.createWakeClient({
  statusUrl: '/status',
  wakeUrl: '/wake',
  onStatus(status) {
    context.shell.setLoadingDetail(status.state);
  }
});

async function start(context) {
  context.shell.setEngineState('loading');
  await wake.ensureRunning({ reason: 'play' });
  await startBrowserEngineAndConnect();
}
```
