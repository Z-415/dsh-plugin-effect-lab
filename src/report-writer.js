import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.js';

export function prepareArtifacts(artifactsRoot, runId) {
  const runDir = ensureDir(path.join(artifactsRoot, runId));
  ensureDir(path.join(runDir, 'screenshots'));
  ensureDir(path.join(runDir, 'dom'));
  return runDir;
}

export function writeText(runDir, name, text) {
  const file = path.join(runDir, name);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
  return file;
}

export function writeJson(runDir, name, value) {
  return writeText(runDir, name, `${JSON.stringify(value, null, 2)}\n`);
}

export function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return null;
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  return target;
}

export function renderReportMarkdown(report) {
  const lines = [
    `# DSH 插件效果实验舱 - ${report.runId}`,
    '',
    `- 结论: ${report.ok ? '通过' : '未通过'}`,
    `- 模式: ${report.mode}`,
    `- 开始: ${report.startedAt}`,
    `- 结束: ${report.finishedAt}`,
    `- 运行时: ${report.runtime?.version ?? '未知'} (${report.runtime?.cmd ?? '未定位'})`,
    `- profile: ${report.profile?.name ?? '不适用'} (${report.profile?.dir ?? '不适用'})`,
    `- 隔离 home: ${report.isolation?.home ?? '不适用'}${report.isolation?.labProfile ? `（持久 lab profile: ${report.isolation.labProfile}）` : ''}`,
    `- 清理: 删除临时 home=${report.cleanup?.homeRemoved}${report.cleanup?.homeKept ? '，保留 lab profile' : ''}，残留端口=[${(report.cleanup?.portsLeft ?? []).join(', ')}]`,
    '',
    '## 检查项',
    '',
  ];
  for (const check of report.checks ?? []) {
    const label = check.pass ? '通过' : check.informational ? '提示' : '失败';
    lines.push(`- [${label}] ${check.name}: ${check.detail ?? ''}`);
  }
  if (report.signatureHits?.length) {
    lines.push('', '## 启动日志特征', '');
    for (const hit of report.signatureHits) {
      lines.push(`- [${hit.severity}] ${hit.id} (${hit.category ?? 'general'}): ${hit.rootCause} -> ${hit.fix}`);
    }
  }
  if (report.browser?.consoleErrors?.length) {
    lines.push('', '## 浏览器控制台错误', '');
    for (const error of report.browser.consoleErrors.slice(0, 20)) lines.push(`- ${error}`);
  }
  if (report.shell) {
    const shell = report.shell;
    lines.push('', '## Electron 壳', '');
    lines.push(`- runtime dir: ${shell.runtimeDir ?? 'n/a'} (cached=${shell.cached === true})`);
    if (shell.probeSummary) {
      lines.push(
        `- 壳探测: slot=${shell.probeSummary.slots} token=${shell.probeSummary.tokens}`
          + ` bg-base=${shell.probeSummary.bgBase || '(空)'} themeRoot=${shell.probeSummary.themeRoot ?? '不适用'}`,
      );
      lines.push(`- 壳 body 属性: [${shell.probeSummary.bodyAttributeKeys.join(', ')}]`);
      lines.push(`- 渲染进程 transport: ${JSON.stringify(shell.probeSummary.transport)}`);
    }
    if (shell.webSummary) {
      lines.push(
        `- web 探测: slot=${shell.webSummary.slots} token=${shell.webSummary.tokens}`
          + ` bg-base=${shell.webSummary.bgBase || '(空)'}`,
      );
      lines.push(`- web body 属性: [${shell.webSummary.bodyAttributeKeys.join(', ')}]`);
    }
    if (shell.shellVsWeb) {
      const diff = shell.shellVsWeb;
      lines.push(
        `- 壳 vs web slot: 新增=[${diff.slots.added.join(', ')}] 缺失=[${diff.slots.removed.join(', ')}]`,
      );
      lines.push(`- 壳 vs web token: 变化=${Object.keys(diff.tokens.changed).length} 新增=${Object.keys(diff.tokens.added).length} 缺失=${Object.keys(diff.tokens.removed).length}`);
      lines.push(`- 壳 vs web body 属性: 变化=${Object.keys(diff.bodyAttributes.changed).length} 新增=[${Object.keys(diff.bodyAttributes.added).join(', ')}]`);
      lines.push(`- 桌面专属 body 属性: [${diff.desktopOnly.bodyAttributes.join(', ')}]`);
      lines.push(`- 桌面专属 token: [${diff.desktopOnly.tokens.slice(0, 20).join(', ')}]`);
    }
    for (const error of (shell.result?.consoleErrors ?? []).slice(0, 20)) lines.push(`- 控制台错误: ${error}`);
  }
  if (report.pluginValidation) {
    lines.push('', '## 插件校验', '');
    for (const entry of report.pluginValidation.entries ?? []) {
      const label = entry.resolved?.name ?? entry.resolved?.spec ?? 'plugin';
      const blockers = (entry.findings ?? []).filter((item) => item.severity === 'blocker').length;
      const warnings = (entry.findings ?? []).filter((item) => item.severity === 'warn').length;
      lines.push(`- ${label}: 阻塞=${blockers}，警告=${warnings}`);
      for (const item of entry.findings ?? []) {
        if (item.severity === 'info') continue;
        lines.push(`  - [${item.severity}] ${item.id}: ${item.message}`);
      }
    }
  }
  if (report.fixture) {
    lines.push('', '## 固定会话夹具', '');
    lines.push(`- session: ${report.fixture.sessionId}`);
    lines.push(`- workspace: ${report.fixture.workspaceId} (${report.fixture.workspace})`);
    lines.push(`- events: ${report.fixture.events}`);
    lines.push(`- types: ${(report.fixture.types ?? []).join(', ')}`);
  }
  if (report.mockModel) {
    lines.push('', '## 回环 mock 模型', '');
    lines.push(`- provider/model: ${report.mockModel.provider}/${report.mockModel.model}`);
    lines.push(`- session: ${report.mockModel.sessionId}`);
    lines.push(`- requests: ${report.mockModel.requests}`);
    lines.push(`- turn ended: ${report.mockModel.turnEnded}`);
    lines.push(`- event types: ${(report.mockModel.eventTypes ?? []).join(', ')}`);
  }
  if (report.agentCoverage) {
    lines.push('', '## 模型 / 代理覆盖', '');
    lines.push(`- mode: ${report.agentCoverage.mode}`);
    lines.push(`- real model requests: ${report.agentCoverage.realModelRequests === true}`);
    lines.push(`- credentials copied: ${report.agentCoverage.credentialsFound === true}`);
    lines.push(`- covered: ${(report.agentCoverage.covered ?? []).join('; ')}`);
    lines.push(`- not covered: ${(report.agentCoverage.uncovered ?? []).join('; ')}`);
  }
  if (report.settings) {
    lines.push('', '## 设置页', '');
    lines.push(`- total slots after opening settings: ${report.settings.totalSlots}`);
    lines.push(`- slots added by the settings page: [${(report.settings.added ?? []).join(', ')}]`);
  }
  if (report.errors?.length) {
    lines.push('', '## 错误', '');
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  lines.push('', '## 产物', '');
  for (const [name, file] of Object.entries(report.artifacts ?? {})) {
    lines.push(`- ${name}: ${file}`);
  }
  return `${lines.join('\n')}\n`;
}
