import path from 'node:path';
import { findDeclarationConflicts, scanPluginDeclarations } from './declaration-scanner.js';
import { createFixtureWorkspace, seederPluginDir } from './fixture-manager.js';
import { postcheckPlugins, precheckPlugins, summarizePluginEntries } from './plugin-check.js';
import { appendBundles, detectAddedDependencies } from './profile-builder.js';
import { readInstalledManifest } from './plugin-resolver.js';
import { runCommand } from './process-tree.js';
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
    online = false,
    installTimeoutMs,
    seederDir = seederPluginDir(),
  } = options;

  const fixtureWorkspace = fixture && fixtureRoot ? createFixtureWorkspace(fixtureRoot) : null;
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
        fixtureWorkspace,
      };
    }
    const added = detectAddedDependencies(manifestBefore, readJson(path.join(profileDir, 'package.json')));
    appendBundles(profileDir, added);
    entries = entries.map((entry) => {
      if (entry.resolved.name) return entry;
      const remaining = added.filter((name) => !entries.some((other) => other.resolved.name === name));
      return { ...entry, resolved: { ...entry.resolved, name: remaining[0] ?? entry.resolved.name } };
    });
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
    pluginList: entries.map((entry) => ({
      name: entry.resolved.name ?? entry.resolved.spec,
      version: entry.manifest?.version ?? entry.resolved.version ?? null,
      source: entry.resolved.kind,
      spec: entry.resolved.spec,
      fixture: path.resolve(entry.resolved.installSpec ?? '') === path.resolve(seederDir),
      findingSummary: {
        blockers: entry.findings.filter((item) => item.severity === 'blocker').length,
        warnings: entry.findings.filter((item) => item.severity === 'warn').length,
      },
    })),
    install,
    installArgs,
    profileAudit,
    fixtureWorkspace,
  };
}
