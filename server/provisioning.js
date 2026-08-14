'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function safeKey(value) {
  const key = String(value || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(key)) throw new Error(`Invalid game-data key: ${value}`);
  return key;
}

function safeName(value) {
  const raw = String(value || '').toLowerCase();
  const name = path.basename(raw);
  if (!name || name === '.' || name === '..' || name !== raw) throw new Error(`Invalid game-data filename: ${value}`);
  return name;
}

function safeRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid game-data path: ${value}`);
  }
  return normalized;
}

function normalizeManifest(input) {
  const manifest = input || {};
  const files = (manifest.files || []).map((entry, index) => {
    const key = safeKey(entry.key || entry.name || `file-${index}`);
    const name = safeName(entry.name || key);
    const relativePath = safeRelative(entry.path || name);
    const names = Array.from(new Set([name, ...(entry.names || []).map(safeName)]));
    const sizes = (entry.sizes || (entry.size === undefined ? [] : [entry.size])).map(Number);
    const sha256 = (entry.sha256 ? (Array.isArray(entry.sha256) ? entry.sha256 : [entry.sha256]) : [])
      .map(value => String(value).toLowerCase());
    if (sha256.some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error(`Invalid SHA-256 policy for ${key}.`);
    return Object.freeze({ ...entry, key, name, path: relativePath, names, sizes, sha256, required: entry.required !== false });
  });
  if (!files.length) throw new Error('A game-data manifest must contain at least one file.');
  return Object.freeze({
    namespace: safeKey(manifest.namespace || 'game'),
    version: String(manifest.version || '1'),
    files: Object.freeze(files)
  });
}

function normalizeManifestCollection(input) {
  const manifest = input || {};
  if (!manifest.variants || typeof manifest.variants !== 'object' || Array.isArray(manifest.variants)) {
    return new Map([['default', normalizeManifest(manifest)]]);
  }
  const rootNamespace = safeKey(manifest.namespace || 'game-suite');
  const rootVersion = String(manifest.version || '1');
  const variants = new Map();
  for (const [rawKey, value] of Object.entries(manifest.variants)) {
    const key = safeKey(rawKey);
    const definition = value || {};
    variants.set(key, normalizeManifest({
      ...definition,
      namespace: definition.namespace || `${rootNamespace}-${key}`,
      version: definition.version || rootVersion
    }));
  }
  if (!variants.size) throw new Error('A suite game-data manifest must contain at least one variant.');
  return variants;
}

function magicSpecifications(rule) {
  if (rule.magic === undefined) return [];
  const values = Array.isArray(rule.magic) && rule.magic.length && typeof rule.magic[0] === 'object' ? rule.magic : [rule.magic];
  return values.map(value => {
    const spec = value && value.bytes !== undefined ? value : { bytes: value, offset: 0 };
    return {
      offset: Number(spec.offset) || 0,
      bytes: typeof spec.bytes === 'string' ? Buffer.from(spec.bytes, 'latin1') : Buffer.from(spec.bytes)
    };
  });
}

function createProvisioningStore(options) {
  const config = options || {};
  const dataRoot = path.resolve(config.dataRoot || '/data');
  const manifest = normalizeManifest(config.manifest);
  const validationCache = new Map();

  function filePath(policy) { return path.join(dataRoot, policy.path); }

  async function validate(policy) {
    const target = filePath(policy);
    let stat;
    try { stat = await fsp.stat(target); } catch (_) { return { valid: false, error: 'missing' }; }
    if (!stat.isFile()) return { valid: false, error: 'not a regular file' };
    if (policy.sizes.length && !policy.sizes.includes(stat.size)) return { valid: false, error: `wrong size (${stat.size})` };
    if (policy.minSize !== undefined && stat.size < Number(policy.minSize)) return { valid: false, error: 'too small' };
    if (policy.maxSize !== undefined && stat.size > Number(policy.maxSize)) return { valid: false, error: 'too large' };
    const cacheKey = `${target}:${stat.size}:${stat.mtimeMs}:${manifest.version}`;
    if (validationCache.has(cacheKey)) return validationCache.get(cacheKey);
    const handle = await fsp.open(target, 'r');
    try {
      for (const specification of magicSpecifications(policy)) {
        const actual = Buffer.alloc(specification.bytes.length);
        const result = await handle.read(actual, 0, actual.length, specification.offset);
        if (result.bytesRead !== actual.length || !actual.equals(specification.bytes)) {
          return { valid: false, error: `wrong signature at byte ${specification.offset}` };
        }
      }
    } finally { await handle.close(); }
    let digest = null;
    if (policy.sha256.length) {
      digest = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(target);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
      });
      if (!policy.sha256.includes(digest)) return { valid: false, error: 'wrong SHA-256' };
    }
    const result = Object.freeze({ valid: true, path: target, size: stat.size, sha256: digest });
    validationCache.set(cacheKey, result);
    return result;
  }

  async function status() {
    const results = await Promise.all(manifest.files.map(validate));
    const files = manifest.files.map((policy, index) => Object.freeze({
      key: policy.key,
      name: policy.name,
      path: policy.path,
      names: policy.names,
      sizes: policy.sizes,
      required: policy.required,
      valid: Boolean(results[index].valid),
      error: results[index].valid ? null : results[index].error
    }));
    return Object.freeze({
      configured: true,
      namespace: manifest.namespace,
      version: manifest.version,
      ready: files.every(file => !file.required || file.valid),
      files: Object.freeze(files)
    });
  }

  function policyFor(key) {
    const normalized = safeKey(key);
    return manifest.files.find(policy => policy.key === normalized) || null;
  }

  async function acceptUpload(key, readable) {
    const policy = policyFor(key);
    if (!policy) { const error = new Error('Unknown game-data file.'); error.statusCode = 404; throw error; }
    if ((await validate(policy)).valid) { const error = new Error(`${policy.name} is already valid.`); error.statusCode = 409; throw error; }
    const target = filePath(policy);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    const temporary = path.join(path.dirname(target), `.${policy.name}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.upload`);
    const maximum = policy.sizes.length ? Math.max(...policy.sizes) :
      policy.maxSize === undefined ? 8 * 1024 * 1024 * 1024 : Number(policy.maxSize);
    let received = 0;
    const destination = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    try {
      await new Promise((resolve, reject) => {
        let failed = false;
        const fail = error => { if (!failed) { failed = true; reject(error); } };
        readable.on('data', chunk => {
          received += chunk.length;
          if (received > maximum) {
            const error = new Error(`${policy.name} exceeds its allowed size.`);
            error.statusCode = 413;
            fail(error);
            readable.unpipe(destination);
            destination.destroy();
          }
        });
        readable.on('error', fail);
        destination.on('error', fail);
        destination.on('finish', () => { if (!failed) resolve(); });
        readable.pipe(destination);
      });
      await fsp.rename(temporary, target);
      validationCache.clear();
      const result = await validate(policy);
      if (!result.valid) {
        await fsp.rm(target, { force: true });
        const error = new Error(`${policy.name} was rejected: ${result.error}.`);
        error.statusCode = 422;
        throw error;
      }
      await fsp.chmod(target, 0o644);
      return result;
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
  }

  return Object.freeze({ manifest, dataRoot, status, validate, policyFor, acceptUpload, filePath });
}

module.exports = { normalizeManifest, normalizeManifestCollection, createProvisioningStore };
