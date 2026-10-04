import fs from 'node:fs';
import path from 'node:path';
import { defaultArtifactsRoot } from './config.js';
import { classifyMatrixRuns } from './effect-classifier.js';
import { diffLayers } from './electron-shell/shell-probe.js';
import { runLab } from './runner.js';
import { compareScreenshots } from './screenshot-diff.js';
import { writeHtmlReport } from './html-report.js';
import { detectSlotConflicts, diffSlots } from './slot-probe.js';
import { detectEffectConflicts, diffStringMap } from './theme-token-probe.js';
import { ensureDir, makeRunId } from './util.js';

export function readMatrixConfig(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`matrix config must be JSON in Phase 2: ${error.message}`);
  }
}

function renderMatrixMarkdown(result) {
  const lines = [
    `# DSH Plugin Effect Lab matrix - ${result.matrixId}`,
    '',
    `- baseline: ${result.baselineId}`,
    `- runs: ${result.runs.length}`,
    `- ok: ${result.ok}`,
    '',
    '## Runs',
    '',
  ];
  for (const run of result.runs) lines.push(`- [${run.ok ? 'PASS' : 'FAIL'}] ${run.id}: ${run.runDir}`);
  lines.push('', '## Compared to baseline', '');
  for (const run of result.compared) {
    lines.push(`### ${run.id}`);
    if (run.classification) lines.push(`- classification: ${run.classification}`);
    lines.push(`- tokens changed: ${Object.keys(run.tokens.changed).length}, added: ${Object.keys(run.tokens.added).length}`);
    lines.push(`- body attributes changed: ${Object.keys(run.bodyAttributes.changed).length}, added: ${Object.keys(run.bodyAttributes.added).length}`);
    lines.push(`- layers changed: ${Object.keys(run.layers?.changed ?? {}).length}, added: ${Object.keys(run.layers?.added ?? {}).length}`);
    lines.push(`- slots added: ${run.slots.added.length}, removed: ${run.slots.removed.length}`);
    if (run.screenshotDiff) {
      lines.push(`- screenshot: identical=${run.screenshotDiff.identical === true} changedRatio=${run.screenshotDiff.changedRatio ?? 'n/a'}`);
    }
    for (const reason of run.classificationReasons ?? []) lines.push(`  - ${reason}`);
  }
  lines.push('', '## Conflicts', '');
  if (!result.conflicts.tokens.length && !result.conflicts.bodyAttributes.length && !result.conflicts.slots.length && !result.conflicts.layers?.length) {
    lines.push('- none detected');
  } else {
    for (const conflict of result.conflicts.tokens) lines.push(`- token ${conflict.key}: ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.bodyAttributes) lines.push(`- body attribute ${conflict.key}: ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.layers ?? []) lines.push(`- layer ${conflict.key} (z-index): ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.slots) lines.push(`- slot ${conflict.slot}: ${conflict.runs.join(', ')}`);
  }
  if (result.classification) {
    lines.push('', '## Classification', '');
    lines.push(`- coexist: ${result.classification.summary.coexist.join(', ') || 'none'}`);
    lines.push(`- manual-review: ${result.classification.summary['manual-review'].join(', ') || 'none'}`);
    lines.push(`- high-conflict: ${result.classification.summary['high-conflict'].join(', ') || 'none'}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Run one baseline plus N plugin combinations, then compare DOM effects.
 * Config is JSON: `{ baselineId, runs: [{ id, plugins: [...], ... }] }`.
 */
export async function runMatrix(options = {}) {
  const config = options.config ?? readMatrixConfig(options.configFile);
  const matrixId = options.matrixId ?? `matrix-${makeRunId()}`;
  const root = path.join(options.artifactsRoot ?? defaultArtifactsRoot(), matrixId);
  ensureDir(root);
  const runs = [];
  for (const definition of config.runs ?? []) {
    const report = await runLab({
      mode: 'matrix',
      runtimePath: options.runtimePath,
      browserPath: options.browserPath,
      plugins: definition.plugins ?? [],
      fixture: definition.fixture === true,
      screenshots: definition.screenshots ?? ['home'],
      assertTokens: definition.assertTokens ?? ['--dsw-alias-bg-base'],
      artifactsRoot: path.join(root, definition.id),
      online: options.online === true,
    });
    runs.push({ id: definition.id, report, dom: report.browser?.dom ?? null });
  }
  if (!runs.length) throw new Error('matrix config has no runs');
  const baseline = runs.find((run) => run.id === config.baselineId) ?? runs[0];
  const compared = [];
  for (const run of runs.filter((candidate) => candidate !== baseline)) {
    const entry = {
      id: run.id,
      ok: run.report.ok,
      runDir: run.report.runDir,
      tokens: diffStringMap(baseline.dom?.tokens, run.dom?.tokens),
      bodyAttributes: diffStringMap(baseline.dom?.bodyAttributes, run.dom?.bodyAttributes),
      layers: diffLayers(baseline.dom?.layers ?? [], run.dom?.layers ?? []),
      slots: diffSlots(baseline.dom?.slots, run.dom?.slots),
    };
    const before = baseline.report.artifacts?.screenshots?.home;
    const after = run.report.artifacts?.screenshots?.home;
    if (before && after && fs.existsSync(before) && fs.existsSync(after)) {
      try {
        const shot = await compareScreenshots({ before, after, browserPath: options.browserPath });
        entry.screenshotDiff = {
          identical: shot.identical,
          dimensionsMatch: shot.dimensionsMatch,
          changedRatio: shot.pixels?.changedRatio ?? null,
          changedPixels: shot.pixels?.changedPixels ?? null,
        };
      } catch (error) {
        entry.screenshotDiff = { error: String(error?.message ?? error) };
      }
    }
    compared.push(entry);
  }
  const conflictRuns = compared.map((run) => ({
    id: run.id,
    tokens: run.tokens,
    bodyAttributes: run.bodyAttributes,
    slots: run.slots,
  }));
  const conflicts = {
    ...detectEffectConflicts(conflictRuns),
    slots: detectSlotConflicts(conflictRuns),
    layers: [],
  };
  const classification = classifyMatrixRuns(runs.map((run) => ({
    id: run.id,
    baseline: run === baseline,
    booted: Boolean(run.report.browser?.dom),
    dom: run.dom,
    notes: [
      ...(run.report.browser?.consoleErrors ?? []).map((message) => `console: ${message}`),
      ...(run.report.checks ?? [])
        .filter((check) => !check.pass && check.informational !== true)
        .map((check) => `check: ${check.name} (${check.detail ?? ''})`),
    ],
  })));
  for (const conflict of classification.hardConflicts) {
    if (conflict.axis !== 'layers') continue;
    conflicts.layers.push({ key: conflict.key, runs: conflict.entries.map((entry) => entry.run) });
  }
  const byId = new Map(classification.results.map((item) => [item.id, item]));
  for (const run of compared) {
    const item = byId.get(run.id);
    if (!item) continue;
    run.classification = item.classification;
    run.classificationReasons = item.reasons;
  }
  const result = {
    matrixId,
    baselineId: baseline.id,
    ok: runs.every((run) => run.report.ok)
      && conflicts.tokens.length === 0
      && conflicts.layers.length === 0
      && classification.summary['high-conflict'].length === 0,
    runs: runs.map((run) => ({
      id: run.id,
      ok: run.report.ok,
      runDir: run.report.runDir,
      screenshots: run.report.artifacts?.screenshots ?? {},
    })),
    compared,
    conflicts,
    classification,
    root,
  };
  result.artifacts = {
    root,
    matrixJson: path.join(root, 'matrix.json'),
    matrixMd: path.join(root, 'matrix.md'),
    ...(options.html === false ? {} : { matrixHtml: path.join(root, 'matrix.html') }),
  };
  fs.writeFileSync(result.artifacts.matrixJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(result.artifacts.matrixMd, renderMatrixMarkdown(result), 'utf8');
  if (options.html !== false) {
    try {
      writeHtmlReport(root, result, { matrix: true });
    } catch (error) {
      result.artifacts.matrixHtmlError = String(error);
    }
  }
  return result;
}
