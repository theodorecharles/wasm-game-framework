#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateAdapterContract } = require('../dist/wasm-game-framework.js');
const { normalizeManifestCollection } = require('../server/provisioning.js');

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function publicFile(root, url) {
  const pathname = String(url || '').split(/[?#]/, 1)[0].replace(/^\/+/, '');
  return path.join(root, pathname);
}

function isRuntimeAsset(url) {
  return /^\/game-data\/files\//.test(String(url || ''));
}

function methodStub(source, name) {
  const pattern = new RegExp(`(?:^|[,{])\\s*(?:async\\s+)?${name}\\s*(?:\\(|:|[,}])`, 'm');
  return pattern.test(source) ? function adapterMethod() {} : undefined;
}

function mergedVariants(rootConfig) {
  if (!rootConfig.variants) return [{ key: rootConfig.id || 'game', config: rootConfig }];
  return Object.entries(rootConfig.variants).map(([key, value]) => {
    const base = { ...rootConfig };
    delete base.variants;
    return { key, config: { ...base, ...value, id: key } };
  });
}

function assertNeutralReadyCopy(config, key) {
  const normal = [config.description, config.loadingTitle, config.pwa?.description].filter(Boolean).join('\n');
  if (/\b(?:legal(?:ly)?|illegal|piracy|entitlement|owner[- ]?(?:supplied|provided|data)|game data|files?|cache[ds]?|container|directory|folder|upload(?:ed|ing)?|download(?:ed|ing)?)\b/i.test(normal)) {
    fail(`${key}: normal launcher/PWA copy contains provisioning or storage language`);
  }
}

function checkConfig(siteRoot, key, config, adapterSource) {
  if (!['4:3', '16:9', 'dynamic'].includes(config.displayMode)) {
    fail(`${key}: displayMode must be exactly 4:3, 16:9, or dynamic`);
  }
  if ((config.pointerWidth == null) !== (config.pointerHeight == null)) {
    fail(`${key}: pointerWidth and pointerHeight must be declared together`);
  }
  if (config.pointerFit != null && !['contain', 'fill'].includes(config.pointerFit)) {
    fail(`${key}: pointerFit must be contain or fill`);
  }
  if (config.resizeTransition != null && !['immediate', 'native'].includes(config.resizeTransition)) {
    fail(`${key}: resizeTransition must be immediate or native`);
  }
  if (config.fullscreen !== true && config.fullscreen !== false) {
    fail(`${key}: fullscreen capability must be explicit`);
  }
  if (!config.icon || (!isRuntimeAsset(config.icon) && !fs.existsSync(publicFile(siteRoot, config.icon)))) {
    fail(`${key}: launcher icon is missing`);
  }
  if (!(config.pwa?.name || config.title) || !config.pwa?.shortName || !Array.isArray(config.pwa?.icons) || !config.pwa.icons.length) {
    fail(`${key}: complete PWA title, shortName, and icons are required`);
  }
  for (const icon of config.pwa.icons) {
    if (!icon.src || !icon.sizes || !icon.type || (!isRuntimeAsset(icon.src) && !fs.existsSync(publicFile(siteRoot, icon.src)))) {
      fail(`${key}: invalid or missing PWA icon ${icon.src || '<unnamed>'}`);
    }
  }
  assertNeutralReadyCopy(config, key);

  const names = [
    'start', 'resize', 'pointerMove', 'pointerButton', 'readEngineState', 'captureLost',
    'inputCaptureChanged', 'preferencesChanged', 'contextLost', 'contextRestored'
  ];
  const adapter = Object.fromEntries(names.map(name => [name, methodStub(adapterSource, name)]).filter(([, value]) => value));
  try {
    validateAdapterContract(config, adapter);
  } catch (error) {
    fail(`${key}: ${error.message}`);
  }
}

function main() {
  const siteRoot = path.resolve(process.argv[2] || 'site');
  const manifestPath = path.join(siteRoot, 'wasm-game.json');
  if (!fs.existsSync(manifestPath)) fail(`Missing ${manifestPath}`);
  const rootConfig = readJson(manifestPath);
  const adapterPath = publicFile(siteRoot, rootConfig.adapter || '/game-adapter.js');
  if (!fs.existsSync(adapterPath)) fail(`Missing ${adapterPath}`);
  const adapterSource = fs.readFileSync(adapterPath, 'utf8');

  for (const { key, config } of mergedVariants(rootConfig)) {
    checkConfig(siteRoot, key, config, adapterSource);
  }
  const dataManifestPath = path.join(siteRoot, 'wasm-game-data.json');
  if (fs.existsSync(dataManifestPath)) {
    const manifests = normalizeManifestCollection(readJson(dataManifestPath));
    for (const [variant, manifest] of manifests) {
      for (const policy of manifest.files) {
        if (policy.validator && !fs.existsSync(publicFile(siteRoot, policy.validator.module))) {
          fail(`${variant}/${policy.key}: data-validator module is missing: ${policy.validator.module}`);
        }
      }
    }
  }
  console.log(`adapter package contract passed for ${mergedVariants(rootConfig).length} variant(s) in ${siteRoot}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
