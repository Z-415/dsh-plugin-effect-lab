import fs from 'node:fs';
import path from 'node:path';
import { collectPatchIds } from './manifest-validator.js';

/**
 * Static declaration scanner.
 *
 * Duplicate *ids* live in four different namespaces, and a useful report must
 * not conflate them:
 *
 *   loader          `cordis.patch.yml` entry ids (bundle patch rows)
 *   slot-registration  `ctx.slots.register({ id })` registration identity
 *   slot-key        `ctx.slots.register({ name })` target slot
 *   tool            `defineTool({ name })` tool name
 *
 * The patterns are deliberately small and documented as heuristics: they read
 * the shipped bundle text rather than executing plugin code.
 */

const SLOT_REGISTER_RE = /\.slots\.register\(\s*\{([^{}]*)\}/g;
const STRING_FIELD_RE = /([A-Za-z_$][\w$]*)\s*:\s*['"`]([^'"`]*)['"`]/g;
const NUMBER_FIELD_RE = /([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?)\b/g;
const TOOL_DEFINE_RE = /defineTool\s*\(\s*\{/g;
const TOOL_NAME_RE = /(?:^|[,{\s])name\s*:\s*['"`]([^'"`]+)['"`]/;
const TOOL_WINDOW = 800;

const SOURCE_EXTENSIONS = /\.(?:js|cjs|mjs|ts)$/i;
export const MAX_SCAN_FILE_BYTES = 4 * 1024 * 1024;

/** Files whose module id ends in `/client` (the browser half). */
export function isClientFile(relative) {
  const normalized = String(relative).replace(/\\/g, '/');
  return /(?:^|\/)client\.[cm]?[jt]s$/i.test(normalized);
}

/** Extract `ctx.slots.register({ ... })` declarations. */
export function collectSlotRegistrations(source, file = null) {
  const text = String(source ?? '');
  const out = [];
  for (const match of text.matchAll(SLOT_REGISTER_RE)) {
    const body = match[1];
    const fields = {};
    for (const field of body.matchAll(STRING_FIELD_RE)) fields[field[1]] = field[2];
    for (const field of body.matchAll(NUMBER_FIELD_RE)) {
      if (fields[field[1]] === undefined) fields[field[1]] = Number(field[2]);
    }
    out.push({
      file,
      name: fields.name ?? null,
      id: fields.id ?? null,
      order: Number.isFinite(fields.order) ? fields.order : null,
      locale: fields.locale ?? null,
    });
  }
  return out;
}

/** Extract `defineTool({ name })` declarations (host half). */
export function collectToolNames(source, file = null) {
  const text = String(source ?? '');
  const out = [];
  for (const match of text.matchAll(TOOL_DEFINE_RE)) {
    const window = text.slice(match.index, match.index + TOOL_WINDOW);
    const nameMatch = TOOL_NAME_RE.exec(window);
    if (!nameMatch) continue;
    out.push({ file, name: nameMatch[1] });
  }
  return out;
}

function walkSourceFiles(dir, out = [], depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out, depth + 1);
      continue;
    }
    if (!SOURCE_EXTENSIONS.test(entry.name)) continue;
    if (fs.statSync(full).size > MAX_SCAN_FILE_BYTES) continue;
    out.push(full);
  }
  return out;
}

/**
 * Scan one package directory for loader ids, slot registrations, and tool
 * names. `dir` may be a pre-install source directory or a profile node_modules
 * entry; both have the same shape.
 */
export function scanPluginDeclarations(dir, options = {}) {
  const { name = null } = options;
  let { manifest = null } = options;
  if (!manifest) {
    const manifestFile = path.join(dir, 'package.json');
    if (fs.existsSync(manifestFile)) manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  }
  const result = {
    name: name ?? manifest?.name ?? path.basename(dir),
    dir,
    loaderIds: [],
    slotRegistrations: [],
    slotKeys: [],
    toolNames: [],
    files: [],
  };
  for (const relative of bundlePatchPathsOf(manifest)) {
    const file = path.resolve(dir, relative);
    if (!fs.existsSync(file)) continue;
    const ids = collectPatchIds(fs.readFileSync(file, 'utf8'));
    result.loaderIds.push(...ids.map((id) => ({ id, file })));
  }
  for (const file of walkSourceFiles(dir)) {
    const relative = path.relative(dir, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    result.files.push(relative);
    if (isClientFile(relative)) {
      result.slotRegistrations.push(...collectSlotRegistrations(source, relative));
    } else {
      result.toolNames.push(...collectToolNames(source, relative));
    }
  }
  result.slotKeys = [...new Set(result.slotRegistrations.map((entry) => entry.name).filter(Boolean))];
  return result;
}

function bundlePatchPathsOf(manifest) {
  const patch = manifest?.dsh?.bundle?.patch;
  if (patch === undefined) return [];
  const list = Array.isArray(patch) ? patch : [patch];
  return list.filter((item) => typeof item === 'string');
}

function ownersOf(map) {
  return [...map.entries()]
    .filter(([, owners]) => new Set(owners).size > 1)
    .map(([key, owners]) => ({ key, owners: [...new Set(owners)] }));
}

/**
 * Compare declarations across plugins and label each duplicate with its
 * namespace. Loader ids, slot-registration ids, and tool names are blockers;
 * sharing a slot key is normal and only informational.
 */
export function findDeclarationConflicts(entries = []) {
  const loaderOwners = new Map();
  const slotRegistrationOwners = new Map();
  const slotKeyOwners = new Map();
  const toolOwners = new Map();
  const add = (map, key, owner) => {
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), owner]);
  };

  for (const entry of entries) {
    const owner = entry.name ?? entry.dir ?? 'plugin';
    for (const item of entry.loaderIds ?? []) add(loaderOwners, item.id, owner);
    for (const item of entry.slotRegistrations ?? []) {
      if (item.id) add(slotRegistrationOwners, `${item.name ?? '(no-slot)'}#${item.id}`, owner);
    }
    for (const key of entry.slotKeys ?? []) add(slotKeyOwners, key, owner);
    for (const item of entry.toolNames ?? []) add(toolOwners, item.name, owner);
  }

  const findings = [];
  for (const conflict of ownersOf(loaderOwners)) {
    findings.push({
      id: 'duplicate-loader-id',
      namespace: 'loader',
      severity: 'blocker',
      message: `Loader/patch id ${conflict.key} is used by ${conflict.owners.join(', ')}`,
      owners: conflict.owners,
      key: conflict.key,
    });
  }
  for (const conflict of ownersOf(slotRegistrationOwners)) {
    findings.push({
      id: 'duplicate-slot-registration-id',
      namespace: 'slot-registration',
      severity: 'blocker',
      message: `Slot registration ${conflict.key} is registered by ${conflict.owners.join(', ')}`,
      owners: conflict.owners,
      key: conflict.key,
    });
  }
  for (const conflict of ownersOf(toolOwners)) {
    findings.push({
      id: 'duplicate-tool-name',
      namespace: 'tool',
      severity: 'blocker',
      message: `Tool name ${conflict.key} is declared by ${conflict.owners.join(', ')}`,
      owners: conflict.owners,
      key: conflict.key,
    });
  }
  for (const conflict of ownersOf(slotKeyOwners)) {
    findings.push({
      id: 'shared-slot-key',
      namespace: 'slot-key',
      severity: 'info',
      message: `Slot key ${conflict.key} is targeted by ${conflict.owners.join(', ')} (usually legitimate)`,
      owners: conflict.owners,
      key: conflict.key,
    });
  }
  return findings;
}
