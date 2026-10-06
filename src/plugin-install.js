import fs from 'node:fs';
import path from 'node:path';
import { findDeclarationConflicts, scanPluginDeclarations } from './declaration-scanner.js';
import { createFixtureWorkspace, seederPluginDir } from './fixture-manager.js';
import { removeTreeSafely } from './home-manager.js';
import { postcheckPlugins, precheckPlugins, summarizePluginEntries } from './plugin-check.js';
import { classifyInstallFailure } from './plugin-install-diagnostics.js';
import { appendBundles, detectAddedDependencies, removeBundles } from './profile-builder.js';
import { readInstalledManifest } from './plugin-resolver.js';
import { runCommand } from './process-tree.js';
import { parseNpmSpec } from './semver.js';
import { readJson } from './util.js';

/**
 * The profile plugin pipeline shared by `verify` and `shell`:
 *   precheck -> `dsh plugin add` -> append bundles -> postcheck.
 *
 * Returns stages instead of throwing so callers can attach their own checks;
 * `stage: 'precheck' | 'install'` means the caller must stop, while a failing
 * `postcheck` is reported and booting continues (the official CLI already
 * installed the tree, and boot is the authoritative check).
 */

const AUDIT_FIXES = {
  'duplicate-loader-id': 'Give each plugin a distinct loader/patch id.',
  'duplicate-slot-registration-id': 'Give each plugin a distinct slot registration id.',
  'duplicate-tool-name': 'Rename one of the tools; tool names share one namespace.',
};

/**
 * Audit every third-party package installed in the profile, not just the specs
 * of this run. Adding plugin B to a profile that already has A must report an
 * A+B conflict, which a per-run precheck cannot see.
 */
export function auditProfilePlugins(profileDir, version) {
  const manifest = readJson(path.join(profileDir, 'package.json'));
  const names = Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith('@deepseek-ai/'));
  const declarations = [];
  for (const name of names) {
    const installed = readInstalledManifest(profileDir, name);
    if (!installed) continue;
    try {
      declarations.push(scanPluginDeclarations(installed.dir, { manifest: installed.manifest, name }));
    } catch {
      // A package without scannable declarations simply does not participate.
    }
  }
  return {
    names,
    version,
    conflicts: declarations.length >= 2 ? findDeclarationConflicts(declarations) : [],
  };
}

/** Third-party packages currently installed in a profile. */
export function listInstalledProfilePlugins(profileDir) {
  const manifest = readJson(path.join(profileDir, 'package.json'));
  return Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith('@deepseek-ai/'));
}

/**
 * Give each precheck entry the package name pnpm actually installed.
 *
 * A directory/tarball spec already knows its manifest name. An npm spec knows
 * its requested name. A `github:` spec does not, so the newly added
 * dependencies are assigned to the still-unknown entries in install order.
 */
export function assignResolvedNames(entries, addedNames = []) {
  const remaining = [...addedNames];
  for (const entry of entries) {
    const name = entry.resolved?.name;
    if (!name) continue;
    const index = remaining.indexOf(name);
    if (index >= 0) remaining.splice(index, 1);
  }
  return entries.map((entry) => {
    if (entry.resolved?.name) return entry;
    const name = remaining.shift() ?? null;
    return { ...entry, resolved: { ...entry.resolved, name } };
  });
}

function installedVersion(profileDir, name, fallback = null) {
  if (!name) return fallback ?? null;
  const installed = readInstalledManifest(profileDir, name);
  return installed?.manifest?.version ?? fallback ?? null;
}

/**
 * The report-facing plugin list. `resolvedSpec` is the real
 * `name@version` read back from the installed profile, which is the whole
 * point when an author advertises a name that differs from the package name.
 */
export function pluginListFromEntries(entries, profileDir, options = {}) {
  const seederDir = options.seederDir ?? seederPluginDir();
  return entries.map((entry) => {
    const name = entry.resolved?.name ?? entry.manifest?.name ?? null;
    const version = installedVersion(profileDir, name, entry.manifest?.version ?? entry.resolved?.version ?? null);
    const resolvedSpec = name ? `${name}@${version ?? 'unknown'}` : null;
    return {
      name: name ?? entry.resolved?.spec,
      version,
      source: entry.resolved?.kind ?? null,
      spec: entry.resolved?.spec ?? null,
      advertisedSpec: entry.resolved?.spec ?? null,
      resolvedName: name,
      resolvedVersion: version,
      resolvedSpec,
      resolved: resolvedSpec,
      fixture: path.resolve(entry.resolved?.installSpec ?? '') === path.resolve(seederDir),
      findingSummary: {
        blockers: (entry.findings ?? []).filter((item) => item.severity === 'blocker').length,
        warnings: (entry.findings ?? []).filter((item) => item.severity === 'warn').length,
      },
    };
  });
}

/** Map a user selector (name, name@version, or a spec) onto an installed name. */
function matchInstalledPlugin(installed, selector) {
  const text = String(selector ?? '').trim();
  if (!text) return null;
  if (installed.includes(text)) return text;
  const name = parseNpmSpec(text)?.name ?? text;
  return installed.find((entry) => entry === name) ?? null;
}

/**
 * Remove plugins from a persistent profile: `dsh plugin remove` drops the
 * dependency and node_modules entry, then the bundle order is trimmed so the
 * profile still validates.
 *
 * Returns stages instead of throwing so the CLI can report unmatched selectors
 * next to the packages that really are installed.
 */
export async function removeProfilePlugins(options) {
  const {
    runtime,
    env,
    profileDir,
    profileName,
    plugins = [],
    timeoutMs,
  } = options;

  const installed = listInstalledProfilePlugins(profileDir);
  const targets = [];
  const unmatched = [];
  for (const selector of plugins) {
    const name = matchInstalledPlugin(installed, selector);
    if (!name) {
      unmatched.push(selector);
      continue;
    }
    if (!targets.includes(name)) targets.push(name);
  }

  if (!targets.length) {
    return {
      ok: false,
      stage: 'resolve',
      installed,
      targets,
      unmatched,
      removed: [],
      removeCommand: null,
      removeArgs: null,
    };
  }

  const args = ['plugin', '--profile', profileName, 'remove', ...targets];
  const removeCommand = await runCommand(runtime.cmd, args, {
    cwd: profileDir,
    env,
    timeoutMs,
  });
  if (removeCommand.code !== 0) {
    return {
      ok: false,
      stage: 'remove',
      installed,
      targets,
      unmatched,
      removed: [],
      removeCommand,
      removeArgs: args,
    };
  }

  const stillPresent = new Set(listInstalledProfilePlugins(profileDir));
  const removed = targets.filter((name) => !stillPresent.has(name));
  if (!removed.length) {
    // The command reported success but the dependency is still declared:
    // do not trim the bundle order for a plugin that is still installed.
    return {
      ok: false,
      stage: 'remove',
      installed,
      targets,
      unmatched,
      removed: [],
      removeCommand,
      removeArgs: args,
      reason: 'dependency-still-present',
    };
  }
  removeBundles(profileDir, removed);

  // pnpm prunes registry dependencies itself, but a `link:`/`file:` directory
  // dependency can leave its junction in node_modules after `remove`. Unlink it
  // with lstat-based removal so the plugin's source directory is never touched.
  for (const name of removed) {
    const entry = path.join(profileDir, 'node_modules', ...name.split('/'));
    let present = false;
    try {
      present = Boolean(fs.lstatSync(entry));
    } catch {
      present = false;
    }
    if (present) removeTreeSafely(entry);
  }

  return {
    ok: true,
    stage: 'removed',
    installed,
    targets,
    unmatched,
    removed,
    removeCommand,
    removeArgs: args,
  };
}

export async function installProfilePlugins(options) {
  const {
    runtime,
    env,
    profileDir,
    profileName,
    version,
    plugins = [],
    fixture = false,
    fixtureRoot = null,
    fixtureWorkspaceName = null,
    online = false,
    installTimeoutMs,
    seederDir = seederPluginDir(),
  } = options;

  const fixtureWorkspace = fixture && fixtureRoot
    ? createFixtureWorkspace(fixtureRoot, { name: fixtureWorkspaceName ?? undefined })
    : null;
  const installSpecs = fixture ? [...plugins, seederDir] : [...plugins];
  let entries = precheckPlugins(installSpecs, version);
  let summary = summarizePluginEntries(entries);
  const resolvedSpecs = entries.map((entry) => entry.resolved.installSpec);

  if (!summary.ok) {
    return {
      ok: false,
      stage: 'precheck',
      entries,
      summary,
      resolvedSpecs,
      validation: { stage: 'precheck', entries, summary },
      pluginList: [],
      install: null,
      fixtureWorkspace,
    };
  }

  const manifestBefore = readJson(path.join(profileDir, 'package.json'));
  let install = null;
  let installArgs = null;
  let profileAudit = null;
  if (resolvedSpecs.length) {
    const args = ['plugin', '--profile', profileName, 'add', ...resolvedSpecs];
    if (online !== true) args.push('--offline');
    installArgs = args;
    install = await runCommand(runtime.cmd, args, {
      cwd: profileDir,
      env,
      timeoutMs: installTimeoutMs,
    });
    if (install.code !== 0) {
      // Capture the pnpm reason here so every caller (verify, capture, shell)
      // reports the same detail and stable code instead of `exit 1`.
      const installDiagnosis = classifyInstallFailure(install);
      return {
        ok: false,
        stage: 'install',
        entries,
        summary,
        resolvedSpecs,
        validation: { stage: 'install', entries, summary },
        pluginList: [],
        install,
        installArgs,
        installDiagnosis,
        fixtureWorkspace,
      };
    }
    const added = detectAddedDependencies(manifestBefore, readJson(path.join(profileDir, 'package.json')));
    appendBundles(profileDir, added);
    entries = assignResolvedNames(entries, added);
    entries = postcheckPlugins(entries, profileDir, version);
    // Cross-plugin conflicts against everything already installed.
    profileAudit = auditProfilePlugins(profileDir, version);
    for (const entry of entries) {
      const owner = entry.resolved.name;
      if (!owner) continue;
      for (const conflict of profileAudit.conflicts) {
        if (!conflict.owners.includes(owner)) continue;
        entry.findings.push({
          id: conflict.id,
          namespace: conflict.namespace,
          severity: conflict.severity,
          message: `[profile] ${conflict.message}`,
          fix: AUDIT_FIXES[conflict.id] ?? null,
          key: conflict.key,
        });
      }
    }
    summary = summarizePluginEntries(entries);
  }

  return {
    ok: summary.ok,
    stage: 'postcheck',
    entries,
    summary,
    resolvedSpecs,
    validation: { stage: 'postcheck', entries, summary },
    pluginList: pluginListFromEntries(entries, profileDir, { seederDir }),
    install,
    installArgs,
    profileAudit,
    fixtureWorkspace,
  };
}
