import { diffStringMap } from '../theme-token-probe.js';

/** Token namespaces the lab records; `--we-*` is wallpaper-engine's own set. */
export const TOKEN_PREFIXES = ['--dsw-', '--we-'];

/**
 * Body/HTML attributes the official desktop shell is expected to add on top of
 * the web renderer. They are only *hints* for the report: the diff never
 * assumes a name is present, it just labels a matching one as desktop-only.
 */
export const DESKTOP_ATTRIBUTE_HINTS = [
  'data-dsh-desktop',
  'data-dsh-platform',
  'data-dsh-titlebar',
  'data-desktop',
  'data-platform',
  'data-electron',
  'data-ds-dark-theme',
  'data-we-adapter',
];

/** The renderer-side global the frontend reads to find the Host stream. */
export const TRANSPORT_GLOBAL = '__DSH_TRANSPORT__';

/** WS route carrying every Typert Remote stream (official 0.2.0-rc.2 value). */
export const REMOTE_MUX_PATH = '/api/remote.mux';

export const DEVTOOLS_CONSOLE_ERROR = '[connection] connection lost';

/** The two desktop-bridge behaviours: deterministic `stub` or real `native`. */
export const DESKTOP_MODES = ['stub', 'native'];

/**
 * Resolve the requested desktop-bridge mode against the run shape.
 *
 * `stub` (the default) returns a fixture path and records notifications
 * without showing them, so automation is deterministic and never blocks.
 * `native` wires the real Electron `dialog.showOpenDialog` and
 * `Notification`. A native folder dialog is modal and must be answered by a
 * human, so native mode is only allowed with a visible window (`--show` /
 * `--keep-open`); otherwise the run falls back to the stub and reports why.
 */
export function resolveDesktopMode(requested, options = {}) {
  const native = requested === true || requested === 'native';
  if (!native) return { mode: 'stub', native: false, ok: true, reason: 'stub-default' };
  if (!options.show) {
    return {
      mode: 'stub',
      native: false,
      ok: false,
      reason: 'native-desktop-requires-show',
      detail: '--native-desktop needs --show or --keep-open: a native folder dialog is modal and needs a visible window',
    };
  }
  return { mode: 'native', native: true, ok: true, reason: 'native-enabled' };
}

/**
 * One-line report text for the desktop bridges. `capabilities` is the shell's
 * capability payload (`result.capabilities`) and may be null when the shell
 * failed before probing.
 */
export function formatDesktopBridges(capabilities = null) {
  const bridge = capabilities?.bridge ?? {};
  const picker = bridge.directoryPicker ?? {};
  const notification = bridge.notification ?? {};
  const pickerMode = picker.mode ?? 'stub';
  const pickerText = picker.autoProbed === false
    ? `${pickerMode} (not auto-probed: a native dialog would block the run)`
    : `${pickerMode}${picker.called ? ' (called)' : ''}`;
  const notificationText = `${notification.mode ?? 'stub'}`
    + `${notification.requested ? ` requested=${notification.requested}` : ''}`
    + `${notification.suppressed ? ' suppressed' : ''}`
    + `${notification.shown ? ` shown=${notification.shown}` : ''}`
    + `${notification.supported === false ? ' unsupported' : ''}`;
  return `directoryPicker=${pickerText}; notifications=${notificationText}`;
}

function stringMap(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = entry === undefined ? '' : String(entry);
  return out;
}

/** Coerce one renderer snapshot (preload or CDP) into the shared probe shape. */
export function normalizeProbe(input = {}) {
  const tokens = stringMap(input.tokens);
  const slots = [...new Set((input.slots ?? []).map(String))].sort();
  return {
    source: input.source ?? null,
    title: input.title ?? null,
    url: input.url ?? null,
    readyState: input.readyState ?? null,
    htmlClass: typeof input.htmlClass === 'string' ? input.htmlClass : '',
    htmlAttributes: stringMap(input.htmlAttributes),
    bodyAttributes: stringMap(input.bodyAttributes),
    slots,
    slotCount: Number.isFinite(input.slotCount) ? input.slotCount : slots.length,
    slotErrors: Number.isFinite(input.slotErrors) ? input.slotErrors : 0,
    themeRoot: input.themeRoot ?? null,
    layers: Array.isArray(input.layers) ? input.layers : [],
    layerSummary: input.layerSummary ?? null,
    titlebar: input.titlebar ?? null,
    tokens,
    tokenCount: Number.isFinite(input.tokenCount) ? input.tokenCount : Object.keys(tokens).length,
    transport: normalizeTransport(input.transport),
    desktop: input.desktop ?? null,
    collectedAt: input.collectedAt ?? null,
  };
}

/** Normalize the `__DSH_TRANSPORT__` facts so both modes render identically. */
export function normalizeTransport(value) {
  if (!value || typeof value !== 'object') return { present: false, ownsHost: false, streamBaseUrl: null };
  return {
    present: value.present ?? true,
    ownsHost: value.ownsHost === true,
    streamBaseUrl: typeof value.streamBaseUrl === 'string' ? value.streamBaseUrl : null,
  };
}

/** Keys present in the shell but empty/absent in web. */
function desktopAddedKeys(reference = {}, candidate = {}) {
  return Object.keys(candidate)
    .filter((key) => {
      const after = String(candidate[key] ?? '');
      if (after === '') return false;
      return String(reference[key] ?? '') === '';
    })
    .sort();
}

/**
 * Keys whose shell value differs from web: absent in web, or a different
 * non-empty value. This catches a real desktop signal such as
 * `data-we-adapter` flipping from `browser` to `desktop-official`.
 */
function desktopDifferingKeys(reference = {}, candidate = {}) {
  return Object.keys(candidate)
    .filter((key) => {
      const after = String(candidate[key] ?? '');
      if (after === '') return false;
      return String(reference[key] ?? '') !== after;
    })
    .sort();
}

function hintedKeys(keys) {
  return keys.filter((key) => DESKTOP_ATTRIBUTE_HINTS.includes(key));
}

/**
 * Diff two snapshots of the same isolated profile: `reference` is web mode and
 * `candidate` is the Electron shell. Sign matters: `added` means shell-only.
 */
export function diffProbeSnapshots(referenceInput = {}, candidateInput = {}) {
  const reference = normalizeProbe(referenceInput);
  const candidate = normalizeProbe(candidateInput);
  const slotSet = new Set(reference.slots);
  const candidateSlots = new Set(candidate.slots);
  const bodyAttributes = diffStringMap(reference.bodyAttributes, candidate.bodyAttributes);
  const htmlAttributes = diffStringMap(reference.htmlAttributes, candidate.htmlAttributes);
  const layers = diffLayers(reference.layers, candidate.layers);
  const differingBody = desktopDifferingKeys(reference.bodyAttributes, candidate.bodyAttributes);
  return {
    slots: {
      added: candidate.slots.filter((slot) => !slotSet.has(slot)),
      removed: reference.slots.filter((slot) => !candidateSlots.has(slot)),
    },
    bodyAttributes,
    htmlAttributes,
    layers,
    tokens: diffStringMap(reference.tokens, candidate.tokens),
    counts: {
      slots: { web: reference.slotCount, shell: candidate.slotCount },
      tokens: { web: reference.tokenCount, shell: candidate.tokenCount },
      slotErrors: { web: reference.slotErrors, shell: candidate.slotErrors },
    },
    themeRoot: { web: reference.themeRoot, shell: candidate.themeRoot },
    layerSummary: { web: reference.layerSummary, shell: candidate.layerSummary },
    transport: { web: reference.transport, shell: candidate.transport },
    desktopOnly: {
      bodyAttributes: differingBody,
      htmlAttributes: desktopDifferingKeys(reference.htmlAttributes, candidate.htmlAttributes),
      tokens: desktopAddedKeys(reference.tokens, candidate.tokens),
      hintedBodyAttributes: hintedKeys(differingBody),
    },
  };
}

/** Compare stacking layers by key; `zIndex` is the value that matters. */
export function diffLayers(before = [], after = []) {
  const beforeMap = new Map((before ?? []).map((layer) => [layer.key, layer]));
  const afterMap = new Map((after ?? []).map((layer) => [layer.key, layer]));
  const changed = {};
  const added = {};
  const removed = {};
  for (const [key, layer] of afterMap) {
    const previous = beforeMap.get(key);
    if (!previous) {
      added[key] = layer;
      continue;
    }
    if (previous.zIndex !== layer.zIndex || previous.position !== layer.position) {
      changed[key] = { before: previous, after: layer };
    }
  }
  for (const [key, layer] of beforeMap) if (!afterMap.has(key)) removed[key] = layer;
  return { changed, added, removed };
}

/** One-line console summary used by `lab shell` and the Markdown report. */
export function summarizeProbe(input = {}) {
  const probe = normalizeProbe(input);
  const bgBase = probe.tokens['--dsw-alias-bg-base'] ?? '';
  return {
    slots: probe.slotCount,
    tokens: probe.tokenCount,
    bgBase,
    bodyAttributeKeys: Object.keys(probe.bodyAttributes).sort(),
    transport: probe.transport,
    themeRoot: probe.themeRoot?.tag ?? null,
  };
}

/** True when a console message is the shell/host stream trust-fence failure. */
export function isConnectionLost(message) {
  return String(message ?? '').includes(DEVTOOLS_CONSOLE_ERROR);
}

/** Count how many diffs the shell adds on top of web mode. */
export function diffMagnitude(diff) {
  return (
    (diff?.slots?.added?.length ?? 0)
    + (diff?.slots?.removed?.length ?? 0)
    + (diff?.tokens?.changed ? Object.keys(diff.tokens.changed).length : 0)
    + Object.keys(diff?.tokens?.added ?? {}).length
    + Object.keys(diff?.tokens?.removed ?? {}).length
    + Object.keys(diff?.bodyAttributes?.changed ?? {}).length
    + Object.keys(diff?.bodyAttributes?.added ?? {}).length
    + Object.keys(diff?.bodyAttributes?.removed ?? {}).length
  );
}
