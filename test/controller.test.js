'use strict';

const assert = require('node:assert/strict');
const {
  CONTROLLER_MODES,
  createControllerManager,
  createPreferences,
  normalizeControllerMode,
  normalizeWasdMouseController
} = require('../dist/wasm-game-framework.js');

global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

global.document = {
  querySelector() { return null; },
  createElement() { return { value: '', textContent: '' }; }
};

class Events {
  constructor() { this.listeners = new Map(); this.dispatched = []; }
  addEventListener(type, callback) {
    const values = this.listeners.get(type) || [];
    values.push(callback);
    this.listeners.set(type, values);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }
  dispatchEvent(event) { this.dispatched.push(event); }
}

function button(value = 0) {
  return { pressed: value >= 0.5, touched: value > 0, value };
}

function gamepad(overrides = {}) {
  return {
    index: 0,
    id: 'Fixture Controller',
    mapping: 'standard',
    connected: true,
    timestamp: 100,
    axes: [0.5, -0.75, 0.4, -0.25],
    buttons: Array.from({ length: 16 }, () => button()),
    ...overrides
  };
}

assert.equal(normalizeControllerMode('wasd+mouse'), CONTROLLER_MODES.WASD_MOUSE);
assert.equal(normalizeControllerMode({ mode: 'custom' }), CONTROLLER_MODES.CUSTOM);
assert.equal(normalizeControllerMode(false), CONTROLLER_MODES.DISABLED);
assert.equal(normalizeControllerMode('bogus'), null);

const preferenceStorage = new Map([
  ['wasm-game-preferences:controller-fixture', JSON.stringify({ controller: 'device:1234abcd' })]
]);
global.localStorage = {
  getItem(key) { return preferenceStorage.get(key) || null; },
  setItem(key, value) { preferenceStorage.set(key, value); }
};
const controllerSelect = {
  value: 'auto',
  options: [{ value: 'disabled' }, { value: 'auto' }],
  ownerDocument: global.document,
  addEventListener() {},
  appendChild(option) { this.options.push(option); }
};
const preferences = createPreferences({ namespace: 'controller-fixture', controller: controllerSelect });
assert.equal(preferences.values().controller, 'device:1234abcd',
  'a stable controller identity must survive reload before that device reconnects');
assert.ok(controllerSelect.options.some(option => option.value === 'device:1234abcd'));

const normalized = normalizeWasdMouseController(gamepad(), {
  moveDeadzone: 0.2,
  lookDeadzone: 0.1,
  lookSensitivity: 2
});
assert.ok(normalized.right > 0);
assert.ok(normalized.forward > 0);
assert.ok(normalized.lookX > 0.6);
assert.ok(normalized.lookY < 0);

(async () => {
  const events = new Events();
  const frames = new Map();
  let nextFrame = 1;
  let pads = [gamepad({ buttons: Array.from({ length: 16 }, (_, index) => button(index === 7 ? 1 : 0)) })];
  const changes = [];
  const inputs = [];
  const navigatorTarget = { getGamepads: () => pads };
  const manager = createControllerManager({
    mode: 'wasdMouse',
    navigatorTarget,
    eventTarget: events,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    onChange: state => changes.push(state),
    onFrame: frame => inputs.push(frame)
  });

  assert.equal(manager.start(), true);
  assert.equal(manager.start(), false, 'controller polling starts only once');
  assert.equal(manager.state().connected, true);
  assert.equal(manager.state().activeIndex, 0);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].mode, 'wasdMouse');
  assert.equal(inputs[0].actions.attack, 1);
  assert.equal(inputs[0].deltaMs, 0);
  assert.ok(Number.isFinite(inputs[0].timestamp));
  assert.equal(inputs[0].gamepad.id, 'Fixture Controller');
  assert.equal(Object.isFrozen(inputs[0].gamepad.axes), true);

  manager.select('disabled');
  const inputCount = inputs.length;
  const callback = [...frames.values()].at(-1);
  frames.clear();
  callback();
  assert.equal(inputs.length, inputCount, 'the launcher Disabled choice suppresses native controller frames');

  manager.select('auto');
  pads = [gamepad({ index: 2, id: 'Bluetooth Fixture', timestamp: 200 })];
  const next = [...frames.values()].at(-1);
  frames.clear();
  next();
  assert.equal(manager.state().activeIndex, 2);
  assert.ok(changes.some(state => state.controllers.some(item => item.id === 'Bluetooth Fixture')));
  const stableKey = manager.state().controllers[0].key;
  assert.match(stableKey, /^device:[0-9a-f]{8}$/);
  manager.select(stableKey);
  pads = [
    gamepad({ index: 2, id: 'Bluetooth Fixture', timestamp: 201 }),
    gamepad({ index: 5, id: 'Noisier Second Controller', timestamp: 999 })
  ];
  const selectedPoll = [...frames.values()].at(-1);
  frames.clear();
  selectedPoll(116);
  assert.equal(manager.state().activeIndex, 2,
    'a remembered stable device identity must not follow a different transient Gamepad index');
  assert.ok(inputs.at(-1).deltaMs >= 0);

  const actuatorCalls = [];
  pads[0].vibrationActuator = {
    async playEffect(type, detail) { actuatorCalls.push([type, detail]); }
  };
  assert.equal(await manager.rumble({ duration: 40, weakMagnitude: 0.25, strongMagnitude: 0.75 }), true);
  assert.equal(actuatorCalls[0][0], 'dual-rumble');
  assert.equal(actuatorCalls[0][1].strongMagnitude, 0.75);

  manager.stop();
  assert.equal(frames.size, 0);

  const customInputs = [];
  const customFrames = new Map();
  const custom = createControllerManager({
    mode: 'custom',
    navigatorTarget,
    eventTarget: events,
    requestAnimationFrame(callback) { customFrames.set(1, callback); return 1; },
    cancelAnimationFrame() { customFrames.clear(); },
    onFrame: frame => customInputs.push(frame)
  });
  custom.start();
  assert.equal(customInputs[0].actions, null, 'custom adapters receive raw axes/buttons without framework mappings');
  custom.stop();

  const unsupported = createControllerManager({
    mode: 'custom', navigatorTarget: {}, eventTarget: events,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}
  });
  assert.equal(unsupported.refresh().supported, false);

  const disabled = createControllerManager({ mode: 'disabled', navigatorTarget, eventTarget: events });
  assert.equal(disabled.start(), false);
  assert.equal(disabled.state().mode, 'disabled');

  console.log('USB/Bluetooth discovery, launcher selection, WASD+mouse normalization, custom mapping, and rumble contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
