import fs from 'node:fs';
import path from 'node:path';
import { rangeIncludesPrerelease, satisfies } from './semver.js';

function finding(id, severity, message, fix = null) {
  return { id, severity, message, fix };
}

export function bundlePatchPaths(manifest) {
  const patch = manifest?.dsh?.bundle?.patch;
  if (patch === undefined) return [];
  const list = Array.isArray(patch) ? patch : [patch];
  return list.filter((item) => typeof item === 'string');
}

export function declaredRange(manifest) {
  return manifest?.engines?.dsh
    ?? manifest?.engines?.framework
    ?? manifest?.dsh?.compatibility?.dsh
    ?? null;
}

export function collectPatchIds(text) {
  const ids = [];
  const re = /^\s*-\s*id:\s*["']?([^\s"'#]+)/gm;
  let match;
  while ((match = re.exec(String(text ?? '')))) ids.push(match[1]);
  return ids;
}

function walkJsFiles(dir, out = [], depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, out, depth + 1);
    else if (/\.(js|cjs|mjs)$/.test(entry.name) && fs.statSync(full).size <= 4 * 1024 * 1024) out.push(full);
  }
  return out;
}

export const KNOWN_API_PATTERNS = [
  { id: 'settings-scope-removed', pattern: /\.settingsScope\b|["']settingsScope["']/, severity: 'warn', message: 'Uses settingsScope, which is a 0.1.x surface; 0.2.x uses configForms.' },
  { id: 'forms-configure-required', pattern: /\.forms\.configure\b|["']configForms["']/, severity: 'info', message: 'Uses the 0.2.x configForms service; requires dsh 0.2.x.' },
  { id: 'sessions-open-legacy', pattern: /\.sessions\.open\s*\(/, severity: 'warn', message: 'Uses sessions.open; 0.2.x prefers uiWorkspace.openSession.' },
  { id: 'schemastery-volatile', pattern: /\.volatile\s*\(/, severity: 'info', message: 'Uses schemastery .volatile(); requires schemastery >= 3.18.4.' },
];

export function scanKnownApis(packageDir) {
  const hits = [];
  for (const file of walkJsFiles(packageDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const known of KNOWN_API_PATTERNS) {
      if (known.pattern.test(text)) hits.push({ id: known.id, severity: known.severity, message: known.message, file });
    }
  }
  return hits;
}

/**
 * Validate one plugin manifest against the 0.2.0-rc.2 runtime.
 * `packageDir` enables on-disk bundle patch, entry, and API checks.
 */
export function validateManifest(options) {
  const {
    manifest,
    runtimeVersion,
    packageDir = null,
    allPatchIds = null,
  } = options;
  const findings = [];
  const info = {};
  if (!manifest || typeof manifest !== 'object') {
    return { findings: [finding('manifest-missing', 'blocker', 'package.json is missing or invalid')], info };
  }
  if (!manifest.name) findings.push(finding('name-missing', 'blocker', 'package.json has no name'));
  if (!manifest.version) findings.push(finding('version-missing', 'blocker', 'package.json has no version'));

  const range = declaredRange(manifest);
  info.declaredRange = range;
  if (range) {
    info.rangeSatisfied = satisfies(runtimeVersion, range);
    if (!info.rangeSatisfied) {
      const tolerant = rangeIncludesPrerelease(range)
        && satisfies(runtimeVersion, range, { includePrerelease: true });
      info.rangeSatisfiedWithPrerelease = tolerant;
      if (tolerant) {
        findings.push(finding('engines-prerelease-range', 'warn', `Declared range ${range} accepts runtime ${runtimeVersion} only under semver prerelease tolerance`, 'Name the 0.2.0-rc.x tuple in the range to make support explicit.'));
      } else {
        findings.push(finding('engines-incompatible', 'blocker', `Declared range ${range} does not accept runtime ${runtimeVersion}`, 'Update the plugin engines range or use a compatible plugin build.'));
      }
    }
  } else {
    findings.push(finding('engines-missing', 'warn', 'No engines.dsh / engines.framework / dsh.compatibility.dsh declaration', 'Add an explicit runtime range for upgrade safety.'));
  }

  const peers = manifest.peerDependencies ?? {};
  info.peers = {};
  for (const [name, peerRange] of Object.entries(peers)) {
    const hostProvided = name.startsWith('@deepseek-ai/');
    const checkAgainstHost = hostProvided && /^@deepseek-ai\/dsh-/.test(name);
    const satisfied = checkAgainstHost ? satisfies(runtimeVersion, peerRange) : null;
    const tolerant = checkAgainstHost && satisfied === false
      && rangeIncludesPrerelease(peerRange)
      && satisfies(runtimeVersion, peerRange, { includePrerelease: true });
    info.peers[name] = { range: peerRange, hostProvided, satisfied: satisfied === true, prereleaseTolerant: tolerant === true };
    if (checkAgainstHost && satisfied === false) {
      if (tolerant) {
        findings.push(finding('peer-prerelease-range', 'warn', `Peer ${name}@${peerRange} accepts runtime ${runtimeVersion} only under semver prerelease tolerance`, 'Name the 0.2.0-rc.x tuple in the peer range to make support explicit.'));
      } else {
        findings.push(finding('peer-incompatible', 'blocker', `Peer ${name}@${peerRange} rejects runtime ${runtimeVersion}`, 'Use a plugin build whose peer range matches 0.2.0-rc.2.'));
      }
    }
    if (!hostProvided && manifest.peerDependenciesMeta?.[name]?.optional !== true) {
      findings.push(finding('peer-profile-required', 'info', `Peer ${name} must be installed in the profile`, 'Install the peer or mark it optional.'));
    }
  }

  const patches = bundlePatchPaths(manifest);
  info.bundlePatches = patches;
  if (!patches.length) {
    findings.push(finding('bundle-patch-missing', 'warn', 'No dsh.bundle.patch declared; the plugin will not mount as a bundle.', 'Add dsh.bundle.patch pointing at the cordis patch file.'));
  }
  const ids = [];
  for (const relative of patches) {
    if (!packageDir) continue;
    const file = path.resolve(packageDir, relative);
    if (!fs.existsSync(file)) {
      findings.push(finding('bundle-patch-file-missing', 'blocker', `Bundle patch file not found: ${relative}`, 'Publish the patch file or fix dsh.bundle.patch.'));
      continue;
    }
    ids.push(...collectPatchIds(fs.readFileSync(file, 'utf8')));
  }
  info.patchIds = ids;
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    findings.push(finding('duplicate-patch-id', 'blocker', `Duplicate patch ids inside this plugin: ${[...new Set(duplicateIds)].join(', ')}`, 'Keep one loader entry per id.'));
  }
  if (allPatchIds) {
    const cross = ids.filter((id) => allPatchIds.has(id));
    if (cross.length) findings.push(finding('duplicate-cross-plugin-id', 'blocker', `Patch ids already used by another plugin: ${[...new Set(cross)].join(', ')}`, 'Prefix ids per plugin.'));
  }

  const client = manifest.dsh?.client;
  info.client = client ?? null;
  if (client) {
    if (client.platform && client.platform !== 'web') {
      findings.push(finding('client-platform', 'warn', `dsh.client.platform is ${client.platform}, not web`, 'Desktop shell fidelity is a later phase.'));
    }
    if (!manifest.exports?.['./client']) {
      findings.push(finding('client-export-missing', 'blocker', 'dsh.client is declared but exports["./client"] is missing', 'Add the client export or remove dsh.client.'));
    }
    if (!Array.isArray(client.inject)) {
      findings.push(finding('client-inject-missing', 'warn', 'dsh.client.inject is not an array', 'Declare the client services the plugin injects.'));
    }
  } else {
    findings.push(finding('client-absent', 'info', 'No dsh.client half; host-only plugin.'));
  }

  const hostEntry = manifest.exports?.['.'] ?? manifest.main;
  info.hostEntry = hostEntry ?? null;
  if (!hostEntry) findings.push(finding('host-entry-missing', 'blocker', 'No main / exports["."] host entry', 'Declare a loadable host entry.'));

  if (packageDir) {
    for (const hit of scanKnownApis(packageDir)) {
      findings.push(finding(hit.id, hit.severity, hit.message, `Review ${hit.file}`));
    }
  }
  return { findings, info };
}

export function summarizeFindings(findings) {
  const blockers = findings.filter((item) => item.severity === 'blocker');
  const warnings = findings.filter((item) => item.severity === 'warn');
  return {
    blockers: blockers.length,
    warnings: warnings.length,
    ok: blockers.length === 0,
  };
}
