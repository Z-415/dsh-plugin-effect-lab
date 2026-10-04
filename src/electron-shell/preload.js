'use strict';

/**
 * Minimal desktop preload for the lab shell.
 *
 * It mirrors the two contract points the official `lib/preload-app.cjs` gives
 * the packaged frontend:
 *
 *   1. `window.dshDesktopBoot.ready()` -> `{ injections, streamBaseUrl }`,
 *      which makes the frontend publish
 *      `globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }`.
 *   2. a probe surface (`__dshLabShell.collect()`) that records DOM slots,
 *      `--dsw-*` / `--we-*` tokens, and desktop-only body/html attributes.
 *
 * The file is CommonJS on purpose: Electron loads sandboxed preloads as
 * CommonJS regardless of the surrounding package `"type"`.
 */

const BOOT_CHANNEL = 'dsh-lab:boot';
const BOOT_FAILED_CHANNEL = 'dsh-lab:boot-failed';

const TOKEN_PREFIXES = ['--dsw-', '--we-'];
const DESKTOP_ATTRIBUTE_HINTS = [
  'data-dsh-desktop',
  'data-dsh-platform',
  'data-dsh-titlebar',
  'data-desktop',
  'data-platform',
  'data-electron',
  'data-ds-dark-theme',
  'data-we-adapter',
];

function attributeMap(element) {
  if (!element || !element.attributes) return {};
  const out = {};
  for (const attribute of Array.from(element.attributes)) out[attribute.name] = attribute.value;
  return out;
}

function collectTokenNames() {
  const names = new Set();
  const sheets = typeof document === 'undefined' ? [] : Array.from(document.styleSheets || []);
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      const style = rule && rule.style;
      if (!style) continue;
      for (const property of Array.from(style)) {
        if (TOKEN_PREFIXES.some((prefix) => property.startsWith(prefix))) names.add(property);
      }
    }
  }
  return names;
}

function pickThemeRoot() {
  if (typeof document === 'undefined') return null;
  const probes = ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill', '--dsw-static-neutral-00'];
  const candidates = [
    document.documentElement,
    document.body,
    document.querySelector('[data-slot="root"]'),
    document.querySelector('#root'),
    document.querySelector('#app'),
    ...Array.from(document.querySelectorAll('body > *')),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const computed = getComputedStyle(candidate);
    if (probes.some((name) => computed.getPropertyValue(name).trim())) return candidate;
  }
  return document.body || document.documentElement;
}

function transportFacts() {
  const transport = typeof globalThis === 'undefined' ? undefined : globalThis.__DSH_TRANSPORT__;
  if (!transport || typeof transport !== 'object') return { present: false, ownsHost: false, streamBaseUrl: null };
  return {
    present: true,
    ownsHost: transport.ownsHost === true,
    streamBaseUrl: typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : null,
  };
}

function layerKey(element) {
  const slot = element.getAttribute('data-slot');
  if (slot) return `slot:${slot}`;
  if (element.id) return `#${element.id}`;
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('data-we-') || attribute.name.startsWith('data-lab-')) {
      return `${attribute.name}=${attribute.value}`;
    }
  }
  const cls = typeof element.className === 'string' ? element.className : (element.getAttribute('class') || '');
  const first = cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return `${element.tagName.toLowerCase()}${first ? `.${first}` : ''}`;
}

/** Positioned elements with an explicit z-index, lowest (background) first. */
function collectLayers() {
  if (typeof document === 'undefined') return { layers: [], layerSummary: { count: 0, min: null, max: null } };
  const layers = [];
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const computed = getComputedStyle(element);
    if (computed.zIndex === 'auto' || computed.position === 'static') continue;
    const numeric = Number(computed.zIndex);
    layers.push({
      key: layerKey(element),
      zIndex: Number.isFinite(numeric) ? numeric : null,
      position: computed.position,
      hasBackgroundImage: computed.backgroundImage !== 'none',
      backgroundColor: computed.backgroundColor,
    });
    if (layers.length >= 400) break;
  }
  layers.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  return {
    layers: layers.slice(0, 40),
    layerSummary: layers.length
      ? { count: layers.length, min: layers[0].zIndex, max: layers[layers.length - 1].zIndex }
      : { count: 0, min: null, max: null },
  };
}

function titlebarFacts() {
  try {
    const overlay = typeof navigator === 'undefined' ? undefined : navigator.windowControlsOverlay;
    if (!overlay) return { available: false, visible: false, rect: null };
    const rect = typeof overlay.getTitlebarAreaRect === 'function' ? overlay.getTitlebarAreaRect() : null;
    return {
      available: true,
      visible: overlay.visible === true,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    };
  } catch (error) {
    return { available: false, visible: false, rect: null, error: String(error) };
  }
}

function desktopFacts(runtime) {
  const processLike = (runtime && runtime.process) || (typeof process === 'undefined' ? undefined : process);
  const versions = (processLike && processLike.versions) || {};
  return {
    isDesktopShell: true,
    platform: processLike ? processLike.platform ?? null : null,
    arch: processLike ? processLike.arch ?? null : null,
    isMainFrame: processLike ? processLike.isMainFrame !== false : null,
    versions: {
      electron: versions.electron ?? null,
      chrome: versions.chrome ?? null,
      node: versions.node ?? null,
    },
  };
}

/** Collect the full DOM/token/desktop snapshot from the renderer. */
function collectSnapshot(runtime) {
  const root = pickThemeRoot();
  const computed = root ? getComputedStyle(root) : null;
  const names = collectTokenNames();
  const { layers, layerSummary } = collectLayers();
  const tokens = {};
  for (const name of names) tokens[name] = computed ? computed.getPropertyValue(name).trim() : '';
  const hintedBody = {};
  const bodyAttributes = typeof document === 'undefined' || !document.body ? {} : attributeMap(document.body);
  for (const key of DESKTOP_ATTRIBUTE_HINTS) if (bodyAttributes[key] !== undefined) hintedBody[key] = bodyAttributes[key];

  return {
    source: 'preload',
    title: typeof document === 'undefined' ? null : document.title,
    url: typeof location === 'undefined' ? null : location.href,
    readyState: typeof document === 'undefined' ? null : document.readyState,
    htmlClass: typeof document === 'undefined' || !document.documentElement ? '' : document.documentElement.className,
    htmlAttributes: typeof document === 'undefined' || !document.documentElement ? {} : attributeMap(document.documentElement),
    bodyAttributes,
    hintedBodyAttributes: hintedBody,
    slots: typeof document === 'undefined'
      ? []
      : [...new Set(Array.from(document.querySelectorAll('[data-slot]')).map((element) => element.getAttribute('data-slot')))].sort(),
    slotCount: typeof document === 'undefined' ? 0 : document.querySelectorAll('[data-slot]').length,
    slotErrors: typeof document === 'undefined' ? 0 : document.querySelectorAll('[data-slot-error]').length,
    themeRoot: root ? { tag: root.tagName ? root.tagName.toLowerCase() : null, id: root.id || null } : null,
    layers,
    layerSummary,
    tokens,
    tokenCount: Object.keys(tokens).length,
    transport: transportFacts(),
    titlebar: titlebarFacts(),
    desktop: desktopFacts(runtime),
    collectedAt: new Date().toISOString(),
  };
}

/** Wire the boot bridge and the probe surface into the main world. */
function install(runtime) {
  runtime.contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => runtime.ipcRenderer.invoke(BOOT_CHANNEL),
    failed: (message) => runtime.ipcRenderer.invoke(BOOT_FAILED_CHANNEL, String(message ?? '')),
  });
  runtime.contextBridge.exposeInMainWorld('__dshLabShell', {
    collect: () => collectSnapshot(runtime),
    notify: (title, body) => runtime.ipcRenderer.invoke('dsh-lab:notify', String(title ?? ''), String(body ?? '')),
    desktopAttributeHints: DESKTOP_ATTRIBUTE_HINTS,
    tokenPrefixes: TOKEN_PREFIXES,
  });
  // Same names the official desktop preload exposes. The directory picker is a
  // lab stub (it returns the fixture workspace instead of opening a native
  // dialog) so automation never blocks on UI.
  runtime.contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
    pick: () => runtime.ipcRenderer.invoke('dsh-lab:pick-directory'),
  });
  runtime.contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file) => (file && typeof file === 'object' && typeof file.path === 'string' ? file.path : ''),
  });
}

function autoInstall() {
  if (typeof require !== 'function') return false;
  let electron;
  try {
    electron = require('electron');
  } catch {
    return false;
  }
  if (!electron || !electron.contextBridge || !electron.ipcRenderer) return false;
  install(electron);
  return true;
}

autoInstall();

module.exports = {
  BOOT_CHANNEL,
  BOOT_FAILED_CHANNEL,
  DESKTOP_ATTRIBUTE_HINTS,
  TOKEN_PREFIXES,
  attributeMap,
  collectSnapshot,
  install,
  transportFacts,
};
