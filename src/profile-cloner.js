import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from './process-tree.js';
import { readJson } from './util.js';

/**
 * Clone the structural files of a real DSH profile into an isolated lab
 * profile, so a plugin is tested from something close to the user's real
 * environment.
 *
 * Safety is structural, not advisory: this module only ever reads the
 * allowlisted files below. It never walks the profile root and therefore can
 * never read `.credentials.yaml`, `settings.yaml`, `sessions/`, `agents/`, or
 * `node_modules/`. `node_modules` is rebuilt from the copied lockfile with the
 * official runtime's pnpm; the real 296 MB tree is never copied.
 */

export const CLONE_KINDS = ['web', 'desktop'];

/** The only regular files a clone may read from the real profile. */
export const CLONE_FILES = [
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  // DSH stores exact-version peer exemptions here; carrying it means a clone
  // inherits the same compatibility decisions as the real profile.
  'compatibility.json',
];

/** The only directory a clone may read from the real profile (regular files only). */
export const CLONE_DIRS = ['patches'];

/** Directories/files that must never appear in a clone result. */
export const FORBIDDEN_CLONE_ENTRIES = ['node_modules', 'sessions', 'agents', '.credentials.yaml', 'settings.yaml'];

const LOCAL_SPEC = /^(?:file|link):/i;

export function assertCloneKind(kind) {
  const text = String(kind ?? '');
  if (!CLONE_KINDS.includes(text)) {
    throw new Error(`--clone-profile must be one of ${CLONE_KINDS.join('|')}, got ${JSON.stringify(text)}`);
  }
  return text;
}

export function cloneSourceDir(realHome, kind) {
  return path.join(path.resolve(realHome), 'profiles', assertCloneKind(kind));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function walkRegularFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue; // never follow a link out of the profile
    if (stat.isDirectory()) {
      out.push(...walkRegularFiles(full, relative));
      continue;
    }
    if (stat.isFile()) out.push({ full, relative });
  }
  return out;
}

/**
 * SHA-256 snapshot of exactly the files a clone reads. Used as a hard
 * before/after assertion that the clone never modified the real profile.
 */
export function snapshotCloneSource(realHome, kind) {
  const dir = cloneSourceDir(realHome, kind);
  const files = [];
  for (const name of CLONE_FILES) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) {
      files.push({ relative: name, exists: false });
      continue;
    }
    const stat = fs.statSync(full);
    files.push({ relative: name, exists: true, size: stat.size, sha256: sha256(full) });
  }
  for (const sub of CLONE_DIRS) {
    const full = path.join(dir, sub);
    if (!fs.existsSync(full)) continue;
    for (const file of walkRegularFiles(full)) {
      const stat = fs.statSync(file.full);
      files.push({
        relative: `${sub}/${file.relative}`,
        exists: true,
        size: stat.size,
        sha256: sha256(file.full),
      });
    }
  }
  const hash = crypto
    .createHash('sha256')
    .update(files.map((file) => `${file.relative}:${file.sha256 ?? 'missing'}`).join('\n'))
    .digest('hex')
    .toUpperCase();
  return { kind: assertCloneKind(kind), dir, hash, files, capturedAt: new Date().toISOString() };
}

export function diffCloneSource(before, after) {
  const changed = [];
  const keys = new Set([...(before?.files ?? []).map((f) => f.relative), ...(after?.files ?? []).map((f) => f.relative)]);
  for (const key of keys) {
    const a = (before?.files ?? []).find((file) => file.relative === key) ?? { exists: false };
    const b = (after?.files ?? []).find((file) => file.relative === key) ?? { exists: false };
    if (a.exists !== b.exists || a.sha256 !== b.sha256 || a.size !== b.size) {
      changed.push({ file: key, before: a, after: b });
    }
  }
  return { ok: changed.length === 0, changed };
}

/** `file:` / `link:` / absolute / relative path dependency. */
export function classifyLocalSpec(spec) {
  const text = String(spec ?? '').trim();
  if (!text) return null;
  if (LOCAL_SPEC.test(text)) return /^link:/i.test(text) ? 'link' : 'file';
  if (text.startsWith('.') || path.isAbsolute(text)) return 'path';
  return null;
}

/**
 * Compute the clone result without writing anything: filtered dependencies,
 * trimmed bundle order, excluded and local plugins, source snapshot.
 */
export function planClone(options = {}) {
  const {
    realHome,
    kind,
    plugins = 'all',
    exclude = [],
    dropLocal = false,
  } = options;
  const profileKind = assertCloneKind(kind);
  const sourceDir = cloneSourceDir(realHome, profileKind);
  const manifestFile = path.join(sourceDir, 'package.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`real ${profileKind} profile has no package.json: ${sourceDir}`);
  const manifest = readJson(manifestFile);
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const localPlugins = Object.entries(dependencies)
    .map(([name, spec]) => ({ name, spec, kind: classifyLocalSpec(spec) }))
    .filter((entry) => entry.kind);
  const selectors = new Set((exclude ?? []).map((value) => String(value).trim()).filter(Boolean));
  const excluded = [];
  const droppedLocal = [];
  const mode = plugins === 'none' ? 'none' : 'all';
  for (const [name, spec] of Object.entries(dependencies)) {
    if (mode === 'none' && !name.startsWith('@deepseek-ai/')) {
      excluded.push({ name, spec, reason: 'clone-plugins-none' });
      delete dependencies[name];
      continue;
    }
    if (selectors.has(name) || selectors.has(spec)) {
      excluded.push({ name, spec, reason: 'clone-exclude' });
      delete dependencies[name];
      continue;
    }
    if (dropLocal && classifyLocalSpec(spec)) {
      droppedLocal.push({ name, spec });
      delete dependencies[name];
    }
  }
  const kept = new Set(Object.keys(dependencies));
  const bundles = (manifest.dsh?.profile?.bundles ?? [])
    .filter((name) => String(name).startsWith('@deepseek-ai/') || kept.has(name));
  const nextManifest = {
    ...manifest,
    dependencies,
    ...(manifest.dsh
      ? { dsh: { ...manifest.dsh, profile: { ...(manifest.dsh.profile ?? {}), bundles } } }
      : {}),
  };
  return {
    kind: profileKind,
    sourceDir,
    sourceSnapshot: snapshotCloneSource(realHome, profileKind),
    plugins: mode,
    manifest: nextManifest,
    dependencies,
    bundles,
    localPlugins,
    excluded,
    droppedLocal,
    forbiddenEntries: FORBIDDEN_CLONE_ENTRIES,
  };
}

function inside(parent, child) {
  const p = path.resolve(parent).toLowerCase();
  const c = path.resolve(child).toLowerCase();
  return c === p || c.startsWith(`${p}${path.sep}`);
}

function copyRegularFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/**
 * Copy the allowlisted structural files into `profileDir` (an isolated
 * directory), then write the filtered package.json. Never copies
 * `node_modules`, credentials, sessions, or agents.
 */
export function cloneProfileInto(options = {}) {
  const { realHome, kind, profileDir } = options;
  const plan = planClone(options);
  const target = path.resolve(profileDir);
  if (inside(realHome, target)) {
    throw new Error(`clone target must not be inside the real home: ${target}`);
  }
  if (fs.existsSync(path.join(target, 'package.json'))) {
    throw new Error(`clone target already has a profile: ${target}`);
  }
  const source = plan.sourceDir;
  const copiedFiles = [];
  for (const name of CLONE_FILES) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) continue;
    copyRegularFile(from, path.join(target, name));
    copiedFiles.push(name);
  }
  const copiedPatches = [];
  for (const sub of CLONE_DIRS) {
    const from = path.join(source, sub);
    if (!fs.existsSync(from)) continue;
    for (const file of walkRegularFiles(from)) {
      const targetFile = path.join(target, sub, file.relative);
      copyRegularFile(file.full, targetFile);
      copiedPatches.push(`${sub}/${file.relative}`);
    }
  }
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(plan.manifest, null, 2)}\n`, 'utf8');
  const sourceAfter = snapshotCloneSource(realHome, plan.kind);
  const diff = diffCloneSource(plan.sourceSnapshot, sourceAfter);
  if (!diff.ok) {
    throw new Error(`clone modified the real ${plan.kind} profile: ${diff.changed.map((item) => item.file).join(', ')}`);
  }
  const forbiddenPresent = FORBIDDEN_CLONE_ENTRIES.filter((name) => fs.existsSync(path.join(target, name)));
  if (forbiddenPresent.length) {
    throw new Error(`clone leaked forbidden entries: ${forbiddenPresent.join(', ')}`);
  }
  return {
    kind: plan.kind,
    sourceDir: source,
    targetDir: target,
    plugins: plan.plugins,
    sourceSnapshot: plan.sourceSnapshot,
    // The hard assertion: the real source hashes are identical after copying.
    sourceUnchangedAfterCopy: diff.ok,
    copiedFiles,
    copiedPatches,
    nodeModulesCopied: false,
    credentialsCopied: false,
    dependencies: plan.dependencies,
    bundles: plan.bundles,
    localPlugins: plan.localPlugins,
    excluded: plan.excluded,
    droppedLocal: plan.droppedLocal,
  };
}

function installedNames(profileDir, dependencies) {
  const installed = [];
  const missing = [];
  for (const name of Object.keys(dependencies ?? {})) {
    const dir = path.join(profileDir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(dir, 'package.json'))) installed.push(name);
    else missing.push(name);
  }
  return { installed, missing };
}

/** Plugins DSH's post-install compatibility gate reported as incompatible. */
export function parseIncompatiblePlugins(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(/Plugin\s+(@?[A-Za-z0-9@/._-]+)@([0-9][^\s:,)]*)\s+is incompatible/gi)) {
    const key = `${match[1]}@${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: match[1], version: match[2] });
  }
  return out;
}

/**
 * Rebuild node_modules with the official runtime's pnpm, offline. Never
 * copies the real node_modules. A non-zero exit is reported, not swallowed.
 */
export async function rebuildClonedProfile(options = {}) {
  const {
    runtime,
    env,
    profileDir,
    profileName,
    timeoutMs,
    runCommandImpl = runCommand,
  } = options;
  const dependencies = readJson(path.join(profileDir, 'package.json')).dependencies ?? {};
  const args = ['plugin', '--profile', profileName, 'install', '--offline', '--no-frozen-lockfile'];
  const command = await runCommandImpl(runtime.cmd, args, { cwd: profileDir, env, timeoutMs });
  const { installed, missing } = installedNames(profileDir, dependencies);
  const output = `${command.stdout}\n${command.stderr}`;
  return {
    ok: command.code === 0,
    code: command.code,
    timedOut: command.timedOut === true,
    args,
    durationMs: command.durationMs,
    stdout: command.stdout,
    stderr: command.stderr,
    // DSH's post-install compatibility gate rejects a profile whose plugins
    // do not match the runtime. That is the expected "clone went red" case.
    rejected: /installation rejected/i.test(output),
    incompatible: parseIncompatiblePlugins(output),
    installed,
    missing,
  };
}

/**
 * Grant the exact-version exemptions DSH's compatibility gate asked for, in
 * the isolated clone only. This is what lets a peer-mismatched real plugin
 * actually load in the clone instead of being denied at startup.
 *
 * The real profile is never touched: the command runs with the isolated
 * `DSH_HOME` and `cwd = <clone profile>`.
 */
export async function grantClonedProfileExemptions(options = {}) {
  const {
    runtime,
    env,
    profileDir,
    profileName,
    runtimeVersion,
    incompatible = [],
    timeoutMs,
    runCommandImpl = runCommand,
  } = options;
  const granted = [];
  const failures = [];
  for (const plugin of incompatible) {
    if (!plugin?.name || !plugin?.version || !runtimeVersion) {
      failures.push({ ...plugin, reason: 'incomplete package version or runtime version' });
      continue;
    }
    const args = [
      'plugin',
      '--profile', profileName,
      'allow-version', `${plugin.name}@${plugin.version}`,
      '--dsh-version', runtimeVersion,
      '--accept-risk',
    ];
    let command;
    try {
      command = await runCommandImpl(runtime.cmd, args, { cwd: profileDir, env, timeoutMs });
    } catch (error) {
      failures.push({ ...plugin, reason: String(error?.message ?? error) });
      continue;
    }
    if (command.code === 0) granted.push(plugin);
    else failures.push({ ...plugin, reason: `exit ${command.code}: ${(command.stderr || command.stdout || '').trim().slice(0, 400)}` });
  }
  return { granted, failures };
}
