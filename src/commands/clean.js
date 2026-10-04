import { listLabResidue } from '../cleanup.js';
import { disposeIsolatedHome } from '../home-manager.js';

export async function runCleanCommand(options = {}) {
  const olderThanMs = Number(options.olderThanMs ?? 0);
  const now = Date.now();
  const targets = listLabResidue().filter((entry) => !olderThanMs || now - entry.mtimeMs >= olderThanMs);
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
  const report = { dryRun: Boolean(options.dryRun), removed, failed };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`clean: removed ${removed.length}, failed ${failed.length}\n`);
    for (const item of removed) process.stdout.write(`- ${item.path}${item.dryRun ? ' (dry-run)' : ''}\n`);
    for (const item of failed) process.stdout.write(`- FAILED ${item.path}: ${item.error}\n`);
  }
  return failed.length ? 1 : 0;
}
