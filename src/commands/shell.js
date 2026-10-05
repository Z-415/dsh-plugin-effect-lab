import { runShell } from '../electron-shell/shell-runner.js';

export async function runShellCommand(options) {
  const progress = options.json ? null : (message) => process.stdout.write(`[lab] ${message}\n`);
  if (progress && options.keepOpen) {
    progress('--keep-open: a real Electron window will open in a few seconds; close it to finish the run.');
  } else if (progress && options.show) {
    progress('--show: a real Electron window will open in a few seconds.');
  }
  if (progress && options.nativeDesktop) {
    progress('--native-desktop: the shell will use the real folder dialog and a real OS notification.');
  }
  if (progress && options.probeNativeDialog) {
    if (options.nativeDesktop && (options.show || options.keepOpen)) {
      progress('--probe-native-dialog: a real folder dialog will open; pick a folder or cancel to continue the run.');
    } else {
      progress('--probe-native-dialog ignored: it needs --native-desktop plus --show/--keep-open.');
    }
  }
  const report = await runShell({
    onProgress: progress,
    runtimePath: options.runtimePath,
    artifactsRoot: options.artifactsRoot,
    noCache: options.noCache,
    shellTimeoutMs: options.shellTimeoutMs,
    plugins: options.plugins,
    withPlugins: options.withPlugins,
    fixture: options.fixture,
    fixtureVariant: options.fixtureVariant,
    profileLab: options.profileLab,
    online: options.online,
    installTimeoutMs: options.installTimeoutMs,
    assertTokens: options.assertTokens,
    compareWeb: options.compareWeb,
    html: options.html,
    show: options.show,
    keepOpen: options.keepOpen,
    nativeDesktop: options.nativeDesktop,
    probeNativeDialog: options.probeNativeDialog,
    showHoldMs: options.showHoldMs,
    browserPath: options.browserPath,
    browserTimeoutMs: options.browserTimeoutMs,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`DSH 插件效果实验舱 · 壳模式: ${report.ok ? '通过' : '未通过'} (${report.runId})\n`);
    process.stdout.write(`产物目录: ${report.artifacts?.runDir ?? report.runId}\n`);
    if (report.artifacts?.reportHtml) process.stdout.write(`HTML 报告: ${report.artifacts.reportHtml}\n`);
    for (const check of report.checks) {
      const label = check.pass ? '通过' : check.informational ? '提示' : '失败';
      process.stdout.write(`[${label}] ${check.name}: ${check.detail ?? ''}\n`);
    }
    const shellProbe = report.shell?.probeSummary;
    if (shellProbe) {
      process.stdout.write(
        `壳探测: slot=${shellProbe.slots} token=${shellProbe.tokens}`
          + ` bg-base=${shellProbe.bgBase || '(empty)'}`
          + ` themeRoot=${shellProbe.themeRoot ?? 'n/a'}`
          + ` body-attrs=[${shellProbe.bodyAttributeKeys.join(', ')}]`
          + ` transport=${JSON.stringify(shellProbe.transport)}\n`,
      );
    }
    const webProbe = report.shell?.webSummary;
    if (webProbe) {
      process.stdout.write(
        `web 探测: slot=${webProbe.slots} token=${webProbe.tokens}`
          + ` bg-base=${webProbe.bgBase || '(empty)'}`
          + ` body-attrs=[${webProbe.bodyAttributeKeys.join(', ')}]\n`,
      );
    }
    if (report.shell?.shellVsWeb) {
      const diff = report.shell.shellVsWeb;
      process.stdout.write(
        `壳 vs web: slot 新增=[${diff.slots.added.join(', ')}] 缺失=[${diff.slots.removed.join(', ')}]`
          + ` tokenChanges=${Object.keys(diff.tokens.changed).length + Object.keys(diff.tokens.added).length + Object.keys(diff.tokens.removed).length}`
          + ` bodyAttrChanges=${Object.keys(diff.bodyAttributes.changed).length + Object.keys(diff.bodyAttributes.added).length + Object.keys(diff.bodyAttributes.removed).length}`
          + ` desktopOnlyBody=[${diff.desktopOnly.bodyAttributes.join(', ')}]\n`,
      );
    }
  }
  return report.ok ? 0 : 1;
}
