import fs from 'node:fs';
import path from 'node:path';
import { REAL_HOME } from './config.js';

/**
 * Read-only discovery of the real DSH profiles on this machine, for the GUI's
 * clone-source dropdown. Accepts only a directory under `<real home>\profiles`
 * that contains a `package.json` (so `node_modules` and half-created folders
 * are filtered out). It never writes, deletes, or reads credentials/sessions/
 * settings.
 */
export function discoverRealProfiles(realHome = REAL_HOME) {
  const root = path.join(path.resolve(realHome), 'profiles');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const dir = path.join(root, entry.name);
    const manifestFile = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      manifest = null;
    }
    const dependencies = Object.keys(manifest?.dependencies ?? {}).filter((name) => !name.startsWith('@deepseek-ai/'));
    out.push({
      name: entry.name,
      dir,
      dependenciesCount: dependencies.length,
      bundlesCount: (manifest?.dsh?.profile?.bundles ?? []).length,
      hasPatches: fs.existsSync(path.join(dir, 'patches')),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
