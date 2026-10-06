import fs from 'node:fs';
import path from 'node:path';
import { defaultArtifactsRoot } from '../config.js';
import {
  hasFatal,
  linesAroundMatch,
  listSignatures,
  looksLikeFailure,
  scanLogs,
  summarize,
  tailLines,
} from '../log-scanner.js';

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

/**
 * Build the scan report for one blob of log text.
 *
 * An unknown failure must not come back as just "clean": when nothing matches,
 * the report carries a bounded tail of the log so there is still evidence to
 * look at (and to turn into a new signature). `explain` adds the lines around
 * each match.
 */
export function buildScanReport(options = {}) {
  const {
    files = [],
    runDir = null,
    text = '',
    explain = false,
    tailCount = 30,
  } = options;
  const hits = scanLogs(text);
  const report = { files, runDir, fatal: hasFatal(hits), hits, summary: summarize(hits) };
  if (!hits.length) {
    report.unknownFailure = looksLikeFailure(text);
    if (report.unknownFailure || explain) report.tail = tailLines(text, tailCount);
  } else if (explain) {
    report.explanations = hits.map((hit) => ({
      id: hit.id,
      code: hit.code ?? 'LAB-UNKNOWN',
      matched: hit.matched,
      lines: linesAroundMatch(text, hit.matched, 3),
    }));
  }
  return report;
}

export async function runScanCommand(options = {}) {
  if (options.list) {
    const signatures = listSignatures();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ count: signatures.length, signatures }, null, 2)}\n`);
    } else {
      process.stdout.write(`failure signature library: ${signatures.length} entries\n`);
      for (const item of signatures) {
        process.stdout.write(`- [${item.severity}] ${item.code} ${item.id} (${item.category}): ${item.rootCause}\n`);
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
  const report = buildScanReport({ files, runDir, text, explain: options.explain === true });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    if (runDir) process.stdout.write(`scanning latest run: ${runDir}\n`);
    process.stdout.write(`${summaryLine(report)}\n`);
    for (const hit of report.hits) {
      process.stdout.write(`- [${hit.severity}] ${hit.code ?? 'LAB-UNKNOWN'} ${hit.id} (${hit.category}): ${hit.matched}\n`);
    }
    if (report.tail?.length) {
      process.stdout.write(`no known signature matched; last ${report.tail.length} non-empty log line(s):\n`);
      for (const line of report.tail) process.stdout.write(`  | ${line}\n`);
    }
    for (const explanation of report.explanations ?? []) {
      process.stdout.write(`context for ${explanation.code} ${explanation.id}:\n`);
      for (const line of explanation.lines) process.stdout.write(`  | ${line}\n`);
    }
  }
  return hasFatal(report.hits) ? 1 : 0;
}

function summaryLine(report) {
  if (report.fatal) return 'scan: FATAL signatures found';
  if (report.hits.length) return 'scan: warnings only';
  if (report.unknownFailure) return 'scan: no known signature, but the log looks like a failure (tail below)';
  return 'scan: clean';
}
