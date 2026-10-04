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
    `# DSH Plugin Effect Lab - ${report.runId}`,
    '',
    `- status: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- mode: ${report.mode}`,
    `- started: ${report.startedAt}`,
    `- finished: ${report.finishedAt}`,
    `- runtime: ${report.runtime?.version ?? 'unknown'} (${report.runtime?.cmd ?? 'not located'})`,
    `- profile: ${report.profile?.name ?? 'n/a'} (${report.profile?.dir ?? 'n/a'})`,
    `- isolated home: ${report.isolation?.home ?? 'n/a'}`,
    `- cleanup: homeRemoved=${report.cleanup?.homeRemoved}, portsLeft=[${(report.cleanup?.portsLeft ?? []).join(', ')}]`,
    '',
    '## Checks',
    '',
  ];
  for (const check of report.checks ?? []) {
    lines.push(`- [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail ?? ''}`);
  }
  if (report.signatureHits?.length) {
    lines.push('', '## Log signatures', '');
    for (const hit of report.signatureHits) {
      lines.push(`- [${hit.severity}] ${hit.id}: ${hit.rootCause} -> ${hit.fix}`);
    }
  }
  if (report.browser?.consoleErrors?.length) {
    lines.push('', '## Browser console errors', '');
    for (const error of report.browser.consoleErrors.slice(0, 20)) lines.push(`- ${error}`);
  }
  if (report.shell) {
    const shell = report.shell;
    lines.push('', '## Electron shell', '');
    lines.push(`- runtime dir: ${shell.runtimeDir ?? 'n/a'} (cached=${shell.cached === true})`);
    if (shell.probeSummary) {
      lines.push(
        `- shell probe: slots=${shell.probeSummary.slots} tokens=${shell.probeSummary.tokens}`
          + ` bg-base=${shell.probeSummary.bgBase || '(empty)'} themeRoot=${shell.probeSummary.themeRoot ?? 'n/a'}`,
      );
      lines.push(`- shell body attributes: [${shell.probeSummary.bodyAttributeKeys.join(', ')}]`);
      lines.push(`- renderer transport: ${JSON.stringify(shell.probeSummary.transport)}`);
    }
    if (shell.webSummary) {
      lines.push(
        `- web probe: slots=${shell.webSummary.slots} tokens=${shell.webSummary.tokens}`
          + ` bg-base=${shell.webSummary.bgBase || '(empty)'}`,
      );
      lines.push(`- web body attributes: [${shell.webSummary.bodyAttributeKeys.join(', ')}]`);
    }
    if (shell.shellVsWeb) {
      const diff = shell.shellVsWeb;
      lines.push(
        `- shell vs web slots: added=[${diff.slots.added.join(', ')}] removed=[${diff.slots.removed.join(', ')}]`,
      );
      lines.push(`- shell vs web tokens: changed=${Object.keys(diff.tokens.changed).length} added=${Object.keys(diff.tokens.added).length} removed=${Object.keys(diff.tokens.removed).length}`);
      lines.push(`- shell vs web body attributes: changed=${Object.keys(diff.bodyAttributes.changed).length} added=[${Object.keys(diff.bodyAttributes.added).join(', ')}]`);
      lines.push(`- desktop-only body attributes: [${diff.desktopOnly.bodyAttributes.join(', ')}]`);
      lines.push(`- desktop-only tokens: [${diff.desktopOnly.tokens.slice(0, 20).join(', ')}]`);
    }
    for (const error of (shell.result?.consoleErrors ?? []).slice(0, 20)) lines.push(`- console error: ${error}`);
  }
  if (report.pluginValidation) {
    lines.push('', '## Plugin validation', '');
    for (const entry of report.pluginValidation.entries ?? []) {
      const label = entry.resolved?.name ?? entry.resolved?.spec ?? 'plugin';
      const blockers = (entry.findings ?? []).filter((item) => item.severity === 'blocker').length;
      const warnings = (entry.findings ?? []).filter((item) => item.severity === 'warn').length;
      lines.push(`- ${label}: blockers=${blockers}, warnings=${warnings}`);
      for (const item of entry.findings ?? []) {
        if (item.severity === 'info') continue;
        lines.push(`  - [${item.severity}] ${item.id}: ${item.message}`);
      }
    }
  }
  if (report.fixture) {
    lines.push('', '## Fixed fixture', '');
    lines.push(`- session: ${report.fixture.sessionId}`);
    lines.push(`- workspace: ${report.fixture.workspaceId} (${report.fixture.workspace})`);
    lines.push(`- events: ${report.fixture.events}`);
    lines.push(`- types: ${(report.fixture.types ?? []).join(', ')}`);
  }
  if (report.mockModel) {
    lines.push('', '## Loopback mock model', '');
    lines.push(`- provider/model: ${report.mockModel.provider}/${report.mockModel.model}`);
    lines.push(`- session: ${report.mockModel.sessionId}`);
    lines.push(`- requests: ${report.mockModel.requests}`);
    lines.push(`- turn ended: ${report.mockModel.turnEnded}`);
    lines.push(`- event types: ${(report.mockModel.eventTypes ?? []).join(', ')}`);
  }
  if (report.agentCoverage) {
    lines.push('', '## Agent coverage', '');
    lines.push(`- mode: ${report.agentCoverage.mode}`);
    lines.push(`- real model requests: ${report.agentCoverage.realModelRequests === true}`);
    lines.push(`- credentials copied: ${report.agentCoverage.credentialsFound === true}`);
    lines.push(`- covered: ${(report.agentCoverage.covered ?? []).join('; ')}`);
    lines.push(`- not covered: ${(report.agentCoverage.uncovered ?? []).join('; ')}`);
  }
  if (report.settings) {
    lines.push('', '## Settings page', '');
    lines.push(`- total slots after opening settings: ${report.settings.totalSlots}`);
    lines.push(`- slots added by the settings page: [${(report.settings.added ?? []).join(', ')}]`);
  }
  if (report.errors?.length) {
    lines.push('', '## Errors', '');
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  lines.push('', '## Artifacts', '');
  for (const [name, file] of Object.entries(report.artifacts ?? {})) {
    lines.push(`- ${name}: ${file}`);
  }
  return `${lines.join('\n')}\n`;
}
