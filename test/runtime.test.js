'use strict';

const assert = require('node:assert/strict');

let trustedPointerActivation = false;

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
    const priorActivation = trustedPointerActivation;
    if (type === 'pointerdown' || type === 'pointerup') trustedPointerActivation = true;
    try {
      for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    } finally {
      trustedPointerActivation = priorActivation;
    }
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
let pointerLockRequests = 0;
let pointerLockDenied = 0;
canvas.requestPointerLock = () => {
  pointerLockRequests += 1;
  if (!trustedPointerActivation) {
    pointerLockDenied += 1;
    throw new Error('NotAllowedError: requestPointerLock requires transient activation');
  }
  documentTarget.pointerLockElement = canvas;
  documentTarget.dispatch('pointerlockchange');
  return Promise.resolve();
};

const framework = require('../dist/wasm-game-framework.js');
let nativeState = 'menu';
let captureIntent = false;
let pointerAction = 'sync';
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
    if (detail.pressed && pointerAction === 'down-intent') {
      captureIntent = true;
    } else if (!detail.pressed) {
      if (pointerAction === 'sync') {
        nativeState = 'loading';
        captureIntent = true;
      } else if (pointerAction === 'sync-intent-only') {
        captureIntent = true;
      } else if (pointerAction === 'delayed') {
        requestAnimationFrame(() => {
          nativeState = 'loading';
          captureIntent = true;
        });
      }
    }
  },
  onCaptureLost: () => { captureLost += 1; },
  onNativeResizeRequest: detail => resizes.push(detail)
});

assert.equal(shell.engineState(), 'menu');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
assert.equal(shell.engineState(), 'loading', 'JOIN must publish authoritative loading state inside the trusted callback');
assert.equal(shell.inputCaptured(), true, 'synchronous JOIN intent must capture before trusted activation ends');
assert.equal(pointerLockRequests, 1);
flushFrame();
assert.equal(pointerLockRequests, 1, 'the next-frame fallback must not duplicate an already successful request');

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
pointerAction = 'none';
const beforeMenuClick = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 2 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 2 });
assert.equal(shell.inputCaptured(), false, 'native menu actions without immediate intent must never capture');
assert.equal(pointerLockRequests, beforeMenuClick, 'a normal menu click must not request pointer lock');
flushFrame();
assert.equal(pointerLockRequests, beforeMenuClick, 'the fallback must not invent intent for a normal menu click');

nativeState = 'paused';
captureIntent = false;
pointerAction = 'none';
shell.setEngineState('paused');
const beforePausedClick = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });
assert.equal(shell.inputCaptured(), false, 'an ordinary paused-menu click must not capture');
assert.equal(pointerLockRequests, beforePausedClick);
flushFrame();

captureIntent = true;
const beforeStaleIntent = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 4 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 4 });
assert.equal(shell.inputCaptured(), false, 'stale paused-state intent must not become trusted for a later click');
assert.equal(pointerLockRequests, beforeStaleIntent);
flushFrame();

captureIntent = false;
pointerAction = 'sync-intent-only';
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 5 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 5 });
assert.equal(shell.engineState(), 'paused', 'queued native Resume may honestly remain paused inside pointerButton');
assert.equal(shell.inputCaptured(), true, 'a rising event-scoped Resume intent must capture inside its trusted callback');
captureIntent = false;
shell.setEngineState('paused');
assert.equal(shell.inputCaptured(), false, 'a failed or cancelled Resume can release while authoritative state remains paused');
flushFrame();

captureIntent = false;
pointerAction = 'down-intent';
const beforeDownEdge = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 6 });
assert.equal(shell.inputCaptured(), false, 'a pointerdown intent edge waits for its matching pointerup');
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 6 });
assert.equal(shell.inputCaptured(), true, 'intent raised on pointerdown captures on the matching pointerup gesture');
assert.equal(pointerLockRequests, beforeDownEdge + 1);
captureIntent = false;
shell.setEngineState('paused');
flushFrame();

pointerAction = 'none';
const beforeBetweenEvents = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
captureIntent = true; // Native/SDL processing may run on a frame between DOM events.
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
assert.equal(shell.inputCaptured(), true, 'intent raised between matching down/up events remains part of that trusted gesture');
assert.equal(pointerLockRequests, beforeBetweenEvents + 1);
captureIntent = false;
shell.setEngineState('paused');
flushFrame();

captureIntent = false;
pointerAction = 'down-intent';
const beforeMismatchedPointer = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 7 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 8 });
assert.equal(shell.inputCaptured(), false, 'a different pointer cannot consume a tracked intent gesture');
assert.equal(pointerLockRequests, beforeMismatchedPointer);
canvas.dispatch('pointercancel', { pointerId: 7, button: 0 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 7 });
assert.equal(pointerLockRequests, beforeMismatchedPointer, 'cancelled intent cannot be reused by a later pointerup');

captureIntent = false;
const beforeMismatchedButton = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 9 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 1, pointerId: 9 });
assert.equal(shell.inputCaptured(), false, 'a different button cannot consume a tracked intent gesture');
assert.equal(pointerLockRequests, beforeMismatchedButton);
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 9 });
assert.equal(pointerLockRequests, beforeMismatchedButton, 'button mismatch clears the stale gesture');
captureIntent = false;

pointerAction = 'sync-intent-only';
const beforeUntrackedUp = pointerLockRequests;
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 12 });
assert.equal(shell.inputCaptured(), false, 'an untracked pointerup cannot authorize event-scoped capture');
assert.equal(pointerLockRequests, beforeUntrackedUp);
captureIntent = false;

pointerAction = 'delayed';
nativeState = 'menu';
shell.setEngineState('menu');
const beforeDelayed = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 10 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 10 });
assert.equal(shell.inputCaptured(), false);
assert.equal(pointerLockRequests, beforeDelayed, 'intent unavailable inside dispatch must not request capture synchronously');
flushFrame();
assert.equal(shell.engineState(), 'loading', 'the rAF fallback still observes delayed native state');
assert.equal(shell.inputCaptured(), false, 'delayed-only intent cannot bypass the trusted activation requirement');
assert.equal(pointerLockRequests, beforeDelayed + 1, 'the fallback still attempts compatibility capture');
assert.equal(pointerLockDenied, 1, 'the test browser rejects pointer lock outside the dispatch activation window');
captureIntent = false;
nativeState = 'menu';
shell.setEngineState('menu');

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
