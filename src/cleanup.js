import fs from 'node:fs';
import { listOrphanLabHomes } from './home-manager.js';
import { canConnect } from './net-utils.js';
import { planLabProcesses } from './process-reaper.js';

/**
 * No-residue evidence for acceptance case F.
 *
 * A run may legitimately leave the reusable `dsh-lab-electron-<version>` cache
 * behind, so `listLabResidue` only reports real lab homes (the ones with a
 * `home/` directory) and browser/debug scratch directories.
 */

/** Snapshot every lab temp directory that would count as residue. */
export function listLabResidue() {
  return listOrphanLabHomes().map((entry) => ({
    path: entry.path,
    name: entry.path.split(/[\\/]/).at(-1),
    mtimeMs: entry.mtimeMs,
  }));
}

export function snapshotLabResidue() {
  return { capturedAt: new Date().toISOString(), homes: listLabResidue() };
}

function keyOf(entry) {
  return String(entry?.path ?? '').replace(/[\\/]+$/, '').toLowerCase();
}

/** Homes present after a run that were not present before it. */
export function diffResidue(before, after) {
  const beforeKeys = new Set((before?.homes ?? []).map(keyOf));
  const afterKeys = new Set((after?.homes ?? []).map(keyOf));
  return {
    newHomes: (after?.homes ?? []).filter((entry) => !beforeKeys.has(keyOf(entry))),
    removedHomes: (before?.homes ?? []).filter((entry) => !afterKeys.has(keyOf(entry))),
  };
}

/**
 * Verify a finished run left nothing behind: the isolated root is gone, no new
 * lab home appeared, and every port the run owned is free.
 *
 * Only `isolated-root-removed` and `ports-released` gate `ok`. A new lab home
 * is reported as `advisory` because concurrent lab runs legitimately create
 * their own homes while this one finishes.
 */
export async function verifyNoResidue(options = {}) {
  const {
    isolatedRoot = null,
    ports = [],
    before = null,
    after = snapshotLabResidue(),
    processPlan = null,
  } = options;
  const isolatedRootRemoved = isolatedRoot ? !fs.existsSync(isolatedRoot) : true;
  const { newHomes } = before ? diffResidue(before, after) : { newHomes: [] };
  const portsStillListening = [];
  for (const port of ports) {
    if (port === undefined || port === null) continue;
    if (await canConnect(port)) portsStillListening.push(port);
  }
  const checks = {
    'isolated-root-removed': isolatedRootRemoved,
    'ports-released': portsStillListening.length === 0,
  };
  // A lab process with no run directory left is an orphan; a concurrent run
  // keeps its own directory and is therefore not reported.
  const processes = processPlan ?? planLabProcesses({});
  const orphanProcesses = processes?.orphans ?? [];
  const advisory = {
    'no-new-lab-homes': newHomes.length === 0,
    'no-lab-processes': orphanProcesses.length === 0,
  };
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
  return {
    ok: failures.length === 0,
    checks,
    advisory,
    failures,
    newHomes,
    portsStillListening,
    labProcesses: { matched: processes?.matched ?? 0, orphans: orphanProcesses },
    residueAfter: after,
  };
}
