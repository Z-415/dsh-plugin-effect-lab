import { listLabResidue } from '../cleanup.js';
import { disposeIsolatedHome } from '../home-manager.js';
import { planLabProcesses, reapLabProcesses } from '../process-reaper.js';

export async function runCleanCommand(options = {}) {
  const olderThanMs = Number(options.olderThanMs ?? 0);
  const now = Date.now();
  const targets = listLabResidue().filter((entry) => !olderThanMs || now - entry.mtimeMs >= olderThanMs);

  // Sweep processes first: a leaked browser holds its run directory open, so
  // deleting the directory first would fail with EBUSY. A process whose
  // directory is already gone, or is about to be removed here, is an orphan;
  // a live run keeps its directory and is left alone.
  const processOptions = { olderThanMs, plannedRemovals: targets.map((entry) => entry.path) };
  const processResult = options.dryRun
    ? planLabProcesses(processOptions)
    : reapLabProcesses(processOptions);
  const processes = {
    matched: processResult.matched,
    orphans: processResult.orphans,
    killed: (processResult.killed ?? []).map((entry) => ({ pid: entry.pid, name: entry.name })),
    failed: processResult.failed ?? [],
  };

  const removed = [];
  const failed = [];
  for (const target of targets) {
    if (options.dryRun) {
      removed.push({ ...target, dryRun: true });
      continue;
    }
    const result = await disposeIsolatedHome(target.path);
    if (result.removed) removed.push({ path: target.path, attempts: result.attempts });
    else failed.push({ path: target.path, error: result.error });
  }

  const report = { dryRun: Boolean(options.dryRun), removed, failed, processes };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(options.dryRun
      ? `clean (dry-run): would remove ${removed.length} dir(s), would reap ${processes.orphans.length} of ${processes.matched} lab process(es)\n`
      : `clean: removed ${removed.length}, failed ${failed.length}, reaped ${processes.killed.length} of ${processes.matched} lab process(es)\n`);
    for (const item of removed) process.stdout.write(`- ${item.path}${item.dryRun ? ' (dry-run)' : ''}\n`);
    for (const item of failed) process.stdout.write(`- FAILED ${item.path}: ${item.error}\n`);
    for (const item of processes.orphans) {
      process.stdout.write(`- ${options.dryRun ? 'ORPHAN' : 'reaped'} pid ${item.pid} ${item.name}${item.commandLine ? ` :: ${item.commandLine.slice(0, 160)}` : ''}\n`);
    }
    for (const item of processes.failed) {
      process.stdout.write(`- FAILED to reap pid ${item.pid} ${item.name}: ${item.error}\n`);
    }
  }
  return failed.length || processes.failed.length ? 1 : 0;
}
