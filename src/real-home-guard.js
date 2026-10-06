import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REAL_HOME } from './config.js';

/**
 * Structural files only. The guard never touches credentials, sessions,
 * settings, or any user content outside these profile configuration files.
 */
export const HASH_ALLOWLIST = [
  'profiles/web/package.json',
  'profiles/web/cordis.yml',
  'profiles/web/cordis.patch.yml',
  'profiles/web/pnpm-workspace.yaml',
  'profiles/web/pnpm-lock.yaml',
  'profiles/web/compatibility.json',
  'profiles/desktop/package.json',
  'profiles/desktop/cordis.yml',
  'profiles/desktop/cordis.patch.yml',
  'profiles/desktop/pnpm-workspace.yaml',
  'profiles/desktop/pnpm-lock.yaml',
  'profiles/desktop/compatibility.json',
];

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex').toUpperCase();
}

export function snapshotRealHome(realHome = REAL_HOME) {
  const files = {};
  for (const relative of HASH_ALLOWLIST) {
    const full = path.join(realHome, relative);
    if (!fs.existsSync(full)) {
      files[relative] = { exists: false };
      continue;
    }
    const stat = fs.statSync(full);
    files[relative] = {
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: sha256(full),
    };
  }
  return { realHome, capturedAt: new Date().toISOString(), files };
}

export function diffRealHome(before, after) {
  const changed = [];
  const keys = new Set([...Object.keys(before?.files ?? {}), ...Object.keys(after?.files ?? {})]);
  for (const key of keys) {
    const a = before?.files?.[key] ?? { exists: false };
    const b = after?.files?.[key] ?? { exists: false };
    if (a.exists !== b.exists) {
      changed.push({ file: key, kind: b.exists ? 'created' : 'deleted', before: a, after: b });
      continue;
    }
    if (!a.exists) continue;
    if (a.sha256 !== b.sha256 || a.size !== b.size) {
      changed.push({ file: key, kind: 'changed', before: a, after: b });
    }
  }
  return { ok: changed.length === 0, changed };
}
