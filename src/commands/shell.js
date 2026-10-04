import { runShell } from '../electron-shell/shell-runner.js';

export async function runShellCommand(options) {
  const report = await runShell({
    runtimePath: options.runtimePath,
    artifactsRoot: options.artifactsRoot,
    noCache: options.noCache,
    shellTimeoutMs: options.shellTimeoutMs,
    plugins: options.plugins,
    withPlugins: options.withPlugins,
    fixture: options.fixture,
    online: options.online,
    installTimeoutMs: options.installTimeoutMs,
    assertTokens: options.assertTokens,
    compareWeb: options.compareWeb,
    browserPath: options.browserPath,
    browserTimeoutMs: options.browserTimeoutMs,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`DSH Plugin Effect Lab shell: ${report.ok ? 'PASS' : 'FAIL'} (${report.runId})\n`);
    process.stdout.write(`artifacts: ${report.artifacts?.runDir ?? report.runId}\n`);
    for (const check of report.checks) process.stdout.write(`[${check.pass ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail ?? ''}\n`);
    const shellProbe = report.shell?.probeSummary;
    if (shellProbe) {
      process.stdout.write(
        `shell probe: slots=${shellProbe.slots} tokens=${shellProbe.tokens}`
          + ` bg-base=${shellProbe.bgBase || '(empty)'}`
          + ` themeRoot=${shellProbe.themeRoot ?? 'n/a'}`
          + ` body-attrs=[${shellProbe.bodyAttributeKeys.join(', ')}]`
          + ` transport=${JSON.stringify(shellProbe.transport)}\n`,
      );
    }
    const webProbe = report.shell?.webSummary;
    if (webProbe) {
      process.stdout.write(
        `web   probe: slots=${webProbe.slots} tokens=${webProbe.tokens}`
          + ` bg-base=${webProbe.bgBase || '(empty)'}`
          + ` body-attrs=[${webProbe.bodyAttributeKeys.join(', ')}]\n`,
      );
    }
    if (report.shell?.shellVsWeb) {
      const diff = report.shell.shellVsWeb;
      process.stdout.write(
        `shell vs web: slots added=[${diff.slots.added.join(', ')}] removed=[${diff.slots.removed.join(', ')}]`
          + ` tokenChanges=${Object.keys(diff.tokens.changed).length + Object.keys(diff.tokens.added).length + Object.keys(diff.tokens.removed).length}`
          + ` bodyAttrChanges=${Object.keys(diff.bodyAttributes.changed).length + Object.keys(diff.bodyAttributes.added).length + Object.keys(diff.bodyAttributes.removed).length}`
          + ` desktopOnlyBody=[${diff.desktopOnly.bodyAttributes.join(', ')}]\n`,
      );
    }
  }
  return report.ok ? 0 : 1;
}
