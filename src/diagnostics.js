import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UNKNOWN_CODE } from './log-scanner.js';
import { ensureDir } from './util.js';

/**
 * Structured, redacted diagnostics. The lab produces the evidence (stable
 * error codes, failed checks, bounded log tails); the user's DSH agent reads
 * this and explains the cause. No credentials, sessions, settings, raw logs,
 * or absolute home paths leave here.
 */

export const DIAGNOSTICS_SCHEMA = 'dsh-plugin-effect-lab/diagnostics@1';

const SECRET_PATTERNS = [
  [/(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/((?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|secret|password|passwd|authorization|cookie|token))\s*[:=]\s*["']?[^\s"'&,;]+/gi, '$1=***'],
];

/** Replace credential-shaped values and the local home/temp paths. */
export function redactText(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  const home = os.homedir();
  if (home) text = text.split(home).join('%USERPROFILE%');
  const temp = os.tmpdir();
  if (temp) text = text.split(temp).join('%TEMP%');
  // Any remaining C:\Users\<name>\... path keeps the drive but hides the user.
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, (match) => `${match.slice(0, 3)}Users\\<user>`);
  return text;
}

export function redactValue(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(?:credential|password|passwd|secret|token|cookie|api[_-]?key)/i.test(key)) {
        out[key] = '***';
      } else {
        out[key] = redactValue(item);
      }
    }
    return out;
  }
  return value;
}

function dedupeHits(report) {
  const seen = new Set();
  const hits = [];
  for (const hit of [...(report?.signatureHits ?? []), ...(report?.consoleSignatureHits ?? [])]) {
    const key = `${hit?.code ?? UNKNOWN_CODE}\u0000${hit?.id ?? ''}\u0000${hit?.matched ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }
  return hits;
}

/** Build the redacted diagnostics summary from a finished run report. */
export function summarizeDiagnostics(report = {}) {
  const hits = dedupeHits(report);
  const codes = [...new Set(hits.map((hit) => hit.code ?? UNKNOWN_CODE).filter(Boolean))];
  const ok = report.ok === true;
  // A failed run with no signature is the only LAB-UNKNOWN case; a clean run
  // carries no error code at all.
  const unknown = !ok && codes.length === 0;
  const failedChecks = (report.checks ?? [])
    .filter((check) => !check?.pass && check?.informational !== true)
    .map((check) => ({ name: check.name, detail: redactText(check.detail ?? '') }));
  const bootTail = report.failureContext?.bootTail ?? report.bootTail ?? [];
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: new Date().toISOString(),
    runId: report.runId ?? null,
    ok: report.ok === true,
    mode: report.mode ?? null,
    runtime: {
      version: report.runtime?.version ?? null,
      compat: report.runtime?.compat?.status ?? null,
    },
    primaryCode: codes[0] ?? (ok ? 'LAB-OK' : UNKNOWN_CODE),
    errorCodes: codes.length ? codes : (ok ? [] : [UNKNOWN_CODE]),
    unknown,
    signatures: hits.map((hit) => ({
      code: hit.code ?? UNKNOWN_CODE,
      id: hit.id,
      category: hit.category ?? 'general',
      severity: hit.severity ?? null,
      matched: redactText(hit.matched ?? ''),
      rootCause: hit.rootCause ?? null,
      fix: hit.fix ?? null,
    })),
    failedChecks,
    checks: (report.checks ?? []).map((check) => ({
      name: check.name,
      pass: check.pass === true,
      informational: check.informational === true,
      detail: redactText(check.detail ?? ''),
    })),
    plugins: (report.plugins ?? []).map((plugin) => ({
      advertisedSpec: plugin.advertisedSpec ?? plugin.spec ?? null,
      resolvedSpec: plugin.resolvedSpec ?? plugin.resolved ?? null,
      source: plugin.source ?? null,
    })),
    clone: report.clone
      ? {
        kind: report.clone.kind ?? null,
        plugins: report.clone.plugins ?? null,
        excluded: (report.clone.excluded ?? []).map((entry) => ({ name: entry.name, spec: redactText(entry.spec), reason: entry.reason ?? null })),
        droppedLocal: (report.clone.droppedLocal ?? []).map((entry) => ({ name: entry.name, spec: redactText(entry.spec) })),
        localPlugins: (report.clone.localPlugins ?? []).map((entry) => ({ name: entry.name, spec: redactText(entry.spec), kind: entry.kind ?? null })),
        install: report.clone.install
          ? {
            ok: report.clone.install.ok === true,
            code: report.clone.install.code ?? null,
            missing: report.clone.install.missing ?? [],
            incompatible: report.clone.install.incompatible ?? [],
            rejected: report.clone.install.rejected === true,
          }
          : null,
      }
      : null,
    failureContext: report.failureContext
      ? {
        reason: redactText(report.failureContext.reason ?? ''),
        errors: (report.failureContext.errors ?? []).map(redactText),
        consoleErrors: (report.failureContext.consoleErrors ?? []).map(redactText),
        pageErrors: (report.failureContext.pageErrors ?? []).map(redactText),
      }
      : null,
    bootTail: bootTail.map(redactText),
    evidence: {
      reportJson: redactText(report.artifacts?.reportJson ?? ''),
      reportHtml: redactText(report.artifacts?.reportHtml ?? ''),
      bootOut: redactText(report.artifacts?.bootOut ?? ''),
      bootErr: redactText(report.artifacts?.bootErr ?? ''),
      cloneInstallLog: redactText(report.artifacts?.cloneInstallLog ?? ''),
      diagnosticsBundle: redactText(report.artifacts?.diagnosticsBundle ?? ''),
    },
    // Explicit: the bundle never carries credentials, sessions, or settings.
    exclusions: {
      credentials: false,
      sessions: false,
      settings: false,
      note: 'The bundle is derived from report.json only; it never reads ~/.dsh credentials, sessions, or settings.',
    },
  };
}

/** Write the redacted bundle; returns the resolved path. */
export function writeDiagnosticsBundle(report, targetPath) {
  const resolved = path.resolve(targetPath);
  ensureDir(path.dirname(resolved));
  const diagnostics = summarizeDiagnostics(report);
  fs.writeFileSync(
    resolved,
    `${JSON.stringify({ schema: `${DIAGNOSTICS_SCHEMA}/bundle`, generatedAt: diagnostics.generatedAt, diagnostics }, null, 2)}\n`,
    'utf8',
  );
  return { path: resolved, diagnostics };
}

export function renderDiagnosticsText(diagnostics) {
  const lines = [];
  lines.push(`实验舱诊断: ${diagnostics.ok ? '通过' : '未通过'} (run ${diagnostics.runId ?? '未知'})`);
  const codeText = diagnostics.errorCodes?.length ? diagnostics.errorCodes.join(', ') : '(无)';
  lines.push(`错误码: ${codeText}${diagnostics.unknown ? ' (没有命中已知签名，附证据)' : ''}`);
  for (const hit of diagnostics.signatures ?? []) {
    lines.push(`- [${hit.code}] ${hit.id} (${hit.category}): ${hit.matched}`);
    if (hit.rootCause) lines.push(`    原因: ${hit.rootCause}`);
    if (hit.fix) lines.push(`    建议: ${hit.fix}`);
  }
  if (diagnostics.failedChecks?.length) {
    lines.push('失败检查:');
    for (const check of diagnostics.failedChecks) lines.push(`- ${check.name}: ${check.detail}`);
  }
  if (diagnostics.bootTail?.length) {
    lines.push('启动日志末尾:');
    for (const line of diagnostics.bootTail) lines.push(`  | ${line}`);
  }
  return `${lines.join('\n')}\n`;
}
