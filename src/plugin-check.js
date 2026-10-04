import fs from 'node:fs';
import { findDeclarationConflicts, scanPluginDeclarations } from './declaration-scanner.js';
import { validateManifest } from './manifest-validator.js';
import { readInstalledManifest, resolvePlugin } from './plugin-resolver.js';

const FIXES = {
  'duplicate-loader-id': 'Give each plugin a distinct loader/patch id.',
  'duplicate-slot-registration-id': 'Give each plugin a distinct slot registration id.',
  'duplicate-tool-name': 'Rename one of the tools; tool names share one namespace.',
};

/** Attach cross-plugin declaration conflicts, labelled by namespace. */
function attachDeclarationConflicts(entries) {
  const declarations = [];
  for (const entry of entries) {
    const dir = entry.resolved?.dir ?? entry.packageDir ?? null;
    const manifest = entry.manifest ?? entry.resolved?.manifest ?? null;
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const scanned = scanPluginDeclarations(dir, {
        manifest,
        name: entry.resolved?.name ?? manifest?.name ?? dir,
      });
      entry.declarations = scanned;
      declarations.push(scanned);
    } catch (error) {
      entry.declarationsError = String(error);
    }
  }
  if (declarations.length < 2) return;
  const conflicts = findDeclarationConflicts(declarations);
  for (const entry of entries) {
    const owner = entry.resolved?.name ?? entry.manifest?.name;
    if (!owner) continue;
    for (const conflict of conflicts) {
      if (!conflict.owners.includes(owner)) continue;
      entry.findings.push({
        id: conflict.id,
        namespace: conflict.namespace,
        severity: conflict.severity,
        message: conflict.message,
        fix: FIXES[conflict.id] ?? null,
        key: conflict.key,
      });
    }
  }
}

/** Resolve and statically validate plugins before installation. */
export function precheckPlugins(specs, runtimeVersion) {
  const entries = (specs ?? []).map((spec) => {
    const resolved = resolvePlugin(spec);
    if (!resolved.manifest) {
      return {
        resolved,
        findings: [{ id: 'manifest-deferred', severity: 'info', message: 'Manifest will be validated after install.' }],
        info: {},
      };
    }
    const result = validateManifest({
      manifest: resolved.manifest,
      runtimeVersion,
      packageDir: resolved.dir ?? null,
    });
    return { resolved, findings: result.findings, info: result.info };
  });
  attachDeclarationConflicts(entries);
  return entries;
}

/** Validate the actually installed package tree and detect cross-plugin duplicates. */
export function postcheckPlugins(entries, profileDir, runtimeVersion) {
  const updated = entries.map((entry) => {
    const name = entry.resolved.name;
    if (!name) return { ...entry, findings: [...entry.findings, { id: 'name-unknown', severity: 'warn', message: 'Installed package name could not be determined.' }] };
    const installed = readInstalledManifest(profileDir, name);
    if (!installed) {
      return {
        ...entry,
        findings: [...entry.findings, { id: 'install-missing', severity: 'blocker', message: `Package ${name} is not present in profile node_modules.` }],
      };
    }
    const result = validateManifest({
      manifest: installed.manifest,
      runtimeVersion,
      packageDir: installed.dir,
    });
    return { ...entry, manifest: installed.manifest, packageDir: installed.dir, findings: result.findings, info: result.info };
  });

  attachDeclarationConflicts(updated);
  return updated;
}

export function summarizePluginEntries(entries) {
  const findings = entries.flatMap((entry) => (entry.findings ?? []).map((item) => ({ plugin: entry.resolved.name ?? entry.resolved.spec, ...item })));
  const blockers = findings.filter((item) => item.severity === 'blocker');
  return { ok: blockers.length === 0, blockers, warnings: findings.filter((item) => item.severity === 'warn'), findings };
}
