# Adapter seam

Register one object. The bootstrap loads `/game-adapter.js` and requires
`start()`. Other methods become required when the manifest says they are.

```js
globalThis.WasmGameAdapter = Object.freeze({
  async init(context) {},
  async start(context) {},
  readEngineState(context) { return 'menu'; },
  readCaptureIntent(context) { return false; },
  resize(detail, context) {},
  pointerMove(detail, event, context) {},
  pointerButton(detail, event, context) {},
  controllerFrame(detail, context) {},
  controllerChanged(detail, context) {},
  preferencesChanged(values, context) {},
  inputCaptureChanged(captured, context) {},
  captureLost(detail, context) {},
  contextLost(event, context) {},
  contextRestored(event, context) {}
});
```

`npx create-wasm-game` writes a stub that already calls
`context.persistence.attach()` before `callMain`. Replace
`createNativeModule()` with the real factory and keep that order.

## Required methods

{{include:adapter-methods}}

## The context object

{{include:context-fields}}

`start()` must not create a second main loop. A second click should resume
or restart deliberately.

## Engine states

{{include:engine-states}}

Do not mark `gameplay` at engine initialization. For a network game wait
for the first valid snapshot. For single-player wait until the world and
player controller are active.

The full acceptance sequence and failure signatures live in the
[adapter runbook](adapter-runbook.html).
