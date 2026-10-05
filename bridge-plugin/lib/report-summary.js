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
    reportUrl: '/dsh-lab-bridge/latest/report.html',
  };
}

function tail(text, limit) {
  const value = String(text ?? '');
  return value.length <= limit ? value : value.slice(value.length - limit);
}
