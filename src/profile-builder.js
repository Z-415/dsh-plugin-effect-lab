import fs from 'node:fs';
import path from 'node:path';
import { MINIMAL_WEB_BUNDLES } from './config.js';
import { ensureDir, readJson, writeJson } from './util.js';

const PROFILE_ROOT = `# dsh profile root - an empty entry list.
# The tree is composed from bundles, then cordis.patch.yml, then overlays.
[]
`;

const PROFILE_PATCH = `# Your patch layer for this dsh profile, applied after every bundle layer.
# A top-level YAML array of loader patch entries.
[]
`;

const PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

export function buildProfileManifest({ name, bundles = MINIMAL_WEB_BUNDLES, dependencies = {} }) {
  return {
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: { ...dependencies },
    dsh: {
      profile: {
        bundles: [...bundles],
      },
    },
  };
}

export function writeMinimalProfile(profileDir, options = {}) {
  ensureDir(profileDir);
  const name = options.name ?? path.basename(profileDir);
  const manifest = options.manifest ?? buildProfileManifest({ name });
  const files = {
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'cordis.yml': PROFILE_ROOT,
    'cordis.patch.yml': PROFILE_PATCH,
    'pnpm-workspace.yaml': PNPM_WORKSPACE,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(profileDir, file), content, 'utf8');
  }
  return { profileDir, manifest, files: Object.keys(files) };
}

/** Append newly installed dependency names to the profile bundle order. */
export function appendBundles(profileDir, names) {
  const file = path.join(profileDir, 'package.json');
  const manifest = readJson(file);
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles ??= [];
  for (const name of names) {
    if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name);
  }
  writeJson(file, manifest);
  return manifest;
}

export function validateProfileManifest(manifest) {
  const problems = [];
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  const dependencies = manifest?.dependencies ?? {};
  if (!bundles.includes('@deepseek-ai/dsh-base')) problems.push('bundles is missing @deepseek-ai/dsh-base');
  for (const bundle of bundles) {
    if (bundle.startsWith('@deepseek-ai/')) continue;
    if (!dependencies[bundle]) problems.push(`bundle "${bundle}" has no matching dependency`);
  }
  return { ok: problems.length === 0, problems };
}

/** Infer package names added by `dsh plugin add` from the profile manifest. */
export function detectAddedDependencies(before, after) {
  const previous = new Set(Object.keys(before?.dependencies ?? {}));
  return Object.keys(after?.dependencies ?? {}).filter((name) => !previous.has(name));
}
