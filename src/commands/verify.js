import { runLab } from '../runner.js';

export async function runVerifyCommand(options) {
  const pluginSpecs = [...(options.plugins ?? []), ...(options.withPlugins ?? [])];
  const report = await runLab({
    mode: options.mode ?? 'web',
    runtimePath: options.runtimePath,
    plugins: pluginSpecs,
    fixture: options.fixture,
    fixtureVariant: options.fixtureVariant,
    mockModel: options.mockModel,
    online: options.online,
    screenshots: options.screenshots,
    assertTokens: options.assertTokens,
    assertSlots: options.assertSlots,
    assertBodyAttributes: options.assertBodyAttributes,
    minSlots: options.minSlots,
    routes: options.routes,
    artifactsRoot: options.artifactsRoot,
    browserPath: options.browserPath,
    bootTimeoutMs: options.bootTimeoutMs,
    browserTimeoutMs: options.browserTimeoutMs,
    strictConsole: options.strictConsole,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${winnerLine(report)}\n`);
    process.stdout.write(`artifacts: ${report.runDir}\n`);
    for (const check of report.checks) {
      const label = check.pass ? 'PASS' : check.informational ? 'INFO' : 'FAIL';
      process.stdout.write(`[${label}] ${check.name}: ${check.detail ?? ''}\n`);
    }
  }
  return report.ok ? 0 : 1;
}

function winnerLine(report) {
  return report.ok
    ? `DSH Plugin Effect Lab: PASS (${report.runId})`
    : `DSH Plugin Effect Lab: FAIL (${report.runId})`;
}
