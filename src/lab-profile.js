import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTreeSafely } from './home-manager.js';
import { parseNpmSpec } from './semver.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Persistent, reusable lab profiles.
 *
 * A profile is still fully isolated: it lives under `<project>/.lab-profiles/`
 * (git-ignored) and never touches the real `~/.dsh`. Unlike a one-shot run it
 * survives between commands, so plugins stay installed and several plugins can
 * be added over time to study how they interact.
 */

export const LAB_PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const LAB_PROFILE_MANIFEST = 'lab-profile.json';

export function labProfilesRoot() {
  if (process.env.DSH_LAB_PROFILES) return path.resolve(process.env.DSH_LAB_PROFILES);
  return path.resolve(here, '..', '.lab-profiles');
}

/** Reject names that could escape the profiles root or confuse the CLI. */
export function assertSafeProfileName(name) {
  const text = String(name ?? '');
  if (!LAB_PROFILE_NAME_PATTERN.test(text)) {
    throw new Error(`invalid lab profile name: ${JSON.stringify(text)} (use [a-z0-9._-], max 32 chars)`);
  }
  return text;
}

function inside(parent, child) {
  const p = path.resolve(parent).toLowerCase();
  const c = path.resolve(child).toLowerCase();
  return c === p || c.startsWith(`${p}${path.sep}`);
}

export function assertSafeProfileDir(dir) {
  const root = labProfilesRoot();
  const resolved = path.resolve(dir);
  if (!inside(root, resolved) || resolved.toLowerCase() === root.toLowerCase()) {
    throw new Error(`unsafe lab profile path: ${resolved} is outside ${root}`);
  }
  return resolved;
}

export function labProfileDir(name) {
  return assertSafeProfileDir(path.join(labProfilesRoot(), assertSafeProfileName(name)));
}

export function readLabProfile(name) {
  const dir = labProfileDir(name);
  const manifestFile = path.join(dir, LAB_PROFILE_MANIFEST);
  if (!fs.existsSync(manifestFile)) return null;
  return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
}

/**
 * Whether a lab profile target already exists: either its manifest is present
 * or it already holds a DSH profile package.json. Used to refuse a clone into
 * an existing profile unless --force was passed.
 */
export function profileExists(name) {
  const dir = labProfileDir(name);
  if (!fs.existsSync(dir)) return false;
  if (fs.existsSync(path.join(dir, LAB_PROFILE_MANIFEST))) return true;
  return fs.existsSync(path.join(dir, 'home', 'profiles', `lab-${name}`, 'package.json'));
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, LAB_PROFILE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Create the profile skeleton if needed; returns its manifest. */
export function createLabProfile(name, options = {}) {
  const dir = labProfileDir(name);
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  const existing = readLabProfile(name);
  if (existing) return { dir, manifest: existing, created: false };
  const manifest = {
    name: assertSafeProfileName(name),
    createdAt: options.now ?? new Date().toISOString(),
    plugins: [],
  };
  writeManifest(dir, manifest);
  return { dir, manifest, created: true };
}

/**
 * Record the specs that were installed into the profile.
 *
 * Each entry also stores the resolved package `name` when the caller knows it
 * (the runners do), so a later `remove-plugin` can match a bare package name
 * even for a local-directory or tarball spec whose recorded `spec` is a path.
 */
export function recordProfilePlugins(name, specs, options = {}) {
  const { dir, manifest } = createLabProfile(name);
  const known = new Set((manifest.plugins ?? []).map((entry) => entry.spec));
  for (const raw of specs) {
    const spec = typeof raw === 'string' ? raw : raw?.spec;
    if (!spec || known.has(spec)) continue;
    known.add(spec);
    const entry = { spec, addedAt: options.now ?? new Date().toISOString() };
    const resolvedName = typeof raw === 'string' ? null : raw?.name;
    if (resolvedName) entry.name = resolvedName;
    manifest.plugins.push(entry);
  }
  writeManifest(dir, manifest);
  return manifest;
}

/**
 * Mark a lab profile as a clone of a real profile:
 * `{ kind, at, sourceHash, copiedFiles, excluded, ... }`.
 */
export function recordProfileClone(name, clonedFrom) {
  const { dir, manifest } = createLabProfile(name);
  manifest.clonedFrom = clonedFrom;
  writeManifest(dir, manifest);
  return manifest;
}

/** The package name a recorded entry answers to, from its name or its spec. */
export function profilePluginName(entry) {
  if (entry?.name) return entry.name;
  return entry?.spec ? parseNpmSpec(entry.spec)?.name ?? null : null;
}

/**
 * Whether a recorded manifest entry refers to `selector`, which may be an
 * exact spec, a bare package name, or `name@version`.
 */
export function profilePluginMatches(entry, selector) {
  const text = String(selector ?? '').trim();
  if (!text) return false;
  if (entry?.spec === text || entry?.name === text) return true;
  const wanted = parseNpmSpec(text)?.name ?? text;
  return profilePluginName(entry) === wanted;
}

/**
 * Forget recorded plugin specs after they were removed from the profile.
 * Returns the entries that matched so the caller can report them.
 */
export function forgetProfilePlugins(name, selectors) {
  const { dir, manifest } = createLabProfile(name);
  const wanted = (selectors ?? []).filter(Boolean);
  const removed = [];
  const kept = [];
  for (const entry of manifest.plugins ?? []) {
    if (wanted.some((selector) => profilePluginMatches(entry, selector))) removed.push(entry);
    else kept.push(entry);
  }
  manifest.plugins = kept;
  writeManifest(dir, manifest);
  return { dir, manifest, removed };
}

/**
 * Open a profile as an isolated-home handle with the same shape as
 * `createIsolatedHome`, so the runners can use either one.
 */
export function openLabProfileHome(name, options = {}) {
  const { dir, manifest } = createLabProfile(name, options);
  return {
    persistent: true,
    name: manifest.name,
    root: dir,
    home: path.join(dir, 'home'),
    agents: path.join(dir, 'agents'),
    tmp: path.join(dir, 'tmp'),
    profileDir(profileName) {
      assertSafeProfileDir(dir);
      return path.join(dir, 'home', 'profiles', profileName);
    },
    async dispose() {
      // Persistent profiles are deliberately kept between runs.
      return { removed: false, kept: true, root: dir };
    },
  };
}

export function listLabProfiles() {
  const root = labProfilesRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !LAB_PROFILE_NAME_PATTERN.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, LAB_PROFILE_MANIFEST), 'utf8'));
    } catch {
      manifest = null;
    }
    // Optional detail for the GUI list. The DSH profile inside a lab profile
    // is always `lab-<name>` (see the runners).
    const dshProfileDir = path.join(dir, 'home', 'profiles', `lab-${entry.name}`);
    let dshPackage = null;
    try {
      dshPackage = JSON.parse(fs.readFileSync(path.join(dshProfileDir, 'package.json'), 'utf8'));
    } catch {
      dshPackage = null;
    }
    const dependencies = Object.keys(dshPackage?.dependencies ?? {}).filter((name) => !name.startsWith('@deepseek-ai/'));
    let lastRunAt = null;
    if (fs.existsSync(dshProfileDir)) {
      try {
        lastRunAt = fs.statSync(dshProfileDir).mtimeMs;
      } catch {
        lastRunAt = null;
      }
    }
    out.push({
      name: entry.name,
      dir,
      plugins: manifest?.plugins ?? [],
      clonedFrom: manifest?.clonedFrom ?? null,
      createdAt: manifest?.createdAt ?? null,
      mtimeMs: fs.statSync(dir).mtimeMs,
      nodeModulesExists: fs.existsSync(path.join(dshProfileDir, 'node_modules')),
      dependenciesCount: dependencies.length,
      bundlesCount: (dshPackage?.dsh?.profile?.bundles ?? []).length,
      lastRunAt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete a lab profile. Uses the lstat-based `removeTreeSafely` so a
 * `file:`/`link:` junction in `node_modules` is unlinked, never followed into
 * the plugin source. A locked profile returns a readable error instead of
 * looping forever.
 */
export function removeLabProfile(name) {
  const dir = labProfileDir(name);
  if (!fs.existsSync(dir)) return { removed: false, dir };
  try {
    removeTreeSafely(dir);
  } catch (error) {
    return {
      removed: false,
      dir,
      error: `lab profile "${name}" could not be removed (it may be in use by a running lab process): ${String(error?.message ?? error)}`,
    };
  }
  return { removed: !fs.existsSync(dir), dir };
}
