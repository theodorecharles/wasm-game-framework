(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WasmGameFramework = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function fitRect(viewWidth, viewHeight, aspect, mode) {
    const width = Math.max(1, positive(viewWidth, 1));
    const height = Math.max(1, positive(viewHeight, 1));
    const ratio = positive(aspect, 4 / 3);
    if (mode === 'fill') return { width, height };
    if (width / height > ratio) {
      return { width: height * ratio, height };
    }
    return { width, height: width / ratio };
  }

  function mapPointerPoint(surface, clientX, clientY, targetWidth, targetHeight, options) {
    if (!surface) throw new Error('A canvas or client rectangle is required to map a pointer.');
    const rect = typeof surface.getBoundingClientRect === 'function'
      ? surface.getBoundingClientRect()
      : surface;
    const width = positive(rect.width, 0);
    const height = positive(rect.height, 0);
    if (!width || !height) throw new Error('The game surface has no visible pointer area.');
    const outputWidth = positive(targetWidth, positive(surface.width, width));
    const outputHeight = positive(targetHeight, positive(surface.height, height));
    const pointer = options || {};
    const content = pointer.fit === 'contain'
      ? fitRect(width, height, outputWidth / outputHeight, 'contain')
      : { width, height };
    const contentLeft = Number(rect.left || 0) + (width - content.width) / 2;
    const contentTop = Number(rect.top || 0) + (height - content.height) / 2;
    const rawX = (Number(clientX) - contentLeft) / content.width;
    const rawY = (Number(clientY) - contentTop) / content.height;
    const clamp = pointer.clamp !== false;
    const normalizedX = clamp ? Math.max(0, Math.min(1, rawX)) : rawX;
    const normalizedY = clamp ? Math.max(0, Math.min(1, rawY)) : rawY;
    return Object.freeze({
      x: normalizedX * outputWidth,
      y: normalizedY * outputHeight,
      normalizedX,
      normalizedY,
      inside: rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1,
      targetWidth: outputWidth,
      targetHeight: outputHeight,
      clientRect: Object.freeze({ left: contentLeft, top: contentTop, width: content.width, height: content.height }),
      surfaceRect: Object.freeze({ left: Number(rect.left || 0), top: Number(rect.top || 0), width, height })
    });
  }

  const DISPLAY_MODES = Object.freeze({
    FOUR_THREE: '4:3',
    SIXTEEN_NINE: '16:9',
    DYNAMIC: 'dynamic'
  });

  const ENGINE_STATES = Object.freeze({
    PROVISIONING: 'provisioning',
    LAUNCHER: 'launcher',
    LOADING: 'loading',
    MENU: 'menu',
    GAMEPLAY: 'gameplay',
    PAUSED: 'paused',
    DEBRIEF: 'debrief',
    CRASHED: 'crashed'
  });

  function validateAdapterContract(gameConfig, adapter) {
    const config = gameConfig || {};
    const seam = adapter || {};
    const errors = [];
    const requireMethod = (name, reason) => {
      if (typeof seam[name] !== 'function') errors.push(`${name}() is required ${reason}.`);
    };

    requireMethod('start', 'to start the native runtime');
    if (config.nativeManaged === true) {
      requireMethod('resize', 'when nativeManaged is enabled');
    }
    if (config.pointerWidth != null || config.pointerHeight != null || config.pointerFit != null) {
      requireMethod('pointerMove', 'when native menu pointer coordinates are declared');
      requireMethod('pointerButton', 'when native menu pointer coordinates are declared');
    }
    if (config.pointerLock !== false) {
      requireMethod('readEngineState', 'when gameplay pointer capture is enabled');
      requireMethod('captureLost', 'so Escape and pointer-lock loss return control to the native menu');
    }

    if (errors.length) {
      throw new Error(`Game adapter contract failed:\n- ${errors.join('\n- ')}`);
    }
    return Object.freeze({
      valid: true,
      nativeResize: config.nativeManaged === true,
      absolutePointer: config.pointerWidth != null || config.pointerHeight != null || config.pointerFit != null,
      pointerCapture: config.pointerLock !== false
    });
  }

  function normalizeDisplayMode(value) {
    const mode = String(value || '').toLowerCase();
    if (mode === '4:3' || mode === '4x3' || mode === 'four-three') return DISPLAY_MODES.FOUR_THREE;
    if (mode === '16:9' || mode === '16x9' || mode === 'sixteen-nine') return DISPLAY_MODES.SIXTEEN_NINE;
    if (mode === 'dynamic' || mode === 'viewport' || mode === 'full') return DISPLAY_MODES.DYNAMIC;
    return null;
  }

  function resolveDisplayRect(viewWidth, viewHeight, mode, options) {
    const width = Math.max(1, positive(viewWidth, 1));
    const height = Math.max(1, positive(viewHeight, 1));
    const displayMode = normalizeDisplayMode(mode) || DISPLAY_MODES.FOUR_THREE;
    const config = options || {};
    if (displayMode === DISPLAY_MODES.FOUR_THREE) {
      return Object.freeze({ ...fitRect(width, height, 4 / 3, 'contain'), displayMode, nativeSynchronized: true });
    }
    if (displayMode === DISPLAY_MODES.SIXTEEN_NINE) {
      return Object.freeze({ ...fitRect(width, height, 16 / 9, 'contain'), displayMode, nativeSynchronized: true });
    }

    const bufferWidth = positive(config.bufferWidth, 0);
    const bufferHeight = positive(config.bufferHeight, 0);
    const nativeManaged = Boolean(config.nativeManaged);
    const requestedAspect = width / height;
    const bufferAspect = bufferWidth && bufferHeight ? bufferWidth / bufferHeight : 0;
    // Even a quarter-percent mismatch is visible on circles, faces, and HUD
    // elements. Allow only sub-pixel rounding noise by default.
    const tolerance = positive(config.aspectTolerance, 0.0005);
    const nativeSynchronized = !nativeManaged || !bufferAspect ||
      Math.abs(bufferAspect - requestedAspect) / requestedAspect <= tolerance;

    // A natively managed renderer may take a frame (or a vid_restart) to
    // allocate its requested backbuffer. Preserve the last valid native
    // aspect until that happens instead of stretching it across the viewport.
    const immediate = config.resizeTransition === 'immediate';
    const rect = nativeSynchronized || immediate ? { width, height } : fitRect(width, height, bufferAspect, 'contain');
    return Object.freeze({ ...rect, displayMode, nativeSynchronized });
  }

  function element(value, fallbackSelector) {
    if (value && typeof value !== 'string') return value;
    return document.querySelector(value || fallbackSelector);
  }

  function resolveDeployment(options) {
    const config = options || {};
    const variants = config.variants || {};
    const keys = Object.keys(variants);
    if (!keys.length) throw new Error('At least one game variant is required.');

    const selector = element(config.selector, null);
    const queryKey = config.queryKey || 'game';
    const params = new URLSearchParams(location.search);
    const injected = String(
      config.variant ||
      globalThis.WASM_GAME_VARIANT ||
      document.querySelector('meta[name="wasm-game-variant"]')?.content ||
      ''
    ).toLowerCase();
    const locked = injected && injected !== 'suite';
    const requested = locked ? injected : String(params.get(queryKey) || '').toLowerCase();
    const fallback = keys.includes(config.defaultVariant) ? config.defaultVariant : keys[0];
    const variant = keys.includes(requested) ? requested : fallback;

    if (locked && !keys.includes(injected)) {
      throw new Error(`Unknown locked game variant: ${injected}`);
    }
    if (selector) {
      selector.value = variant;
      const wrapper = selector.closest('[data-shell-variant], label');
      if (wrapper) wrapper.hidden = Boolean(locked);
    }
    document.documentElement.dataset.wasmGameMode = locked ? 'single' : 'suite';
    document.documentElement.dataset.wasmGameVariant = variant;

    return Object.freeze({
      mode: locked ? 'single' : 'suite',
      locked: Boolean(locked),
      variant,
      value: variants[variant],
      variants: Object.freeze({ ...variants })
    });
  }

  function detectCapabilities() {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let webgl = false;
    let webgl2 = false;
    try { webgl2 = Boolean(canvas?.getContext('webgl2')); } catch (_) {}
    try { webgl = webgl2 || Boolean(canvas?.getContext('webgl') || canvas?.getContext('experimental-webgl')); } catch (_) {}
    return Object.freeze({
      wasm: typeof WebAssembly === 'object',
      webgl,
      webgl2,
      audio: typeof AudioContext === 'function' || typeof webkitAudioContext === 'function',
      pointerLock: typeof document !== 'undefined' && 'pointerLockElement' in document,
      workers: typeof Worker === 'function',
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function' && Boolean(globalThis.crossOriginIsolated),
      indexedDb: Boolean(globalThis.indexedDB),
      persistentStorage: Boolean(globalThis.navigator?.storage?.persist),
      desktop: !globalThis.matchMedia?.('(pointer: coarse)').matches && positive(globalThis.screen?.width, 0) >= 900
    });
  }

  function createPreferences(options) {
    const config = options || {};
    const namespace = String(config.namespace || 'wasm-game').replace(/[^a-z0-9._-]/gi, '-');
    const storageKey = `wasm-game-preferences:${namespace}`;
    const fields = {
      playerName: element(config.playerName, '[data-shell-player-name]'),
      qualityProfile: element(config.qualityProfile, '[data-shell-quality-profile]'),
      targetFps: element(config.targetFps, '[data-shell-target-fps]'),
      dynamicQuality: element(config.dynamicQuality, '[data-shell-dynamic-quality]'),
      fullscreen: element(config.fullscreen, '[data-shell-launch-fullscreen]')
    };

    function values() {
      return Object.freeze({
        playerName: String(fields.playerName?.value || config.defaults?.playerName || 'Player').trim().slice(0, 32) || 'Player',
        qualityProfile: String(fields.qualityProfile?.value || config.defaults?.qualityProfile || 'default'),
        targetFps: Number(fields.targetFps?.value || config.defaults?.targetFps || 60),
        dynamicQuality: fields.dynamicQuality ? Boolean(fields.dynamicQuality.checked) : Boolean(config.defaults?.dynamicQuality),
        fullscreen: fields.fullscreen ? Boolean(fields.fullscreen.checked) : Boolean(config.defaults?.fullscreen)
      });
    }

    function save() {
      const current = values();
      try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch (_) {}
      config.onChange?.(current);
      return current;
    }

    function load() {
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
      const merged = { ...(config.defaults || {}), ...stored };
      if (fields.playerName && merged.playerName) fields.playerName.value = String(merged.playerName).slice(0, 32);
      if (fields.qualityProfile && merged.qualityProfile) fields.qualityProfile.value = String(merged.qualityProfile);
      if (fields.targetFps && merged.targetFps) fields.targetFps.value = String(merged.targetFps);
      if (fields.dynamicQuality && merged.dynamicQuality !== undefined) fields.dynamicQuality.checked = Boolean(merged.dynamicQuality);
      if (fields.fullscreen && merged.fullscreen !== undefined) fields.fullscreen.checked = Boolean(merged.fullscreen);
      return values();
    }

    for (const field of Object.values(fields).filter(Boolean)) field.addEventListener('change', save);
    load();
    return Object.freeze({ namespace, storageKey, fields: Object.freeze(fields), values, load, save });
  }

  function requireCapabilities(requirements) {
    const available = detectCapabilities();
    const requested = requirements || { wasm: true };
    const missing = Object.entries(requested)
      .filter(([name, required]) => Boolean(required) && !available[name])
      .map(([name]) => name);
    return Object.freeze({ supported: missing.length === 0, missing: Object.freeze(missing), available });
  }

  function createQualityController(options) {
    const config = options || {};
    const profiles = Array.from(config.profiles || []);
    if (!profiles.length) throw new Error('Dynamic quality needs at least one ordered profile.');
    let index = Math.max(0, Math.min(profiles.length - 1, Number(config.initialIndex) || 0));
    let targetFps = positive(config.targetFps, 60);
    let enabled = Boolean(config.enabled);
    let frame = 0;
    let last = 0;
    let samples = [];
    let lastChange = 0;
    const sampleCount = Math.max(30, Number(config.sampleCount) || 120);
    const cooldown = Math.max(1000, Number(config.cooldown) || 5000);

    function apply(reason) {
      config.apply?.(profiles[index], Object.freeze({ index, reason, targetFps }));
    }
    function tick(now) {
      if (last && now > last) samples.push(1000 / (now - last));
      last = now;
      if (samples.length >= sampleCount) {
        const sorted = samples.slice().sort((a, b) => a - b);
        const fps = sorted[Math.floor(sorted.length * 0.25)];
        samples = [];
        config.onSample?.({ fps, targetFps, profile: profiles[index], index });
        if (enabled && now - lastChange >= cooldown) {
          if (fps < targetFps * 0.88 && index < profiles.length - 1) {
            index += 1;
            lastChange = now;
            apply('performance');
          } else if (fps > targetFps * 1.08 && index > 0) {
            index -= 1;
            lastChange = now;
            apply('headroom');
          }
        }
      }
      frame = requestAnimationFrame(tick);
    }
    return Object.freeze({
      start() { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } },
      stop() { if (frame) cancelAnimationFrame(frame); frame = 0; samples = []; },
      setEnabled(value) { enabled = Boolean(value); },
      setTargetFps(value) { targetFps = positive(value, targetFps); },
      setProfile(next) {
        const nextIndex = typeof next === 'number' ? next : profiles.indexOf(next);
        if (nextIndex < 0 || nextIndex >= profiles.length) throw new Error(`Unknown quality profile: ${next}`);
        index = nextIndex;
        apply('manual');
      },
      state() { return Object.freeze({ enabled, targetFps, profile: profiles[index], index }); }
    });
  }

  function createPersistentFs(options) {
    const config = options || {};
    const FS = config.FS;
    const root = String(config.root || '/persistent').replace(/\/$/, '') || '/persistent';
    if (!FS) throw new Error('An Emscripten FS instance is required.');
    let initialized = false;
    let syncPending = null;
    function sync(populate) {
      if (syncPending) return syncPending;
      syncPending = new Promise((resolve, reject) => {
        FS.syncfs(Boolean(populate), error => error ? reject(error) : resolve());
      }).finally(() => { syncPending = null; });
      return syncPending;
    }
    async function initialize() {
      if (initialized) return true;
      FS.mkdirTree?.(root);
      const idbfs = FS.filesystems?.IDBFS;
      if (!idbfs || typeof FS.mount !== 'function' || typeof FS.syncfs !== 'function') return false;
      try { FS.mount(idbfs, {}, root); } catch (error) {
        if (!/mounted|busy/i.test(String(error && error.message))) throw error;
      }
      await sync(true);
      initialized = true;
      return true;
    }
    return Object.freeze({ root, initialize, save: () => sync(false), reload: () => sync(true) });
  }

  function createDiagnostics(options) {
    const config = options || {};
    const lines = [];
    const limit = Math.max(50, Number(config.limit) || 1000);
    function write(level, value) {
      const line = Object.freeze({ at: Date.now(), level, message: String(value && value.stack || value) });
      lines.push(line);
      if (lines.length > limit) lines.splice(0, lines.length - limit);
      config.onLine?.(line);
      return line;
    }
    function onError(event) { config.onCrash?.(write('error', event.error || event.message)); }
    function onRejection(event) { config.onCrash?.(write('error', event.reason || 'Unhandled rejection')); }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return Object.freeze({
      log: value => write('log', value),
      warn: value => write('warn', value),
      error: value => write('error', value),
      lines: () => Object.freeze(lines.slice()),
      destroy() {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      }
    });
  }

  const memoryDataCaches = new Map();

  function createDataCache(options) {
    const config = options || {};
    const namespace = String(config.namespace || '').trim();
    const version = String(config.version || '1');
    if (!namespace || !/^[a-z0-9][a-z0-9._-]*$/i.test(namespace)) {
      throw new Error('Data cache namespace must use letters, numbers, dots, underscores, or dashes.');
    }

    const databaseName = `wasm-game-data:${namespace}`;
    const memory = memoryDataCaches.get(databaseName) || new Map();
    const inflight = new Map();
    memoryDataCaches.set(databaseName, memory);
    let databasePromise;

    function openDatabase() {
      if (!globalThis.indexedDB) return Promise.resolve(null);
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Could not open ${databaseName}.`));
        request.onblocked = () => reject(new Error(`Opening ${databaseName} was blocked by another tab.`));
      });
      return databasePromise;
    }

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
      });
    }

    async function transaction(mode, operation) {
      const db = await openDatabase();
      if (!db) return operation(null);
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', mode);
        const store = tx.objectStore('files');
        let result;
        try {
          result = operation(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = async () => resolve(await result);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction was aborted.'));
      });
    }

    function normalizedKey(key) {
      const value = String(key || '').trim().toLowerCase();
      if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
        throw new Error(`Invalid owner-data cache key: ${key}`);
      }
      return value;
    }

    function asFile(record) {
      const options = { type: record.type || record.blob.type || '', lastModified: record.lastModified || 0 };
      if (typeof File === 'function') return new File([record.blob], record.name || record.key, options);
      const blob = record.blob.slice(0, record.blob.size, options.type);
      Object.defineProperty(blob, 'name', { value: record.name || record.key });
      return blob;
    }

    async function get(key) {
      const normalized = normalizedKey(key);
      let record;
      if (!globalThis.indexedDB) {
        record = memory.get(normalized);
      } else {
        record = await transaction('readonly', store => requestResult(store.get(normalized)));
      }
      if (!record) return null;
      if (record.version !== version || !(record.blob instanceof Blob)) {
        await remove(normalized);
        return null;
      }
      return Object.freeze({
        key: normalized,
        file: asFile(record),
        metadata: Object.freeze({ ...(record.metadata || {}) }),
        storedAt: record.storedAt,
        cached: true
      });
    }

    async function put(key, value, metadata) {
      const normalized = normalizedKey(key);
      const source = value && value.file ? value.file : value;
      const blob = source instanceof Blob ? source : new Blob([source]);
      const record = {
        key: normalized,
        version,
        blob,
        name: source && source.name ? String(source.name) : normalized,
        type: source && source.type ? String(source.type) : blob.type,
        lastModified: Number(source && source.lastModified) || 0,
        storedAt: Date.now(),
        metadata: { ...(metadata || {}) }
      };
      if (!globalThis.indexedDB) {
        memory.set(normalized, record);
      } else {
        await transaction('readwrite', store => requestResult(store.put(record)));
      }
      return Object.freeze({
        key: normalized,
        file: asFile(record),
        metadata: Object.freeze({ ...record.metadata }),
        storedAt: record.storedAt,
        cached: false
      });
    }

    async function remove(key) {
      const normalized = normalizedKey(key);
      memory.delete(normalized);
      if (globalThis.indexedDB) {
        await transaction('readwrite', store => requestResult(store.delete(normalized)));
      }
    }

    async function clear() {
      memory.clear();
      if (globalThis.indexedDB) {
        await transaction('readwrite', store => requestResult(store.clear()));
      }
    }

    async function getOrLoad(options) {
      const request = options || {};
      const key = normalizedKey(request.key);
      let cached = await get(key);
      if (cached) {
        try {
          if (typeof request.validateCached === 'function') {
            await request.validateCached(cached.file, cached.metadata);
          }
          return cached;
        } catch (error) {
          await remove(key);
          cached = null;
          console.warn(`[WASM data cache] discarded invalid cached ${key}:`, error);
        }
      }
      if (inflight.has(key)) return inflight.get(key);
      if (typeof request.load !== 'function') throw new Error(`No loader was supplied for ${key}.`);

      const pending = (async () => {
        const loaded = await request.load();
        const source = loaded && loaded.file ? loaded.file : loaded;
        const validation = typeof request.validate === 'function' ? await request.validate(source) : null;
        try {
          return await put(key, source, {
            ...(request.metadata || {}),
            ...((loaded && loaded.metadata) || {}),
            ...(validation ? { dataValidation: validation } : {})
          });
        } catch (error) {
          console.warn(`[WASM data cache] ${key} could not be persisted:`, error);
          const blob = source instanceof Blob ? source : new Blob([source]);
          return Object.freeze({ key, file: source, metadata: Object.freeze({}), storedAt: 0, cached: false, blob });
        }
      })();
      inflight.set(key, pending);
      try {
        return await pending;
      } finally {
        inflight.delete(key);
      }
    }

    async function persist() {
      const storage = globalThis.navigator && globalThis.navigator.storage;
      if (!storage) return { persisted: false, estimate: null };
      let persisted = await storage.persisted?.() || false;
      if (!persisted && storage.persist) {
        try { persisted = await storage.persist(); } catch (_) {}
      }
      let estimate = null;
      try { estimate = await storage.estimate?.() || null; } catch (_) {}
      return { persisted, estimate };
    }

    return Object.freeze({ namespace, version, get, put, remove, clear, getOrLoad, persist });
  }

  function normalizeOwnerName(value) {
    const name = String(value || '').trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
    if (!name || name === '.' || name === '..') throw new Error(`Invalid owner-data filename: ${value}`);
    return name;
  }

  function byteSequence(value) {
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value)) return Uint8Array.from(value);
    if (typeof value === 'string') return Uint8Array.from(value, character => character.charCodeAt(0) & 255);
    throw new Error('Owner-data magic must be a string, byte array, or Uint8Array.');
  }

  function deepFreezeJson(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const item of Object.values(value)) deepFreezeJson(item);
      Object.freeze(value);
    }
    return value;
  }

  function jsonPolicy(value) {
    if (value === undefined) return Object.freeze({});
    let encoded;
    try { encoded = JSON.stringify(value); } catch (_) { throw new Error('Data-validator policy must be JSON-serializable.'); }
    if (encoded === undefined || encoded.length > 65536) {
      throw new Error('Data-validator policy must be JSON-serializable and no larger than 64 KiB.');
    }
    const decoded = JSON.parse(encoded);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Data-validator policy must be a JSON object.');
    }
    return deepFreezeJson(decoded);
  }

  function normalizeDataValidatorDeclaration(value) {
    if (value === undefined || value === null || value === false) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Data validator must be an object.');
    }
    const module = String(value.module || '');
    if (!module.startsWith('/') || module.includes('\\') || module.includes('\0') || /[?#]/.test(module)) {
      throw new Error('Data-validator module must be an absolute same-origin path.');
    }
    const segments = module.split('/').slice(1);
    if (!segments.length || segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..') ||
        !module.endsWith('.mjs')) {
      throw new Error('Data-validator module must name a traversal-safe .mjs file.');
    }
    const exportName = String(value.export || 'default');
    if (exportName !== 'default' && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
      throw new Error('Data-validator export must be default or a JavaScript identifier.');
    }
    const version = String(value.version || '1');
    if (!version || version.length > 128 || /[\u0000-\u001f]/.test(version)) {
      throw new Error('Data-validator version must be a non-empty string no longer than 128 characters.');
    }
    const maxReadBytes = value.maxReadBytes === undefined ? 4 * 1024 * 1024 : Number(value.maxReadBytes);
    const maxTotalReadBytes = value.maxTotalReadBytes === undefined || value.maxTotalReadBytes === null
      ? null : Number(value.maxTotalReadBytes);
    if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 512 * 1024 * 1024) {
      throw new Error('Data-validator maxReadBytes must be an integer from 1 byte through 512 MiB.');
    }
    if (maxTotalReadBytes !== null &&
        (!Number.isSafeInteger(maxTotalReadBytes) || maxTotalReadBytes < 0 || maxTotalReadBytes > 32 * 1024 * 1024 * 1024)) {
      throw new Error('Data-validator maxTotalReadBytes must be an integer from 0 bytes through 32 GiB.');
    }
    return Object.freeze({
      module,
      export: exportName,
      version,
      policy: jsonPolicy(value.policy),
      maxReadBytes,
      maxTotalReadBytes
    });
  }

  function dataValidatorCacheTag(value) {
    const rule = normalizeDataValidatorDeclaration(value);
    return rule ? JSON.stringify({
      module: rule.module,
      export: rule.export,
      version: rule.version,
      policy: rule.policy,
      maxReadBytes: rule.maxReadBytes,
      maxTotalReadBytes: rule.maxTotalReadBytes
    }) : '';
  }

  function validationText(value, field, maximum) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value);
    if (text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
      throw new Error(`Data-validator ${field} is invalid.`);
    }
    return text;
  }

  function normalizeDataValidatorResult(value) {
    if (!value || typeof value !== 'object' || typeof value.accepted !== 'boolean') {
      throw new Error('Data validator must return an object with an accepted boolean.');
    }
    const error = validationText(value.error, 'error', 1024);
    if (!value.accepted && !error) throw new Error('A rejected data-validator result must include an error.');
    let metadata = null;
    if (value.metadata !== undefined && value.metadata !== null) {
      let encoded;
      try { encoded = JSON.stringify(value.metadata); } catch (_) { throw new Error('Data-validator metadata must be JSON-serializable.'); }
      if (encoded === undefined || encoded.length > 16384) {
        throw new Error('Data-validator metadata must be JSON-serializable and no larger than 16 KiB.');
      }
      metadata = deepFreezeJson(JSON.parse(encoded));
    }
    return Object.freeze({
      accepted: value.accepted,
      error: value.accepted ? null : error,
      identity: validationText(value.identity, 'identity', 256),
      version: validationText(value.version, 'version', 256),
      fingerprint: validationText(value.fingerprint, 'fingerprint', 512),
      metadata
    });
  }

  function createBoundedDataReader(source, declaration) {
    const rule = normalizeDataValidatorDeclaration(declaration);
    if (!rule) throw new Error('A data-validator declaration is required.');
    const size = Number(source && source.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Data-validator source size is invalid.');
    const sourceRead = typeof Blob !== 'undefined' && source instanceof Blob
      ? async (offset, length) => new Uint8Array(await source.slice(offset, offset + length).arrayBuffer())
      : source && typeof source.read === 'function'
        ? source.read.bind(source)
        : null;
    if (!sourceRead) throw new Error('Data-validator source must be a Blob or provide read(offset, length).');
    const totalLimit = rule.maxTotalReadBytes === null ? size : rule.maxTotalReadBytes;
    let bytesRead = 0;
    let readCalls = 0;
    const digests = new Map();
    async function read(offset, length) {
      const start = Number(offset);
      const count = Number(length);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0) {
        throw new Error('Data-validator reads require non-negative integer offsets and lengths.');
      }
      if (count > rule.maxReadBytes) {
        throw new Error(`Data-validator read exceeds the per-call limit of ${rule.maxReadBytes} bytes.`);
      }
      if (start > size || count > size - start) throw new Error('Data-validator read extends beyond the end of the file.');
      if (count > totalLimit - bytesRead) {
        throw new Error(`Data-validator reads exceed the total limit of ${totalLimit} bytes.`);
      }
      const value = await sourceRead(start, count);
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (bytes.byteLength !== count) throw new Error('Data-validator source returned a truncated read.');
      bytesRead += count;
      readCalls += 1;
      return bytes;
    }
    function digestName(value) {
      const requested = String(value || '').toUpperCase().replace(/_/g, '-');
      const name = requested === 'SHA256' ? 'SHA-256' : requested === 'SHA384' ? 'SHA-384' :
        requested === 'SHA512' ? 'SHA-512' : requested;
      if (!['SHA-256', 'SHA-384', 'SHA-512'].includes(name)) {
        throw new Error(`Data-validator digest algorithm ${value} is not supported.`);
      }
      return name;
    }
    async function digest(algorithm) {
      const name = digestName(algorithm);
      if (!digests.has(name)) {
        digests.set(name, (async () => {
          if (source && typeof source.digest === 'function') return String(await source.digest(name)).toLowerCase();
          if (typeof Blob === 'undefined' || !(source instanceof Blob) || !globalThis.crypto?.subtle) {
            throw new Error(`Data-validator ${name} digest is unavailable in this environment.`);
          }
          const bytes = await globalThis.crypto.subtle.digest(name, await source.arrayBuffer());
          return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
        })());
      }
      return digests.get(name);
    }
    return Object.freeze({ size, read, digest, stats: () => Object.freeze({ bytesRead, readCalls }) });
  }

  async function loadBrowserDataValidator(modulePath) {
    if (typeof location === 'undefined') throw new Error('Browser location is unavailable for the data-validator module.');
    const url = new URL(modulePath, location.href);
    if (url.origin !== location.origin) throw new Error('Data-validator module must use the current origin.');
    return import(url.href);
  }

  const dataValidatorModuleCaches = new WeakMap();

  function cachedValidatorModule(loadModule, modulePath) {
    let modules = dataValidatorModuleCaches.get(loadModule);
    if (!modules) {
      modules = new Map();
      dataValidatorModuleCaches.set(loadModule, modules);
    }
    if (!modules.has(modulePath)) {
      const pending = Promise.resolve().then(() => loadModule(modulePath));
      modules.set(modulePath, pending);
      pending.catch(() => modules.delete(modulePath));
    }
    return modules.get(modulePath);
  }

  async function runDataValidator(source, declaration, options) {
    const rule = normalizeDataValidatorDeclaration(declaration);
    if (!rule) return null;
    const config = options || {};
    const loadModule = config.loadModule || loadBrowserDataValidator;
    let module;
    try { module = await cachedValidatorModule(loadModule, rule.module); } catch (_) {
      throw new Error(`Data-validator module ${rule.module} could not be loaded.`);
    }
    const validate = module && module[rule.export];
    if (typeof validate !== 'function') {
      throw new Error(`Data-validator module ${rule.module} does not export ${rule.export}().`);
    }
    const reader = createBoundedDataReader(source, rule);
    let value;
    try {
      value = await validate(Object.freeze({
        name: String(config.name || source.name || ''),
        size: reader.size,
        policy: rule.policy,
        read: reader.read,
        digest: reader.digest
      }));
    } catch (error) {
      const message = String(error && error.message || 'validator execution failed')
        .replace(/[\u0000-\u001f]+/g, ' ').slice(0, 1024);
      throw new Error(`Data validator failed: ${message || 'validator execution failed'}.`);
    }
    const result = normalizeDataValidatorResult(value);
    return Object.freeze({
      ...result,
      ...reader.stats(),
      module: rule.module,
      export: rule.export,
      validatorVersion: rule.version,
      policy: rule.policy
    });
  }

  const ownerFileValidationResults = new WeakMap();

  function ownerFileValidation(file) {
    return file && ownerFileValidationResults.get(file) || null;
  }

  async function browserBlobDigest(file, algorithm) {
    if (!globalThis.crypto?.subtle) throw new Error(`${algorithm} validation is unavailable in this browser.`);
    const bytes = await globalThis.crypto.subtle.digest(algorithm, await file.arrayBuffer());
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function validateOwnerFile(file, policy, onProgress, validationOptions) {
    const rule = policy || {};
    if (!(file instanceof Blob)) throw new Error(`${rule.key || 'Owner data'} is not a browser File or Blob.`);

    const allowedNames = (rule.names || [rule.name || rule.key]).filter(Boolean).map(normalizeOwnerName);
    const actualName = normalizeOwnerName(file.name || rule.name || rule.key);
    if (allowedNames.length && !allowedNames.includes(actualName)) {
      throw new Error(`Expected ${allowedNames.join(' or ')}, received ${actualName}.`);
    }

    const allowedSizes = Array.isArray(rule.sizes) ? rule.sizes.map(Number) :
      rule.size !== undefined ? [Number(rule.size)] : [];
    if (allowedSizes.length && !allowedSizes.includes(file.size)) {
      throw new Error(`${actualName} is ${file.size} bytes; expected ${allowedSizes.join(' or ')}.`);
    }
    if (rule.minSize !== undefined && file.size < Number(rule.minSize)) {
      throw new Error(`${actualName} is smaller than ${rule.minSize} bytes.`);
    }
    if (rule.maxSize !== undefined && file.size > Number(rule.maxSize)) {
      throw new Error(`${actualName} is larger than ${rule.maxSize} bytes.`);
    }

    const magics = rule.magic === undefined ? [] :
      Array.isArray(rule.magic) && rule.magic.length && typeof rule.magic[0] === 'object' &&
        !(rule.magic[0] instanceof Number) ? rule.magic : [rule.magic];
    for (const specification of magics) {
      const offset = Number(specification && specification.bytes !== undefined ? specification.offset || 0 : 0);
      const expected = byteSequence(specification && specification.bytes !== undefined ? specification.bytes : specification);
      const actual = new Uint8Array(await file.slice(offset, offset + expected.length).arrayBuffer());
      if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
        throw new Error(`${actualName} does not have the expected file signature at byte ${offset}.`);
      }
    }

    const allowedSha256 = (rule.sha256 ? (Array.isArray(rule.sha256) ? rule.sha256 : [rule.sha256]) : [])
      .map(value => String(value).toLowerCase());
    if (allowedSha256.some(value => !/^[a-f0-9]{64}$/.test(value))) {
      throw new Error(`Invalid SHA-256 policy for ${rule.key || actualName}.`);
    }
    if (allowedSha256.length) {
      const digest = await browserBlobDigest(file, 'SHA-256');
      if (!allowedSha256.includes(digest)) throw new Error(`${actualName} has an unrecognized SHA-256 digest.`);
    }

    if (rule.validator) {
      const result = await runDataValidator(file, rule.validator, { ...(validationOptions || {}), name: actualName });
      if (!result.accepted) throw new Error(result.error);
      ownerFileValidationResults.set(file, result);
    } else ownerFileValidationResults.delete(file);

    if (typeof rule.validate === 'function') {
      await rule.validate(file, Object.freeze({ name: actualName, size: file.size, policy: rule, onProgress }));
    }
    if (typeof onProgress === 'function') onProgress({ phase: 'validated', key: rule.key, name: actualName, bytes: file.size });
    return file;
  }

  function createOwnerDataSet(options) {
    const config = options || {};
    const policies = (config.files || []).map((policy, index) => {
      const key = String(policy.key || policy.name || `file-${index}`).toLowerCase();
      let validator = policy.validator;
      if (validator !== false && config.validator) {
        const override = validator && typeof validator === 'object' ? validator : {};
        validator = {
          ...config.validator,
          ...override,
          policy: { ...(config.validator.policy || {}), ...(override.policy || {}) }
        };
      }
      validator = validator ? normalizeDataValidatorDeclaration(validator) : null;
      const sizes = Array.isArray(policy.sizes) ? policy.sizes : policy.size === undefined ? [] : [policy.size];
      if (validator && !sizes.length && policy.maxSize === undefined) {
        throw new Error(`Data validator for ${key} requires sizes or maxSize as an upload envelope.`);
      }
      return Object.freeze({ ...policy, validator, key, cacheKey: String(policy.cacheKey || key).toLowerCase() });
    });
    if (!policies.length) throw new Error('An owner-data set needs at least one file policy.');
    const validatorTags = policies.filter(policy => policy.validator).map(policy => `${policy.key}:${dataValidatorCacheTag(policy.validator)}`);
    const cacheVersion = validatorTags.length ? `${String(config.version || '1')}:validators:${validatorTags.join('|')}` : config.version;
    const cache = config.cache || createDataCache({ namespace: config.namespace, version: cacheVersion });

    function indexSources(source) {
      if (!source || typeof source === 'function' || typeof source.getFileHandle === 'function') return source;
      const entries = source instanceof Map ? Array.from(source.entries()) :
        Array.isArray(source) || typeof source.length === 'number' ? Array.from(source).map(file => [file.name, file]) :
        Object.entries(source);
      const indexed = new Map();
      for (const [name, file] of entries) {
        if (file instanceof Blob) indexed.set(normalizeOwnerName(name || file.name), file);
      }
      return indexed;
    }

    async function sourceFile(source, policy) {
      function missing() {
        const error = new Error(`Required owner file ${policy.name || policy.key} was not provided.`);
        error.code = 'OWNER_DATA_MISSING';
        throw error;
      }
      if (typeof source === 'function') return source(policy);
      if (source && typeof source.getFileHandle === 'function') {
        let lastError;
        for (const name of policy.names || [policy.name || policy.key]) {
          try { return await (await source.getFileHandle(name)).getFile(); } catch (error) { lastError = error; }
        }
        if (lastError && policy.required !== false) throw lastError;
        return missing();
      }
      if (source instanceof Map) {
        for (const name of policy.names || [policy.name || policy.key]) {
          const match = source.get(normalizeOwnerName(name));
          if (match) return match;
        }
      }
      return missing();
    }

    async function load(source, loadOptions) {
      const request = loadOptions || {};
      const validationOptions = request.validationOptions || config.validationOptions;
      const indexed = indexSources(source);
      const entries = [];
      for (let index = 0; index < policies.length; index += 1) {
        const policy = policies[index];
        const progress = detail => request.onProgress?.({ ...detail, index, total: policies.length });
        progress({ phase: 'checking-cache', key: policy.key });
        try {
          const cachedPolicy = policy.validateCached === false ?
            { ...policy, validate: undefined, validator: null, sha256: undefined } :
            typeof policy.validateCached === 'function' ? { ...policy, validate: policy.validateCached } : policy;
          const entry = await cache.getOrLoad({
            key: policy.cacheKey,
            load: () => sourceFile(indexed, policy),
            validate: async file => {
              await validateOwnerFile(file, policy, progress, validationOptions);
              return ownerFileValidation(file);
            },
            validateCached: async file => {
              await validateOwnerFile(file, cachedPolicy, progress, validationOptions);
              return ownerFileValidation(file);
            },
            metadata: { policyKey: policy.key }
          });
          entries.push(Object.freeze({ ...entry, policy, mountName: policy.mountName || policy.name || entry.file.name }));
          progress({ phase: entry.cached ? 'restored' : 'cached', key: policy.key, bytes: entry.file.size });
        } catch (error) {
          if (policy.required === false && error && error.code === 'OWNER_DATA_MISSING') continue;
          throw error;
        }
      }
      if (request.persist !== false) await cache.persist();
      return Object.freeze({ cache, policies: Object.freeze(policies.slice()), entries: Object.freeze(entries) });
    }

    return Object.freeze({ cache, policies: Object.freeze(policies.slice()), load, clear: cache.clear, persist: cache.persist });
  }

  async function mountOwnerFiles(target, dataSet, options) {
    const config = options || {};
    const FS = target && target.FS ? target.FS : target;
    if (!FS) throw new Error('An Emscripten FS instance is required to mount owner data.');
    const root = String(config.root || '/owner-data').replace(/\/$/, '') || '/owner-data';
    /* Arrays have a built-in `entries()` iterator method. Treat only an
     * actual array-valued `.entries` property as an owner-data-set wrapper;
     * otherwise an entry array must remain the entry array. */
    const sourceEntries = dataSet && Array.isArray(dataSet.entries) ? dataSet.entries : dataSet;
    const entries = Array.from(sourceEntries || []);
    function relativeMountPath(entry, file) {
      const requested = String(entry.mountName || file.name || '').replace(/\\/g, '/');
      if (!config.preservePaths) return requested.replace(/^.*\//, '');
      if (!requested || requested.startsWith('/') || requested.includes('\0')) {
        throw new Error(`Invalid owner-data mount path: ${requested}`);
      }
      const segments = requested.split('/');
      if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Invalid owner-data mount path: ${requested}`);
      }
      return segments.join('/');
    }
    const mountPaths = entries.map(entry => relativeMountPath(entry, entry.file || entry));
    const files = entries.map((entry, index) => {
      const file = entry.file || entry;
      const name = mountPaths[index];
      return typeof File === 'function' && file.name !== name ?
        new File([file], name, { type: file.type, lastModified: file.lastModified || 0 }) : file;
    });
    function ensureDirectory(directory) {
      if (typeof FS.mkdirTree === 'function') {
        FS.mkdirTree(directory);
        return;
      }
      if (typeof FS.createPath === 'function') {
        let parent = '/';
        for (const segment of String(directory).split('/').filter(Boolean)) {
          try { FS.createPath(parent, segment, true, true); } catch (error) {
            // Historical Emscripten releases may throw EEXIST instead of
            // treating createPath as idempotent. Only suppress that case when
            // the resulting path is actually present.
            const current = `${parent === '/' ? '' : parent}/${segment}` || '/';
            try { FS.stat(current); } catch (_) { throw error; }
          }
          parent = `${parent === '/' ? '' : parent}/${segment}` || '/';
        }
        return;
      }
      throw new Error(`This Emscripten filesystem cannot create ${directory}.`);
    }
    function existingSize(path) {
      if (config.reuseExisting === false || typeof FS.stat !== 'function') return null;
      try {
        const stat = FS.stat(path);
        return Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : null;
      } catch (_) { return null; }
    }
    ensureDirectory(root);

    const workerFs = FS.filesystems && FS.filesystems.WORKERFS;
    if (!config.preservePaths && config.mode !== 'memfs' && workerFs && typeof FS.mount === 'function' && files.every(file => file instanceof Blob)) {
      FS.mount(workerFs, { files }, root);
      config.onProgress?.({ phase: 'mounted', mode: 'workerfs', files: files.length });
      return Object.freeze({ root, mode: 'workerfs', files: Object.freeze(files.slice()) });
    }

    const chunkBytes = Math.max(64 * 1024, Number(config.chunkBytes) || 16 * 1024 * 1024);
    let copied = 0;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = mountPaths[index];
      const path = `${root}/${name}`;
      if (config.preservePaths && name.includes('/')) {
        ensureDirectory(path.slice(0, path.lastIndexOf('/')));
      }
      const size = existingSize(path);
      if (size === file.size) {
        copied += file.size;
        try { FS.chmod(path, 0o444); } catch (_) {}
        config.onProgress?.({ phase: 'mounting', mode: 'memfs', path, copied, total, reused: true });
        continue;
      }
      if (size !== null && typeof FS.unlink === 'function') {
        try { FS.chmod(path, 0o666); } catch (_) {}
        FS.unlink(path);
      }
      const stream = FS.open(path, 'w');
      try {
        const legacyContents = stream.node && Array.isArray(stream.node.contents) &&
          stream.node.contentMode !== undefined ? new Uint8Array(file.size) : null;
        // Old Emscripten MEMFS implementations geometrically grow their byte
        // arrays. A large PAK can otherwise briefly require more than twice
        // its real size and fail before the engine starts. Preallocate the
        // exact final length when the runtime exposes either API.
        if (!legacyContents && config.preallocate !== false) try {
          if (typeof FS.ftruncate === 'function' && stream.fd !== undefined) FS.ftruncate(stream.fd, file.size);
          else if (typeof FS.truncate === 'function') FS.truncate(path, file.size);
        } catch (_) {}
        for (let offset = 0; offset < file.size; offset += chunkBytes) {
          const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + chunkBytes)).arrayBuffer());
          if (legacyContents) legacyContents.set(bytes, offset);
          else FS.write(stream, bytes, 0, bytes.length, offset);
          copied += bytes.length;
          config.onProgress?.({ phase: 'mounting', mode: 'memfs', path, copied, total });
        }
        if (legacyContents) {
          stream.node.contents = legacyContents;
          // Historical Emscripten MEMFS uses 3 for CONTENT_FIXED. Keep its
          // read path typed and prevent a later conversion back to an Array.
          stream.node.contentMode = 3;
        }
      } finally {
        FS.close(stream);
      }
      try { FS.chmod(path, 0o444); } catch (_) {}
    }
    config.onProgress?.({ phase: 'mounted', mode: 'memfs', files: files.length, copied, total });
    return Object.freeze({ root, mode: 'memfs', files: Object.freeze(files.slice()) });
  }

  function createWakeClient(options) {
    const config = options || {};
    const statusUrl = config.statusUrl || '/status';
    const wakeUrl = config.wakeUrl || '/wake';
    const interval = Math.max(100, Number(config.interval) || 500);
    const timeout = Math.max(interval, Number(config.timeout) || 45000);
    let pending;

    async function readStatus() {
      const response = await fetch(statusUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Server status failed with HTTP ${response.status}.`);
      return response.json();
    }

    async function ensureRunning(metadata) {
      if (pending) return pending;
      pending = (async () => {
        let status;
        try { status = await readStatus(); } catch (_) { status = null; }
        config.onStatus?.(status || { state: 'unknown' });
        if (!status || !['running', 'ready'].includes(status.state)) {
          const response = await fetch(wakeUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(metadata || {})
          });
          if (!response.ok) throw new Error(`Server wake failed with HTTP ${response.status}.`);
          try { status = await response.json(); } catch (_) { status = { state: 'starting' }; }
          config.onStatus?.(status);
        }
        const deadline = Date.now() + timeout;
        while (!status || !['running', 'ready'].includes(status.state)) {
          if (Date.now() >= deadline) throw new Error('The game server did not become ready in time.');
          await new Promise(resolve => setTimeout(resolve, interval));
          status = await readStatus();
          config.onStatus?.(status);
          if (status.state === 'failed') throw new Error(status.error || 'The game server failed to start.');
        }
        return status;
      })();
      try { return await pending; } finally { pending = null; }
    }

    return Object.freeze({ readStatus, ensureRunning });
  }

  function createContainerDataClient(options) {
    const config = options || {};
    const baseUrl = String(config.baseUrl || '/game-data').replace(/\/$/, '');
    const variant = String(config.variant || '').toLowerCase();
    const tokenField = () => element(config.token, '[data-shell-setup-token]');

    function endpoint(suffix) {
      const url = new URL(`${baseUrl}${suffix}`, location.href);
      if (variant) url.searchParams.set('variant', variant);
      return url.href;
    }

    async function readJson(response, fallback) {
      try { return await response.json(); } catch (_) { return fallback; }
    }

    async function status() {
      const response = await fetch(endpoint('/status'), {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`Game-data status failed with HTTP ${response.status}.`);
      return Object.freeze(await response.json());
    }

    function sourceFiles(source) {
      if (source instanceof Map) return Array.from(source.entries()).map(([name, file]) => ({ name: String(name), file }));
      if (source && typeof source.getFileHandle === 'function') return [];
      return Array.from(source || []).map(file => ({ name: String(file.webkitRelativePath || file.name), file }));
    }

    async function selectSource(source, values, policy) {
      if (source && typeof source.getFileHandle === 'function') {
        for (const name of policy.names || [policy.name]) {
          try { return await (await source.getFileHandle(name)).getFile(); } catch (_) {}
        }
      }
      const wantedPath = String(policy.path || '').toLowerCase().replace(/\\/g, '/');
      if (wantedPath) {
        const pathMatch = values.find(entry => {
          const actual = entry.name.toLowerCase().replace(/\\/g, '/');
          return actual === wantedPath || actual.endsWith(`/${wantedPath}`);
        });
        if (pathMatch) return pathMatch.file;
      }
      const wantedNames = (policy.names || [policy.name]).map(normalizeOwnerName);
      return values.find(entry => wantedNames.includes(normalizeOwnerName(entry.name)))?.file || null;
    }

    async function provision(source, provisionOptions) {
      const request = provisionOptions || {};
      const before = await status();
      if (before.ready && request.includeOptional !== true) return before;
      if (!before.configured) throw new Error('This container has no owner-data policy.');
      const values = sourceFiles(source);
      for (let index = 0; index < before.files.length; index += 1) {
        const policy = before.files[index];
        if (policy.valid) continue;
        const file = await selectSource(source, values, policy);
        if (!(file instanceof Blob)) {
          if (policy.required === false) continue;
          throw new Error(`Select ${policy.path || policy.name} to finish game-data setup.`);
        }
        request.onProgress?.({ phase: 'uploading', key: policy.key, index, total: before.files.length, bytes: file.size });
        const headers = {};
        const token = request.token || tokenField()?.value;
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetch(endpoint(`/setup/${encodeURIComponent(policy.key)}`), {
          method: 'PUT',
          credentials: 'same-origin',
          headers,
          body: file
        });
        if (!response.ok) {
          const result = await readJson(response, {});
          throw new Error(result.error || `Uploading ${policy.name} failed with HTTP ${response.status}.`);
        }
        request.onProgress?.({ phase: 'uploaded', key: policy.key, index, total: before.files.length, bytes: file.size });
      }
      const after = await status();
      if (!after.ready) throw new Error('The container rejected one or more required game-data files.');
      return after;
    }

    async function load(dataSet, loadOptions) {
      if (!dataSet || typeof dataSet.load !== 'function') throw new Error('A framework owner-data set is required.');
      const request = loadOptions || {};
      const state = await status();
      if (!state.ready) {
        const error = new Error('The container still needs its required game data.');
        error.code = 'CONTAINER_DATA_REQUIRED';
        error.status = state;
        throw error;
      }
      const files = new Map(state.files.map(file => [String(file.key).toLowerCase(), file]));
      return dataSet.load(async policy => {
        const remote = files.get(String(policy.key).toLowerCase());
        if (!remote) throw new Error(`The container does not expose ${policy.key}.`);
        if (!remote.valid) {
          const error = new Error(`${remote.name || policy.name || policy.key} is not installed in this container.`);
          error.code = 'OWNER_DATA_MISSING';
          throw error;
        }
        const response = await fetch(endpoint(`/files/${encodeURIComponent(remote.key)}`), {
          cache: 'no-store',
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error(`Downloading ${remote.name} failed with HTTP ${response.status}.`);
        const total = Number(response.headers.get('content-length')) || 0;
        let blob;
        if (response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          const chunks = [];
          let received = 0;
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            chunks.push(part.value);
            received += part.value.byteLength;
            request.onProgress?.({ phase: 'downloading', key: remote.key, received, total });
          }
          blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
        } else blob = await response.blob();
        return typeof File === 'function' ? new File([blob], remote.name, { type: blob.type }) :
          Object.defineProperty(blob, 'name', { value: remote.name });
      }, request);
    }

    async function applyGate(gateOptions) {
      const request = gateOptions || {};
      const state = await status();
      const provisioning = Array.from(document.querySelectorAll(request.provisioning || '[data-shell-provisioning]'));
      const ready = Array.from(document.querySelectorAll(request.ready || '[data-shell-data-ready]'));
      const token = Array.from(document.querySelectorAll(request.setupToken || '[data-shell-setup-token-field]'));
      provisioning.forEach(node => { node.hidden = state.ready; });
      ready.forEach(node => { node.hidden = !state.ready; });
      token.forEach(node => { node.hidden = state.ready || !state.setupTokenRequired; });
      document.documentElement.dataset.shellDataReady = String(state.ready);
      window.dispatchEvent(new CustomEvent('wasm-game-framework-data-status', { detail: state }));
      return state;
    }

    return Object.freeze({ baseUrl, variant, status, provision, load, applyGate });
  }

  function configure(options) {
    const config = options || {};
    const html = document.documentElement;
    const body = document.body;
    const launcher = element(config.launcher, '[data-shell-launcher]');
    const card = element(config.card, '[data-shell-card]');
    const loading = element(config.loading, '[data-shell-loading]');
    const runtime = element(config.runtime, '[data-shell-runtime]');
    const canvas = element(config.canvas, '[data-shell-canvas], canvas');
    const graphics = Array.from(document.querySelectorAll('[data-shell-graphics]'));
    const identity = Array.from(document.querySelectorAll('[data-shell-identity]'));
    const advanced = Array.from(document.querySelectorAll('[data-shell-advanced]'));
    let fit = config.fit === 'fill' ? 'fill' : 'contain';
    let aspect = positive(config.aspect, 4 / 3);
    let displayMode = normalizeDisplayMode(config.displayMode);
    let pixelated = Boolean(config.pixelated);
    const maxDpr = positive(config.maxDpr, 2);
    let resizeFrame = 0;
    let fullscreenResizeFrame = 0;
    let captureFrame = 0;
    let trustedIntentEvent = null;
    const pointerIntentGestures = new Map();
    let canvasObserver = null;
    let engineState = Object.values(ENGINE_STATES).includes(config.engineState) ? config.engineState : ENGINE_STATES.LAUNCHER;
    let preferences = null;

    function inputCaptured() {
      return Boolean(canvas && document.pointerLockElement === canvas);
    }

    function readCaptureIntent() {
      if (typeof config.readCaptureIntent !== 'function') return false;
      try { return config.readCaptureIntent() === true; } catch (_) { return false; }
    }

    function captureDesired() {
      if (engineState === ENGINE_STATES.GAMEPLAY) return true;
      return engineState === ENGINE_STATES.LOADING && readCaptureIntent();
    }

    function publishInputCapture() {
      const captured = inputCaptured();
      if (!captured && typeof config.readEngineState === 'function') {
        const reported = String(config.readEngineState() || '').toLowerCase();
        if (Object.values(ENGINE_STATES).includes(reported) && reported !== engineState) {
          setEngineState(reported);
        }
      }
      html.dataset.shellInputCaptured = String(captured);
      if (typeof config.onInputCaptureChange === 'function') {
        config.onInputCaptureChange(captured);
      }
      window.dispatchEvent(new CustomEvent('wasm-game-framework-input-capture', {
        detail: Object.freeze({ captured, canvas, state: engineState })
      }));
      if (!captured && engineState === ENGINE_STATES.GAMEPLAY && typeof config.onCaptureLost === 'function') {
        config.onCaptureLost({ state: engineState, canvas });
      }
      return captured;
    }

    function requestInputCapture(event, requestOptions) {
      const trustedIntent = requestOptions?.trustedIntent === true && trustedIntentEvent === event;
      if (!canvas || config.pointerLock !== true || (!trustedIntent && !captureDesired()) || inputCaptured()) return false;
      if (typeof config.shouldCapture === 'function' && !config.shouldCapture(event, canvas)) return false;
      try {
        const pending = canvas.requestPointerLock?.();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        return Boolean(pending !== undefined || canvas.requestPointerLock);
      } catch (_) {
        return false;
      }
    }

    function protectCapturedKey(event) {
      if (engineState !== ENGINE_STATES.GAMEPLAY || !inputCaptured() || event.ctrlKey || event.metaKey || event.altKey) return;
      const owned = config.browserOwnedKeys || ['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', '/'];
      if (owned.includes(event.key)) event.preventDefault();
    }

    function refreshAuthoritativeState() {
      if (typeof config.readEngineState !== 'function') return engineState;
      const reported = String(config.readEngineState() || '').toLowerCase();
      if (Object.values(ENGINE_STATES).includes(reported) && reported !== engineState) setEngineState(reported);
      return engineState;
    }

    function captureAfterInteraction(event) {
      if (captureFrame) cancelAnimationFrame(captureFrame);
      captureFrame = requestAnimationFrame(() => {
        captureFrame = 0;
        refreshAuthoritativeState();
        if (captureDesired()) requestInputCapture(event);
      });
    }

    function pointerPosition(eventOrX, clientY, pointerOptions) {
      const event = eventOrX && typeof eventOrX === 'object' ? eventOrX : null;
      const pointer = pointerOptions || {};
      return mapPointerPoint(
        canvas,
        event ? event.clientX : eventOrX,
        event ? event.clientY : clientY,
        pointer.width || config.pointerWidth || canvas?.width,
        pointer.height || config.pointerHeight || canvas?.height,
        { fit: pointer.fit || config.pointerFit, clamp: pointer.clamp }
      );
    }

    function publishPointer(event) {
      if (!canvas || inputCaptured()) return;
      const point = pointerPosition(event);
      const detail = Object.freeze({ ...point, state: engineState, canvas });
      config.onPointerMove?.(detail, event);
      window.dispatchEvent(new CustomEvent('wasm-game-framework-pointer', { detail }));
    }

    function pointerGestureKey(event) {
      const pointerId = Number.isFinite(Number(event.pointerId)) ? Number(event.pointerId) : 'mouse';
      const button = Number.isFinite(Number(event.button)) ? Number(event.button) : 0;
      return `${pointerId}:${button}`;
    }

    function clearPointerIntentGestures(event) {
      if (!event || !Number.isFinite(Number(event.pointerId))) {
        pointerIntentGestures.clear();
        return;
      }
      const prefix = `${Number(event.pointerId)}:`;
      for (const key of pointerIntentGestures.keys()) {
        if (key.startsWith(prefix)) pointerIntentGestures.delete(key);
      }
    }

    function publishPointerButton(event) {
      if (!canvas || inputCaptured()) return;
      const point = pointerPosition(event);
      const detail = Object.freeze({ ...point, state: engineState, canvas, button: event.button, pressed: event.type === 'pointerdown' });
      const gestureKey = pointerGestureKey(event);
      const intentBefore = readCaptureIntent();
      if (event.type === 'pointerdown') {
        clearPointerIntentGestures(event);
        pointerIntentGestures.set(gestureKey, Object.freeze({ intentBefore }));
      }
      const trackedGesture = event.type === 'pointerup' ? pointerIntentGestures.get(gestureKey) : null;
      config.onPointerButton?.(detail, event);
      if (event.type === 'pointerup') {
        // Pointer lock must be requested before this trusted activation ends.
        // The adapter/native seam therefore exposes launch intent while its
        // pointerButton callback is still on the stack. Keep the rAF check as
        // a compatibility fallback for state that becomes visible next frame.
        refreshAuthoritativeState();
        const intentAfter = readCaptureIntent();
        const eventScopedIntent = Boolean(trackedGesture && !trackedGesture.intentBefore && intentAfter);
        clearPointerIntentGestures(event);
        if (eventScopedIntent) {
          trustedIntentEvent = event;
          try { requestInputCapture(event, { trustedIntent: true }); } finally { trustedIntentEvent = null; }
        } else if (captureDesired()) requestInputCapture(event);
      }
    }

    async function resumeAudio() {
      const host = typeof globalThis !== 'undefined' ? globalThis : window;
      const contexts = [
        host.SDL2 && host.SDL2.audioContext,
        host.SDL && host.SDL.audioContext,
        host.SDL && host.SDL.audio && host.SDL.audio.ctx,
        host.AL && host.AL.currentContext && host.AL.currentContext.audioCtx,
        host.Howler && host.Howler.ctx,
        config.audioContext
      ].filter(Boolean);
      for (const context of new Set(contexts)) {
        if (context.state === 'suspended' && typeof context.resume === 'function') {
          try { await context.resume(); } catch (_) {}
        }
      }
      window.dispatchEvent(new CustomEvent('wasm-game-framework-user-gesture'));
    }

    html.classList.add('wasm-game-framework');
    body.classList.add('wasm-game-framework');
    if (launcher) launcher.setAttribute('data-shell-launcher', '');
    if (card) card.setAttribute('data-shell-card', config.wideCard ? 'wide' : '');
    if (loading) loading.setAttribute('data-shell-loading', '');
    if (runtime) runtime.setAttribute('data-shell-runtime', '');
    if (canvas) {
      canvas.setAttribute('data-shell-canvas', '');
      canvas.setAttribute('data-shell-pixelated', pixelated ? 'true' : 'false');
    }
    html.dataset.shellEngineState = engineState;

    if (config.desktopNotice !== false && !document.querySelector('[data-shell-desktop-notice]')) {
      const notice = document.createElement('div');
      notice.setAttribute('data-shell-desktop-notice', '');
      notice.setAttribute('role', 'note');
      notice.textContent = config.desktopNoticeText || 'This experience works best on a desktop with a keyboard and mouse.';
      body.appendChild(notice);
    }

    if (config.graphics === false) graphics.forEach(node => { node.hidden = true; });
    if (config.identity === false) identity.forEach(node => { node.hidden = true; });
    if (config.advanced === false) advanced.forEach(node => { node.hidden = true; });

    if (config.theme) {
      for (const [name, value] of Object.entries(config.theme)) {
        if (value) html.style.setProperty(`--wasm-game-framework-${name}`, String(value));
      }
    }

    function resize() {
      resizeFrame = 0;
      if (!canvas) return null;
      const viewport = window.visualViewport;
      const viewWidth = viewport ? viewport.width : window.innerWidth;
      const viewHeight = viewport ? viewport.height : window.innerHeight;
      const requestedWidth = Math.max(1, Math.floor(viewWidth));
      const requestedHeight = Math.max(1, Math.floor(viewHeight));
      const nativeManaged = displayMode === DISPLAY_MODES.DYNAMIC &&
        (config.nativeManaged === true || typeof config.onNativeResizeRequest === 'function');
      const rect = displayMode ? resolveDisplayRect(viewWidth, viewHeight, displayMode, {
        nativeManaged,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
        aspectTolerance: config.aspectTolerance,
        resizeTransition: config.resizeTransition
      }) : { ...fitRect(viewWidth, viewHeight, aspect, fit), displayMode: null, nativeSynchronized: true };
      const cssWidth = Math.max(1, Math.floor(rect.width));
      const cssHeight = Math.max(1, Math.floor(rect.height));
      // SDL/Emscripten writes desktop-sized inline width/height styles when a
      // native window is created. Custom properties plus !important CSS keep
      // the browser viewport authoritative without fighting those mutations.
      canvas.style.setProperty('--wasm-game-framework-canvas-width', `${cssWidth}px`);
      canvas.style.setProperty('--wasm-game-framework-canvas-height', `${cssHeight}px`);
      canvas.style.aspectRatio = 'auto';
      if (config.syncBackbuffer) {
        const scale = Math.min(maxDpr, positive(window.devicePixelRatio, 1));
        const bufferWidth = Math.max(2, Math.round(cssWidth * scale));
        const bufferHeight = Math.max(2, Math.round(cssHeight * scale));
        if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
        if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
      }
      const detail = {
        displayMode,
        requestedWidth,
        requestedHeight,
        cssWidth,
        cssHeight,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
        aspect: cssWidth / cssHeight,
        fit: displayMode === DISPLAY_MODES.DYNAMIC ? 'fill' : 'contain',
        nativeSynchronized: rect.nativeSynchronized
      };
      if (typeof config.onNativeResizeRequest === 'function') config.onNativeResizeRequest(detail);
      if (typeof config.onResize === 'function') config.onResize(detail);
      window.dispatchEvent(new CustomEvent('wasm-game-framework-resize', { detail }));
      return detail;
    }

    function scheduleResize() {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(resize);
    }

    function scheduleFullscreenResize() {
      scheduleResize();
      if (fullscreenResizeFrame) cancelAnimationFrame(fullscreenResizeFrame);
      let samplesRemaining = 3;
      const sampleSettledViewport = () => {
        fullscreenResizeFrame = 0;
        resize();
        samplesRemaining -= 1;
        if (samplesRemaining > 0) fullscreenResizeFrame = requestAnimationFrame(sampleSettledViewport);
      };
      fullscreenResizeFrame = requestAnimationFrame(sampleSettledViewport);
    }

    window.addEventListener('resize', scheduleResize, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleResize, { passive: true });
    document.addEventListener('fullscreenchange', scheduleFullscreenResize);
    document.addEventListener('pointerlockchange', publishInputCapture);
    document.addEventListener('keydown', protectCapturedKey, true);
    if (canvas) {
      canvas.addEventListener('pointerdown', requestInputCapture);
      canvas.addEventListener('pointermove', publishPointer);
      canvas.addEventListener('pointerdown', publishPointerButton);
      canvas.addEventListener('pointerup', publishPointerButton);
      canvas.addEventListener('pointercancel', clearPointerIntentGestures);
      canvas.addEventListener('lostpointercapture', clearPointerIntentGestures);
      // Native intent is evaluated synchronously by publishPointerButton.
      // Retain a next-frame fallback for engines that publish state one frame
      // after dispatch (although a browser may reject capture after activation).
      canvas.addEventListener('pointerup', captureAfterInteraction);
      canvas.addEventListener('pointerdown', resumeAudio, { passive: true });
      canvas.addEventListener('keydown', resumeAudio, { passive: true });
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        config.onContextLost?.(event);
        window.dispatchEvent(new CustomEvent('wasm-game-framework-context-lost'));
      });
      canvas.addEventListener('webglcontextrestored', event => {
        config.onContextRestored?.(event);
        window.dispatchEvent(new CustomEvent('wasm-game-framework-context-restored'));
      });
    }
    if (runtime && typeof MutationObserver !== 'undefined') {
      new MutationObserver(scheduleResize).observe(runtime, {
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style']
      });
    }
    if (canvas && typeof MutationObserver !== 'undefined') {
      canvasObserver = new MutationObserver(scheduleResize);
      canvasObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    }
    publishInputCapture();
    resize();
    if (config.preferences) preferences = createPreferences(config.preferences === true ? {} : config.preferences);

    function setEngineState(next, stateOptions) {
      const value = String(next || '').toLowerCase();
      if (!Object.values(ENGINE_STATES).includes(value)) throw new Error(`Unknown engine state: ${next}`);
      const prior = engineState;
      engineState = value;
      html.dataset.shellEngineState = engineState;
      const shouldRelease = !captureDesired();
      if (shouldRelease && inputCaptured()) {
        try { document.exitPointerLock?.(); } catch (_) {}
      }
      if (captureDesired()) {
        canvas?.focus?.({ preventScroll: true });
        if (stateOptions?.capture === true) requestInputCapture(stateOptions.event);
      }
      const detail = Object.freeze({ prior, state: engineState, captured: inputCaptured() });
      config.onEngineStateChange?.(detail);
      window.dispatchEvent(new CustomEvent('wasm-game-framework-engine-state', { detail }));
      return detail;
    }

    return Object.freeze({
      config: Object.freeze({
        displayMode: normalizeDisplayMode(config.displayMode),
        fit: config.fit === 'fill' ? 'fill' : 'contain',
        aspect: positive(config.aspect, 4 / 3)
      }),
      launcher,
      loading,
      runtime,
      canvas,
      resumeAudio,
      inputCaptured,
      requestInputCapture,
      pointerPosition,
      engineState: () => engineState,
      setEngineState,
      preferences,
      resize,
      setDisplay(next) {
        const display = next || {};
        if (display.displayMode !== undefined || display.mode !== undefined) {
          displayMode = normalizeDisplayMode(display.displayMode === undefined ? display.mode : display.displayMode);
        }
        if (display.aspect !== undefined) aspect = positive(display.aspect, aspect);
        if (display.fit !== undefined) fit = display.fit === 'fill' ? 'fill' : 'contain';
        if (display.pixelated !== undefined) {
          pixelated = Boolean(display.pixelated);
          if (canvas) canvas.setAttribute('data-shell-pixelated', pixelated ? 'true' : 'false');
        }
        return resize();
      },
      setDisplayMode(mode) {
        const normalized = normalizeDisplayMode(mode);
        if (!normalized) throw new Error(`Unknown display mode: ${mode}`);
        displayMode = normalized;
        return resize();
      },
      showLauncher() {
        setEngineState(ENGINE_STATES.LAUNCHER);
        if (launcher) launcher.hidden = false;
        if (loading) loading.hidden = true;
        if (runtime) runtime.hidden = true;
      },
      showLoading() {
        setEngineState(ENGINE_STATES.LOADING);
        if (launcher) launcher.hidden = true;
        if (loading) loading.hidden = false;
        if (runtime) runtime.hidden = true;
      },
      showRuntime() {
        if (launcher) launcher.hidden = true;
        if (loading) loading.hidden = true;
        if (runtime) runtime.hidden = false;
        scheduleResize();
      },
      destroy() {
        window.removeEventListener('resize', scheduleResize);
        window.visualViewport?.removeEventListener('resize', scheduleResize);
        document.removeEventListener('fullscreenchange', scheduleFullscreenResize);
        document.removeEventListener('pointerlockchange', publishInputCapture);
        document.removeEventListener('keydown', protectCapturedKey, true);
        if (canvas) {
          canvas.removeEventListener('pointerdown', requestInputCapture);
          canvas.removeEventListener('pointerup', captureAfterInteraction);
          canvas.removeEventListener('pointermove', publishPointer);
          canvas.removeEventListener('pointerdown', publishPointerButton);
          canvas.removeEventListener('pointerup', publishPointerButton);
          canvas.removeEventListener('pointercancel', clearPointerIntentGestures);
          canvas.removeEventListener('lostpointercapture', clearPointerIntentGestures);
          canvas.removeEventListener('pointerdown', resumeAudio);
          canvas.removeEventListener('keydown', resumeAudio);
        }
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        if (fullscreenResizeFrame) cancelAnimationFrame(fullscreenResizeFrame);
        if (captureFrame) cancelAnimationFrame(captureFrame);
        canvasObserver?.disconnect();
      }
    });
  }

  const api = Object.freeze({
    version: '0.7.4',
    DISPLAY_MODES,
    ENGINE_STATES,
    validateAdapterContract,
    configure,
    fitRect,
    mapPointerPoint,
    resolveDisplayRect,
    detectCapabilities,
    requireCapabilities,
    createPreferences,
    createQualityController,
    createPersistentFs,
    createDiagnostics,
    resolveDeployment,
    createDataCache,
    createOwnerDataSet,
    normalizeDataValidatorDeclaration,
    dataValidatorCacheTag,
    createBoundedDataReader,
    runDataValidator,
    validateOwnerFile,
    ownerFileValidation,
    mountOwnerFiles,
    createContainerDataClient,
    createWakeClient
  });
  if (typeof globalThis !== 'undefined') globalThis.WasmGameFramework = api;
  return api;
});
