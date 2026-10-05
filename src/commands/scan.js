import fs from 'node:fs';
import path from 'node:path';
import { defaultArtifactsRoot } from '../config.js';
import { hasFatal, listSignatures, scanLogs, summarize } from '../log-scanner.js';

/**
 * The newest run under `artifacts/` that has boot logs, so the GUI (and a
 * human) can rescan the last failure without knowing the run id.
 */
export function latestRunLogs(root = defaultArtifactsRoot()) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const runs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  for (const runDir of runs) {
    const logs = ['boot.err.log', 'boot.out.log']
      .map((name) => path.join(runDir, name))
      .filter((file) => fs.existsSync(file));
    if (logs.length) return { runDir, logs };
  }
  return null;
}

export async function runScanCommand(options = {}) {
  if (options.list) {
    const signatures = listSignatures();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ count: signatures.length, signatures }, null, 2)}\n`);
    } else {
      process.stdout.write(`failure signature library: ${signatures.length} entries\n`);
      for (const item of signatures) {
        process.stdout.write(`- [${item.severity}] ${item.id} (${item.category}): ${item.rootCause}\n`);
        process.stdout.write(`    fix: ${item.fix}\n`);
      }
    }
    return 0;
  }
  let files = options.logs?.length ? options.logs : [];
  let runDir = null;
  if (!files.length && options.latest) {
    const latest = latestRunLogs(options.artifactsRoot);
    if (!latest) {
      process.stderr.write('scan: no run with boot logs under artifacts/ yet\n');
      return 2;
    }
    files = latest.logs;
    runDir = latest.runDir;
  }
  if (!files.length) {
    process.stderr.write('scan needs --log <file> or --latest\n');
    return 2;
  }
  const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const hits = scanLogs(text);
  const report = { files, runDir, fatal: hasFatal(hits), hits, summary: summarize(hits) };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    if (runDir) process.stdout.write(`scanning latest run: ${runDir}\n`);
    process.stdout.write(`${summaryLine(report)}\n`);
    for (const hit of hits) process.stdout.write(`- [${hit.severity}] ${hit.id} (${hit.category}): ${hit.matched}\n`);
  }
  return hasFatal(hits) ? 1 : 0;
}

function summaryLine(report) {
  return report.fatal ? 'scan: FATAL signatures found' : report.hits.length ? 'scan: warnings only' : 'scan: clean';
}
