import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COMMAND_TIMEOUT_MS, REAL_HOME } from './config.js';
import { canConnect } from './net-utils.js';
import { listProcessesByName } from './process-reaper.js';
import { runCommand } from './process-tree.js';
import { locateRuntime } from './runtime-locator.js';
import { ensureDir, readJson, writeJson } from './util.js';

/**
 * One-click installer for the bridge plugin.
 *
 * The bridge is a DSH profile plugin, so this edits the profile's structural
 * files directly (the desktop profile is managed by the Electron app and
 * refuses `dsh plugin add`), then runs the runtime's own pnpm.
 *
 * `cordis.patch.yml` is edited with text-level block surgery only: a real
 * profile contains custom `!!js` YAML tags and comments that a parse/rewrite
 * round-trip would destroy.
 */

export const BRIDGE_PLUGIN_NAME = 'dsh-plugin-effect-lab-bridge';
export const BRIDGE_PATCH_ID = 'effect-lab-bridge';
export const BRIDGE_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
export const BRIDGE_BACKUP_DIRNAME = '.lab-bridge-backup';
export const DSH_DESKTOP_PORT = 19387;
export const DSH_PROCESS_NAMES = ['DeepSeek Harness.exe'];

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root that contains `bin/lab.js` and `bridge-plugin/`. */
export function defaultLabPath() {
  return path.resolve(here, '..');
}

export function resolveBridgeLabPath(labPath) {
  return path.resolve(labPath ?? defaultLabPath());
}

export function bridgeDependencySpec(labPath) {
  const posix = path.resolve(labPath, 'bridge-plugin').replace(/\\/g, '/');
  return `file:${posix}`;
}

/* ------------------------------------------------------------------ *
 * cordis.patch.yml: text-level block surgery (never a YAML round-trip)
 * ------------------------------------------------------------------ */

function splitLines(text) {
  const raw = String(text ?? '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  return { lines, eol, endsWithNewline };
}

function joinLines(lines, eol, endsWithNewline = true) {
  const body = lines.join(eol);
  return endsWithNewline ? `${body}${eol}` : body;
}

function bridgeIdPattern() {
  return /^(\s*)-\s*id:\s*['"]?effect-lab-bridge['"]?\s*(?:#.*)?$/;
}

/**
 * Locate the `- id: effect-lab-bridge` top-level block. The block ends at the
 * next list item at the same or shallower indentation (nested `- ` items under
 * `config:` are indented deeper and stay inside the block).
 */
export function findBridgeBlock(text) {
  const { lines } = splitLines(text);
  const idRe = bridgeIdPattern();
  for (let start = 0; start < lines.length; start += 1) {
    const match = idRe.exec(lines[start]);
    if (!match) continue;
    const indent = match[1].length;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const item = /^(\s*)-\s/.exec(lines[index]);
      if (item && item[1].length <= indent) {
        end = index;
        break;
      }
    }
    return { start, end, indent };
  }
  return null;
}

function unquoteYamlScalar(raw) {
  let value = String(raw ?? '').trim();
  // Drop a trailing comment only when it is outside a quoted scalar.
  if (!/^['"]/.test(value)) value = value.replace(/\s+#.*$/, '').trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** The labPath value in the bridge block, or null when it is absent/blank. */
export function extractBridgeLabPath(text) {
  const block = findBridgeBlock(text);
  if (!block) return null;
  const { lines } = splitLines(text);
  const blockLines = lines.slice(block.start, block.end);
  const match = /^[ \t]*labPath:\s*(.+?)\s*$/.exec(blockLines.find((line) => /^[ \t]*labPath:/.test(line)) ?? '');
  if (!match) return null;
  const value = unquoteYamlScalar(match[1]);
  return value || null;
}

export function countBridgeBlocks(text) {
  const re = bridgeIdPattern();
  return splitLines(text).lines.filter((line) => re.test(line)).length;
}

export function bridgePatchBlock(labPath) {
  const quoted = `'${String(labPath).replace(/'/g, "''")}'`;
  return [
    `- id: ${BRIDGE_PATCH_ID}`,
    '  config:',
    `    labPath: ${quoted}`,
  ];
}

/**
 * Replace the existing bridge block, or append one. Everything else in the
 * file (comments, `!!js` tags, unrelated blocks) is copied byte-for-byte.
 */
export function rewriteBridgePatch(text, labPath) {
  const raw = String(text ?? '');
  const { lines, eol, endsWithNewline } = splitLines(raw);
  const block = findBridgeBlock(raw);
  const blockLines = bridgePatchBlock(labPath);
  if (block) {
    const next = [...lines.slice(0, block.start), ...blockLines, ...lines.slice(block.end)];
    return joinLines(next, eol, endsWithNewline);
  }
  const next = [...lines];
  if (next.length && next[next.length - 1].trim() !== '') next.push('');
  next.push(...blockLines);
  return joinLines(next, eol, true);
}

/** Remove only the bridge block; keep every other line. */
export function removeBridgePatch(text) {
  const raw = String(text ?? '');
  const block = findBridgeBlock(raw);
  if (!block) return raw;
  const { lines, eol } = splitLines(raw);
  const next = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  if (block.end >= lines.length) {
    while (next.length && next[next.length - 1].trim() === '') next.pop();
  }
  return next.length ? `${next.join(eol)}${eol}` : '';
}

/* ------------------------------------------------------------------ *
 * package.json planning
 * ------------------------------------------------------------------ */

/** Pure install/uninstall plan for the profile manifest. */
export function planBridgeManifest(manifest, options = {}) {
  const { action = 'install', dependencySpec } = options;
  const next = JSON.parse(JSON.stringify(manifest ?? {}));
  next.dependencies = { ...(next.dependencies ?? {}) };
  next.dsh = { ...(next.dsh ?? {}) };
  next.dsh.profile = { ...(next.dsh.profile ?? {}) };
  const bundles = Array.isArray(next.dsh.profile.bundles) ? [...next.dsh.profile.bundles] : [];
  if (action === 'install') {
    next.dependencies[BRIDGE_PLUGIN_NAME] = dependencySpec;
    if (!bundles.includes(BRIDGE_PLUGIN_NAME)) bundles.push(BRIDGE_PLUGIN_NAME);
    next.dsh.profile.bundles = bundles;
    return next;
  }
  delete next.dependencies[BRIDGE_PLUGIN_NAME];
  next.dsh.profile.bundles = bundles.filter((name) => name !== BRIDGE_PLUGIN_NAME);
  return next;
}

/* ------------------------------------------------------------------ *
 * filesystem helpers
 * ------------------------------------------------------------------ */

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

/** Copy the structural files into `<profile>/.lab-bridge-backup/<ts>/`. */
export function backupBridgeProfile(profileDir, options = {}) {
  const files = options.files ?? BRIDGE_FILES;
  const base = path.join(profileDir, BRIDGE_BACKUP_DIRNAME, backupStamp(options.now));
  let dir = base;
  for (let suffix = 2; fs.existsSync(dir); suffix += 1) dir = `${base}-${suffix}`;
  ensureDir(dir);
  const entries = [];
  const lines = [];
  for (const name of files) {
    const source = path.join(profileDir, name);
    if (fs.existsSync(source)) {
      const hash = sha256File(source);
      fs.copyFileSync(source, path.join(dir, name));
      entries.push({ name, exists: true, sha256: hash });
      lines.push(`${hash}  ${name}`);
    } else {
      entries.push({ name, exists: false, sha256: null });
      lines.push(`missing  ${name}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'BEFORE-HASHES.txt'), `${lines.join('\n')}\n`, 'utf8');
  return { dir, files, entries };
}

/** Restore the four structural files from a backup (rollback). */
export function restoreBridgeBackup(profileDir, backup) {
  for (const entry of backup.entries) {
    const target = path.join(profileDir, entry.name);
    if (entry.exists) {
      fs.copyFileSync(path.join(backup.dir, entry.name), target);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
}

function resolvePnpmScript(runtime) {
  const candidates = [
    runtime?.runtimeDir ? path.join(runtime.runtimeDir, 'pnpm', 'bin', 'pnpm.mjs') : null,
    runtime?.installDir ? path.join(runtime.installDir, 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.mjs') : null,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Default pnpm runner: the runtime's own pnpm, offline unless `online`. */
export async function runBridgePnpm(options = {}) {
  const { pnpmScript, profileDir, env, online = false, timeoutMs } = options;
  const args = [pnpmScript, 'install'];
  if (online !== true) args.push('--offline');
  const command = await runCommand(process.execPath, args, {
    cwd: profileDir,
    env,
    timeoutMs: timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  });
  return { ...command, ok: command.code === 0, args };
}

/* ------------------------------------------------------------------ *
 * DSH running detection
 * ------------------------------------------------------------------ */

/** True when the desktop app is listening and/or a DSH process exists. */
export async function detectDshRunning(options = {}) {
  const port = options.port ?? DSH_DESKTOP_PORT;
  const connect = options.connect ?? ((value) => canConnect(value, { timeoutMs: options.timeoutMs ?? 800 }));
  if (await connect(port)) return { running: true, reason: `port ${port} is listening` };
  const list = options.listProcesses ?? ((names) => listProcessesByName(names, options));
  const listed = list(DSH_PROCESS_NAMES) ?? { processes: [] };
  if (listed.processes?.length) {
    return {
      running: true,
      reason: `${listed.processes.length} DeepSeek Harness.exe process(es) are running`,
      processes: listed.processes.map((entry) => ({ pid: entry.pid, name: entry.name })),
    };
  }
  return { running: false, reason: `port ${port} closed and no DeepSeek Harness.exe process` };
}

/* ------------------------------------------------------------------ *
 * context
 * ------------------------------------------------------------------ */

function failure(errorCode, message, extra = {}) {
  return { ok: false, refused: true, errorCode, error: message, ...extra };
}

function resolveContext(options) {
  const home = path.resolve(options.home ?? REAL_HOME);
  const profile = String(options.profile ?? 'desktop').trim() || 'desktop';
  const profileDir = path.join(home, 'profiles', profile);
  const manifestFile = path.join(profileDir, 'package.json');
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const labPath = options.labPath ? resolveBridgeLabPath(options.labPath) : null;
  return { home, profile, profileDir, manifestFile, patchFile, labPath };
}

function requireProfile(context) {
  if (!fs.existsSync(context.manifestFile)) {
    return failure(
      'BRIDGE-PROFILE-MISSING',
      `profile "${context.profile}" has no package.json: ${context.manifestFile}`,
      { ...context },
    );
  }
  return null;
}

function requireRuntime(options) {
  try {
    return { runtime: locateRuntime(options.runtimePath) };
  } catch (error) {
    return { error: failure('BRIDGE-RUNTIME-MISSING', String(error?.message ?? error)) };
  }
}

function requireBridgePlugin(labPath) {
  const bridgeDir = path.join(labPath, 'bridge-plugin');
  const manifestFile = path.join(bridgeDir, 'package.json');
  if (!fs.existsSync(manifestFile)) {
    return failure('BRIDGE-PLUGIN-MISSING', `bridge plugin not found: ${manifestFile}`, { bridgeDir });
  }
  let manifest;
  try {
    manifest = readJson(manifestFile);
  } catch (error) {
    return failure('BRIDGE-PLUGIN-MISSING', `bridge plugin package.json is unreadable: ${String(error?.message ?? error)}`, { bridgeDir });
  }
  if (manifest.name !== BRIDGE_PLUGIN_NAME) {
    return failure(
      'BRIDGE-PLUGIN-NAME-MISMATCH',
      `bridge plugin package.json name is ${JSON.stringify(manifest.name)}, expected ${BRIDGE_PLUGIN_NAME}`,
      { bridgeDir },
    );
  }
  return { bridgeDir, manifest };
}

function dshRefusal(running, context) {
  return failure(
    'BRIDGE-DSH-RUNNING',
    `DSH desktop is running (${running.reason}); quit it completely (including the tray) first`,
    { ...context, dshRunning: running },
  );
}

function readPatchText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function installPlan(context) {
  const dependencySpec = bridgeDependencySpec(context.labPath);
  const manifest = readJson(context.manifestFile);
  const nextManifest = planBridgeManifest(manifest, { action: 'install', dependencySpec });
  const patchText = readPatchText(context.patchFile);
  const nextPatchText = rewriteBridgePatch(patchText, context.labPath);
  return {
    dependencySpec,
    manifest,
    nextManifest,
    patchText,
    nextPatchText,
    dependenciesChanged: JSON.stringify(manifest.dependencies ?? {}) !== JSON.stringify(nextManifest.dependencies ?? {}),
    bundlesChanged: JSON.stringify(manifest.dsh?.profile?.bundles ?? []) !== JSON.stringify(nextManifest.dsh?.profile?.bundles ?? []),
    patchChanged: patchText !== nextPatchText,
    patchCountBefore: countBridgeBlocks(patchText),
    patchCountAfter: countBridgeBlocks(nextPatchText),
  };
}

function uninstallPlan(context) {
  const manifest = readJson(context.manifestFile);
  const nextManifest = planBridgeManifest(manifest, { action: 'uninstall' });
  const patchText = readPatchText(context.patchFile);
  const nextPatchText = removeBridgePatch(patchText);
  return {
    manifest,
    nextManifest,
    patchText,
    nextPatchText,
    dependenciesChanged: BRIDGE_PLUGIN_NAME in (manifest.dependencies ?? {}),
    bundlesChanged: (manifest.dsh?.profile?.bundles ?? []).includes(BRIDGE_PLUGIN_NAME),
    patchChanged: patchText !== nextPatchText,
    patchCountBefore: countBridgeBlocks(patchText),
    patchCountAfter: countBridgeBlocks(nextPatchText),
  };
}

function describeChanges(plan) {
  return {
    dependenciesChanged: plan.dependenciesChanged,
    bundlesChanged: plan.bundlesChanged,
    patchChanged: plan.patchChanged,
    patchCountBefore: plan.patchCountBefore,
    patchCountAfter: plan.patchCountAfter,
  };
}

function writeManifest(context, manifest) {
  writeJson(context.manifestFile, manifest);
}

function readEnv(options) {
  return options.env ?? process.env;
}

async function runPnpm(context, options, runtime) {
  if (typeof options.runPnpm === 'function') {
    return options.runPnpm({
      pnpmScript: options.pnpmScript ?? null,
      profileDir: context.profileDir,
      env: readEnv(options),
      online: options.online === true,
      timeoutMs: options.installTimeoutMs,
    });
  }
  const pnpmScript = options.pnpmScript ?? resolvePnpmScript(runtime);
  if (!pnpmScript) {
    throw Object.assign(new Error('runtime pnpm not found (expected <runtime>/pnpm/bin/pnpm.mjs)'), { errorCode: 'BRIDGE-PNPM-MISSING' });
  }
  return runBridgePnpm({
    pnpmScript,
    profileDir: context.profileDir,
    env: readEnv(options),
    online: options.online === true,
    timeoutMs: options.installTimeoutMs,
  });
}

function verifyBridgeInstall(context) {
  const installedManifest = path.join(context.profileDir, 'node_modules', BRIDGE_PLUGIN_NAME, 'package.json');
  const manifest = readJson(context.manifestFile);
  const patchText = readPatchText(context.patchFile);
  return {
    nodeModulesPresent: fs.existsSync(installedManifest),
    dependencyPresent: manifest.dependencies?.[BRIDGE_PLUGIN_NAME] !== undefined,
    bundlePresent: (manifest.dsh?.profile?.bundles ?? []).includes(BRIDGE_PLUGIN_NAME),
    patchCount: countBridgeBlocks(patchText),
    labPath: extractBridgeLabPath(patchText),
  };
}

/* ------------------------------------------------------------------ *
 * actions
 * ------------------------------------------------------------------ */

export async function installBridge(options = {}) {
  const context = resolveContext(options);
  const profileError = requireProfile(context);
  if (profileError) return profileError;
  if (!context.labPath) return failure('BRIDGE-PLUGIN-MISSING', '--lab-path is required', context);
  const plugin = requireBridgePlugin(context.labPath);
  if (plugin.refused) return { ...plugin, ...context };
  context.bridgeDir = plugin.bridgeDir;
  const runtimeResult = requireRuntime(options);
  if (runtimeResult.error) return { ...runtimeResult.error, ...context };
  context.runtime = runtimeResult.runtime;

  const plan = installPlan(context);
  const running = await (options.isDshRunning ?? detectDshRunning)(options.dshRunning ?? {});

  if (options.dryRun === true) {
    return {
      ok: true,
      action: 'install',
      dryRun: true,
      ...context,
      dshRunning: running,
      changed: describeChanges(plan),
      dependencySpec: plan.dependencySpec,
      backupDir: null,
      pnpm: null,
      verify: null,
    };
  }
  if (running.running) return dshRefusal(running, context);

  const backup = backupBridgeProfile(context.profileDir, { now: options.now });
  try {
    writeManifest(context, plan.nextManifest);
    fs.writeFileSync(context.patchFile, plan.nextPatchText, 'utf8');
    const pnpm = await runPnpm(context, options, context.runtime);
    if (!pnpm.ok) {
      throw Object.assign(new Error(`pnpm install failed (exit ${pnpm.code}${pnpm.timedOut ? ', timeout' : ''})`), { pnpm, errorCode: 'BRIDGE-PNPM-FAILED' });
    }
    return {
      ok: true,
      action: 'install',
      dryRun: false,
      ...context,
      dshRunning: running,
      changed: describeChanges(plan),
      dependencySpec: plan.dependencySpec,
      backupDir: backup.dir,
      backup: backup.entries,
      pnpm,
      verify: verifyBridgeInstall(context),
    };
  } catch (error) {
    restoreBridgeBackup(context.profileDir, backup);
    let rollbackPnpm = null;
    try {
      rollbackPnpm = await runPnpm(context, options, context.runtime);
    } catch (rollbackError) {
      rollbackPnpm = { ok: false, error: String(rollbackError?.message ?? rollbackError) };
    }
    return {
      ok: false,
      action: 'install',
      ...context,
      errorCode: error?.errorCode ?? 'BRIDGE-INSTALL-FAILED',
      error: String(error?.message ?? error),
      rollback: true,
      backupDir: backup.dir,
      pnpm: error?.pnpm ?? null,
      rollbackPnpm,
    };
  }
}

export async function uninstallBridge(options = {}) {
  const context = resolveContext(options);
  const profileError = requireProfile(context);
  if (profileError) return profileError;
  const runtimeResult = requireRuntime(options);
  if (runtimeResult.error) return { ...runtimeResult.error, ...context };
  context.runtime = runtimeResult.runtime;

  const plan = uninstallPlan(context);
  const running = await (options.isDshRunning ?? detectDshRunning)(options.dshRunning ?? {});
  if (options.dryRun === true) {
    return {
      ok: true,
      action: 'uninstall',
      dryRun: true,
      ...context,
      dshRunning: running,
      changed: describeChanges(plan),
      backupDir: null,
    };
  }
  if (running.running) return dshRefusal(running, context);

  const backup = backupBridgeProfile(context.profileDir, { now: options.now });
  try {
    writeManifest(context, plan.nextManifest);
    if (plan.patchChanged) fs.writeFileSync(context.patchFile, plan.nextPatchText, 'utf8');
    const pnpm = await runPnpm(context, options, context.runtime);
    if (!pnpm.ok) {
      throw Object.assign(new Error(`pnpm install failed (exit ${pnpm.code}${pnpm.timedOut ? ', timeout' : ''})`), { pnpm, errorCode: 'BRIDGE-PNPM-FAILED' });
    }
    return {
      ok: true,
      action: 'uninstall',
      dryRun: false,
      ...context,
      dshRunning: running,
      changed: describeChanges(plan),
      backupDir: backup.dir,
      pnpm,
      verify: verifyBridgeInstall(context),
    };
  } catch (error) {
    restoreBridgeBackup(context.profileDir, backup);
    let rollbackPnpm = null;
    try {
      rollbackPnpm = await runPnpm(context, options, context.runtime);
    } catch (rollbackError) {
      rollbackPnpm = { ok: false, error: String(rollbackError?.message ?? rollbackError) };
    }
    return {
      ok: false,
      action: 'uninstall',
      ...context,
      errorCode: error?.errorCode ?? 'BRIDGE-UNINSTALL-FAILED',
      error: String(error?.message ?? error),
      rollback: true,
      backupDir: backup.dir,
      pnpm: error?.pnpm ?? null,
      rollbackPnpm,
    };
  }
}

export async function statusBridge(options = {}) {
  const context = resolveContext(options);
  const profileExists = fs.existsSync(context.manifestFile);
  let manifest = null;
  let manifestError = null;
  if (profileExists) {
    try {
      manifest = readJson(context.manifestFile);
    } catch (error) {
      manifestError = String(error?.message ?? error);
    }
  }
  const patchText = readPatchText(context.patchFile);
  const labPath = extractBridgeLabPath(patchText);
  const dependencySpec = manifest?.dependencies?.[BRIDGE_PLUGIN_NAME] ?? null;
  const bundlePresent = (manifest?.dsh?.profile?.bundles ?? []).includes(BRIDGE_PLUGIN_NAME);
  const nodeModulesPresent = fs.existsSync(path.join(context.profileDir, 'node_modules', BRIDGE_PLUGIN_NAME, 'package.json'));
  let runtime = null;
  try {
    runtime = locateRuntime(options.runtimePath);
  } catch {
    runtime = null;
  }
  const running = await (options.isDshRunning ?? detectDshRunning)(options.dshRunning ?? {});
  return {
    ok: true,
    action: 'status',
    ...context,
    profileExists,
    manifestError,
    installed: Boolean(dependencySpec && bundlePresent && nodeModulesPresent),
    dependencyPresent: Boolean(dependencySpec),
    dependencySpec,
    bundlePresent,
    nodeModulesPresent,
    patchCount: countBridgeBlocks(patchText),
    labPath,
    labPathExists: labPath ? fs.existsSync(labPath) : false,
    dshRunning: running,
    dshRunnable: !running.running,
    runtime: runtime ? { cmd: runtime.cmd, runtimeDir: runtime.runtimeDir, version: runtime.versions?.node ?? null } : null,
  };
}
