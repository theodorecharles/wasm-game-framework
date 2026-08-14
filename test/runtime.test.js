'use strict';

const assert = require('node:assert/strict');

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    const values = this.listeners.get(type) || [];
    values.push(callback);
    this.listeners.set(type, values);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }
  dispatch(type, event = {}) {
    event.type = type;
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
  }
}

function node() {
  const target = new Target();
  target.hidden = false;
  target.dataset = {};
  target.style = { setProperty(name, value) { this[name] = value; } };
  target.classList = { add() {}, remove() {} };
  target.setAttribute = (name, value) => { target[name] = value; };
  target.focus = () => { target.focused = true; };
  return target;
}

const frames = new Map();
let nextFrame = 1;
global.requestAnimationFrame = callback => {
  const id = nextFrame++;
  frames.set(id, callback);
  return id;
};
global.cancelAnimationFrame = id => frames.delete(id);
function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback());
}

const windowTarget = new Target();
windowTarget.innerWidth = 800;
windowTarget.innerHeight = 600;
windowTarget.dispatchEvent = event => windowTarget.dispatch(event.type, event);
global.window = windowTarget;
global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const documentTarget = new Target();
documentTarget.documentElement = node();
documentTarget.body = node();
documentTarget.pointerLockElement = null;
documentTarget.querySelector = () => null;
documentTarget.querySelectorAll = () => [];
documentTarget.createElement = () => node();
documentTarget.exitPointerLock = () => {
  documentTarget.pointerLockElement = null;
  documentTarget.dispatch('pointerlockchange');
};
global.document = documentTarget;

const canvas = node();
canvas.width = 640;
canvas.height = 480;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: windowTarget.innerWidth, height: windowTarget.innerHeight });
canvas.requestPointerLock = () => {
  documentTarget.pointerLockElement = canvas;
  documentTarget.dispatch('pointerlockchange');
  return Promise.resolve();
};

const framework = require('../dist/wasm-game-framework.js');
let nativeState = 'menu';
let captureIntent = false;
let captureLost = 0;
const resizes = [];
const shell = framework.configure({
  launcher: node(), card: node(), loading: node(), runtime: node(), canvas,
  desktopNotice: false,
  displayMode: 'dynamic', nativeManaged: true, resizeTransition: 'immediate',
  pointerLock: true, engineState: 'menu',
  readEngineState: () => nativeState,
  readCaptureIntent: () => captureIntent,
  onPointerButton: detail => {
    if (!detail.pressed) {
      nativeState = 'loading';
      captureIntent = true;
    }
  },
  onCaptureLost: () => { captureLost += 1; },
  onNativeResizeRequest: detail => resizes.push(detail)
});

assert.equal(shell.engineState(), 'menu');
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0 });
flushFrame();
assert.equal(shell.engineState(), 'loading', 'the native click must update state before capture is evaluated');
assert.equal(shell.inputCaptured(), true, 'synchronous loading capture intent must retain the trusted click');

shell.setEngineState('loading');
assert.equal(shell.inputCaptured(), true, 'loading must retain capture while native launch intent is active');
captureIntent = false;
shell.setEngineState('loading');
assert.equal(shell.inputCaptured(), false, 'cancelled loading intent must release capture');

nativeState = 'gameplay';
shell.setEngineState('gameplay');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
assert.equal(shell.inputCaptured(), true, 'gameplay interaction must capture');
documentTarget.pointerLockElement = null;
documentTarget.dispatch('pointerlockchange');
assert.equal(captureLost, 1, 'losing gameplay capture must call the native menu action once');

nativeState = 'menu';
shell.setEngineState('menu');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
assert.equal(shell.inputCaptured(), false, 'native menus must never capture');

const beforeFullscreen = resizes.length;
windowTarget.innerWidth = 1920;
windowTarget.innerHeight = 1080;
documentTarget.dispatch('fullscreenchange');
flushFrame();
windowTarget.innerWidth = 1030;
windowTarget.innerHeight = 710;
flushFrame();
flushFrame();
assert.ok(resizes.length >= beforeFullscreen + 3, 'fullscreen changes must sample more than the first viewport frame');
assert.equal(resizes.at(-1).requestedWidth, 1030);
assert.equal(resizes.at(-1).requestedHeight, 710);

shell.destroy();
console.log('runtime state, capture intent, release, and fullscreen resize tests passed');
