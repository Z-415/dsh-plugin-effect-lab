import fs from 'node:fs';
import path from 'node:path';
import { defaultArtifactsRoot } from '../config.js';
import { renderDiagnosticsText, summarizeDiagnostics } from '../diagnostics.js';
import { scanLogs, tailLines } from '../log-scanner.js';

/** Newest `artifacts/<run>/report.json`, so `--latest` needs no run id. */
export function latestReportFile(root = defaultArtifactsRoot()) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const runs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'report.json'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs[0]?.file ?? null;
}

/** Diagnostics for a bare log file (no report.json available). */
export function buildLogDiagnostics(text, options = {}) {
  const hits = scanLogs(text);
  return summarizeDiagnostics({
    runId: options.runId ?? null,
    ok: !hits.some((hit) => hit.severity === 'fatal'),
    mode: 'log',
    checks: [],
    signatureHits: hits,
    bootTail: tailLines(text, 40),
    artifacts: {},
  });
}

/**
 * `lab diagnose --report <report.json> | --bundle <bundle.json> | --log <log>
 * | --latest [--artifacts <dir>] [--json]`
 */
export async function runDiagnoseCommand(options = {}) {
  let diagnostics = null;
  let source = null;
  if (options.reportPath) {
    source = path.resolve(options.reportPath);
    diagnostics = summarizeDiagnostics(JSON.parse(fs.readFileSync(source, 'utf8')));
  } else if (options.bundlePath) {
    source = path.resolve(options.bundlePath);
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    diagnostics = parsed.diagnostics ?? summarizeDiagnostics(parsed);
  } else if (options.logPath) {
    source = path.resolve(options.logPath);
    diagnostics = buildLogDiagnostics(fs.readFileSync(source, 'utf8'), { runId: path.basename(source) });
  } else if (options.latest) {
    const file = latestReportFile(options.artifactsRoot ?? defaultArtifactsRoot());
    if (!file) {
      process.stderr.write('diagnose: no artifacts/<run>/report.json yet\n');
      return 2;
    }
    source = file;
    diagnostics = summarizeDiagnostics(JSON.parse(fs.readFileSync(file, 'utf8')));
  } else {
    process.stderr.write('diagnose needs --report <file>, --bundle <file>, --log <file>, or --latest\n');
    return 2;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ source, ...diagnostics }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderDiagnosticsText(diagnostics)}`);
    process.stdout.write(`来源: ${source}\n`);
  }
  return diagnostics.ok ? 0 : 1;
}
