import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads the most recent lab run out of the stable artifacts directory.
 *
 * The lab writes one `<runId>/` directory per run containing `report.json`,
 * `report.html`, and `screenshots/`. "Latest" is the newest directory by
 * descending mtime; ties fall back to the name so it is deterministic.
 */

export function findLatestRunDir(artifactsDir) {
  let entries;
  try {
    entries = fs.readdirSync(artifactsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(artifactsDir, entry.name);
    if (!fs.existsSync(path.join(dir, 'report.json'))) continue;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(dir).mtimeMs; } catch { /* keep 0 */ }
    candidates.push({ dir, name: entry.name, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  return candidates[0]?.dir ?? null;
}

export function readLatestReport(artifactsDir) {
  const runDir = findLatestRunDir(artifactsDir);
  if (!runDir) return null;
  try {
    const report = JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'));
    return { runDir, report };
  } catch {
    return null;
  }
}

/** Resolve a relative path inside the artifacts root, rejecting traversal. */
export function resolveInsideArtifacts(artifactsDir, relativePath) {
  const root = path.resolve(artifactsDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function contentTypeFor(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function readArtifactFile(artifactsDir, relativePath) {
  const file = resolveInsideArtifacts(artifactsDir, relativePath);
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return { file, contentType: contentTypeFor(file), body: fs.readFileSync(file) };
  } catch {
    return null;
  }
}
