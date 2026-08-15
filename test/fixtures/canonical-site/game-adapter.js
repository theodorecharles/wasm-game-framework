globalThis.WasmGameAdapter = {
  start(context) {
    context.showRuntime('menu');
  },
  readEngineState() {
    return 'menu';
  },
  captureLost() {
    return undefined;
  },
  controllerFrame() {
    return undefined;
  },
  controllerChanged() {
    return undefined;
  }
};
