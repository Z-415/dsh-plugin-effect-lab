import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent lab-profile discovery for the bridge.
 *
 * Persistent profiles are the lab's own `.lab-profiles/<name>` directories
 * (or the `DSH_LAB_PROFILES` root). They never touch the real `~/.dsh`. The
 * reserved `desktop` name is refused so the bridge can never be confused with
 * the real desktop profile.
 */

export const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const PROFILE_MANIFEST = 'lab-profile.json';

export function assertSafeProfileName(name) {
  const text = String(name ?? '').trim();
  if (!PROFILE_NAME_PATTERN.test(text)) {
    throw new Error(`invalid lab profile name: ${JSON.stringify(text)} (use [a-z0-9._-], max 32 chars)`);
  }
  if (text === 'desktop') throw new Error('the desktop profile name is reserved');
  return text;
}

/** '' / null => one-off temporary profile; otherwise a validated persistent name. */
export function normalizeProfileLab(name) {
  const text = String(name ?? '').trim();
  if (!text) return null;
  return assertSafeProfileName(text);
}

export function listProfiles(profilesRoot) {
  const root = path.resolve(profilesRoot);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PROFILE_NAME_PATTERN.test(entry.name) || entry.name === 'desktop') continue;
    const dir = path.join(root, entry.name);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, PROFILE_MANIFEST), 'utf8'));
    } catch {
      manifest = null;
    }
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(dir).mtimeMs; } catch { /* vanished between readdir and stat */ }
    out.push({
      name: entry.name,
      plugins: Array.isArray(manifest?.plugins)
        ? manifest.plugins.map((plugin) => plugin?.spec ?? plugin?.name).filter(Boolean)
        : [],
      createdAt: manifest?.createdAt ?? null,
      mtimeMs,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
