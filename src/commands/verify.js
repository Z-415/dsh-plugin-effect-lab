import { runLab } from '../runner.js';
import { createProgressReporter } from '../progress.js';

export async function runVerifyCommand(options) {
  const pluginSpecs = [...(options.plugins ?? []), ...(options.withPlugins ?? [])];
  const progress = options.json
    ? null
    : createProgressReporter({ structured: process.env.DSH_LAB_GUI === '1' });
  const report = await runLab({
    onProgress: progress,
    mode: options.mode ?? 'web',
    runtimePath: options.runtimePath,
    plugins: pluginSpecs,
    fixture: options.fixture,
    fixtureVariant: options.fixtureVariant,
    profileLab: options.profileLab,
    cloneProfile: options.cloneProfile,
    clonePlugins: options.clonePlugins,
    cloneExclude: options.cloneExclude,
    cloneDropLocal: options.cloneDropLocal,
    diagnosticsBundle: options.diagnosticsBundle,
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
    bootTransport: options.bootTransport,
    browserTimeoutMs: options.browserTimeoutMs,
    strictConsole: options.strictConsole,
    html: options.html,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${winnerLine(report)}\n`);
    process.stdout.write(`产物目录: ${report.runDir}\n`);
    if (report.artifacts?.reportHtml) process.stdout.write(`HTML 报告: ${report.artifacts.reportHtml}\n`);
    for (const plugin of report.plugins ?? []) {
      if (!plugin.resolvedSpec) continue;
      process.stdout.write(`[插件] ${plugin.advertisedSpec ?? plugin.spec} -> ${plugin.resolvedSpec} (${plugin.source ?? 'unknown'})\n`);
    }
    for (const check of report.checks) {
      const label = check.pass ? '通过' : check.informational ? '提示' : '失败';
      process.stdout.write(`[${label}] ${check.name}: ${check.detail ?? ''}\n`);
    }
  }
  return report.ok ? 0 : 1;
}

function winnerLine(report) {
  return report.ok
    ? `DSH 插件效果实验舱: 通过 (${report.runId})`
    : `DSH 插件效果实验舱: 未通过 (${report.runId})`;
}
