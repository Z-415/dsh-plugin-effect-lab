/**
 * Turn a full lab report JSON (or a parse failure) into the compact summary
 * the model tool returns. Pure; no filesystem access.
 */

export function summarizeReport({ report, exitCode, timedOut = false, stderr = '' }) {
  if (!report || typeof report !== 'object') {
    return {
      ok: false,
      parsed: false,
      timedOut,
      exitCode,
      error: timedOut
        ? `实验舱调用超时（退出码 ${exitCode ?? 'null'}），未拿到报告。`
        : '实验舱没有输出可解析的 report JSON。',
      stderrTail: tail(String(stderr ?? ''), 4000),
    };
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failedChecks = checks
    .filter((check) => !check?.pass && check?.informational !== true)
    .map((check) => ({ name: check.name, detail: check.detail ?? null }));
  const keywords = [
    ...(report.signatureHits ?? []).map((hit) => hit?.id).filter(Boolean),
    ...(Array.isArray(report.noise) ? report.noise.map((item) => item?.id).filter(Boolean) : []),
  ];
  const artifacts = report.artifacts ?? {};
  return {
    ok: report.ok === true,
    parsed: true,
    timedOut,
    exitCode,
    runId: report.runId ?? null,
    mode: report.mode ?? null,
    startedAt: report.startedAt ?? null,
    finishedAt: report.finishedAt ?? null,
    checks: {
      total: checks.length,
      passed: checks.filter((check) => check?.pass).length,
      failed: failedChecks.length,
    },
    failedChecks,
    keywords: [...new Set(keywords)],
    runDir: report.runDir ?? artifacts.runDir ?? null,
    reportHtml: artifacts.reportHtml ?? null,
    reportJson: artifacts.reportJson ?? null,
  };
}

function tail(text, limit) {
  const value = String(text ?? '');
  return value.length <= limit ? value : value.slice(value.length - limit);
}

/**
 * Compact the `lab diagnose --json` payload for the lab_diagnose tool. The lab
 * already produced stable codes + redacted evidence; the agent only needs the
 * codes, the failed checks, and a bounded tail to explain the cause.
 */
export function summarizeDiagnosticsOutcome({ report, exitCode, timedOut = false, stderr = '' }) {
  if (!report || typeof report !== 'object') {
    return {
      ok: false,
      parsed: false,
      timedOut,
      exitCode,
      error: timedOut
        ? `实验舱诊断超时（退出码 ${exitCode ?? 'null'}），未拿到结构化诊断。`
        : '实验舱诊断没有输出可解析的 JSON。',
      stderrTail: tail(String(stderr ?? ''), 4000),
    };
  }
  return {
    ok: report.ok === true,
    parsed: true,
    timedOut,
    exitCode,
    primaryCode: report.primaryCode ?? 'LAB-UNKNOWN',
    errorCodes: Array.isArray(report.errorCodes) ? report.errorCodes : ['LAB-UNKNOWN'],
    unknown: report.unknown === true,
    runId: report.runId ?? null,
    source: report.source ?? null,
    signatures: (report.signatures ?? []).slice(0, 20).map((hit) => ({
      code: hit?.code ?? 'LAB-UNKNOWN',
      id: hit?.id ?? null,
      category: hit?.category ?? null,
      severity: hit?.severity ?? null,
      matched: hit?.matched ?? null,
      rootCause: hit?.rootCause ?? null,
      fix: hit?.fix ?? null,
    })),
    failedChecks: (report.failedChecks ?? []).slice(0, 20).map((check) => ({
      name: check?.name ?? null,
      detail: check?.detail ?? null,
    })),
    bootTail: (report.bootTail ?? []).slice(-20),
    reportJson: report.evidence?.reportJson ?? null,
  };
}
