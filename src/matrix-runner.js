import fs from 'node:fs';
import path from 'node:path';
import { defaultArtifactsRoot } from './config.js';
import { classifyMatrixRuns } from './effect-classifier.js';
import { diffLayers } from './electron-shell/shell-probe.js';
import { runLab } from './runner.js';
import { discoverRuntimes } from './runtime-locator.js';
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
    `# DSH 插件效果实验舱 · 组合矩阵 - ${result.matrixId}`,
    '',
    `- 基线: ${result.baselineId}`,
    `- 运行数: ${result.runs.length}`,
    `- 结论: ${result.ok ? '通过' : '未通过'}`,
    '',
    '## 运行',
    '',
  ];
  for (const run of result.runs) lines.push(`- [${run.ok ? '通过' : '失败'}] ${run.id}: ${run.runDir}`);
  lines.push('', '## 与基线的差异', '');
  for (const run of result.compared) {
    lines.push(`### ${run.id}`);
    if (run.classification) lines.push(`- 分类: ${run.classification}`);
    lines.push(`- token 变化: ${Object.keys(run.tokens.changed).length}，新增: ${Object.keys(run.tokens.added).length}`);
    lines.push(`- body 属性变化: ${Object.keys(run.bodyAttributes.changed).length}，新增: ${Object.keys(run.bodyAttributes.added).length}`);
    lines.push(`- 层叠变化: ${Object.keys(run.layers?.changed ?? {}).length}，新增: ${Object.keys(run.layers?.added ?? {}).length}`);
    lines.push(`- slot 新增: ${run.slots.added.length}，缺失: ${run.slots.removed.length}`);
    if (run.screenshotDiff) {
      lines.push(`- 截图: 完全一致=${run.screenshotDiff.identical === true} 像素变化比例=${run.screenshotDiff.changedRatio ?? 'n/a'}`);
    }
    for (const reason of run.classificationReasons ?? []) lines.push(`  - ${reason}`);
  }
  lines.push('', '## 冲突', '');
  if (!result.conflicts.tokens.length && !result.conflicts.bodyAttributes.length && !result.conflicts.slots.length && !result.conflicts.layers?.length) {
    lines.push('- 未检测到冲突');
  } else {
    for (const conflict of result.conflicts.tokens) lines.push(`- token ${conflict.key}: ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.bodyAttributes) lines.push(`- body 属性 ${conflict.key}: ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.layers ?? []) lines.push(`- 层叠 ${conflict.key} (z-index): ${conflict.runs.join(', ')}`);
    for (const conflict of result.conflicts.slots) lines.push(`- slot ${conflict.slot}: ${conflict.runs.join(', ')}`);
  }
  if (result.classification) {
    lines.push('', '## 分类', '');
    lines.push(`- 可共存 (coexist): ${result.classification.summary.coexist.join(', ') || '无'}`);
    lines.push(`- 需人工判断 (manual-review): ${result.classification.summary['manual-review'].join(', ') || '无'}`);
    lines.push(`- 高冲突 (high-conflict): ${result.classification.summary['high-conflict'].join(', ') || '无'}`);
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

function renderRuntimeMatrixMarkdown(summary) {
  const lines = [
    `# DSH 插件效果实验舱 · 版本矩阵 - ${summary.matrixId}`,
    '',
    `- 结论: ${summary.ok ? '通过' : '未通过'}`,
    `- 已跑版本: ${summary.runtimes.length}`,
    `- 跳过版本: ${summary.skipped.length}`,
    '',
    '## 各版本结果',
    '',
  ];
  for (const entry of summary.runtimes) {
    lines.push(`### ${entry.version ?? 'unknown'} [${entry.status ?? 'unknown'}]`);
    lines.push(`- launcher: ${entry.cmd}`);
    lines.push(`- 结论: ${entry.ok ? '通过' : '未通过'}（${entry.runCount} 个组合）`);
    if (entry.classification) {
      lines.push(`- 分类: coexist=${entry.classification.coexist.length}`
        + ` manual-review=${entry.classification['manual-review'].length}`
        + ` high-conflict=${entry.classification['high-conflict'].length}`);
    }
    if (entry.conflicts) {
      lines.push(`- 冲突: token=${entry.conflicts.tokens} body=${entry.conflicts.bodyAttributes}`
        + ` slot=${entry.conflicts.slots} layer=${entry.conflicts.layers}`);
    }
    lines.push(`- 产物: ${entry.runDir}`);
    lines.push('');
  }
  if (summary.skipped.length) {
    lines.push('## 跳过', '');
    for (const entry of summary.skipped) {
      lines.push(`- ${entry.version ?? 'unknown'}: ${entry.detail ?? entry.error ?? 'unsupported'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Run the same matrix once per discovered official runtime.
 *
 * This is the "adapt to different DSH versions" loop: install/keep more than
 * one launcher, list them with `lab runtimes`, and run this to see whether a
 * plugin's effect and conflicts are the same on each version. Runtimes outside
 * the supported range are skipped and reported, never run.
 */
export async function runRuntimeMatrix(options = {}) {
  const runMatrixImpl = options.runMatrixImpl ?? runMatrix;
  const runtimes = options.runtimes ?? await discoverRuntimes({
    runtimePath: options.runtimePath,
    timeoutMs: options.runtimeTimeoutMs,
  });
  const usable = runtimes.filter((runtime) => runtime.supported !== false);
  const skipped = runtimes.filter((runtime) => runtime.supported === false);
  if (!usable.length) throw new Error(`no supported dsh runtime found (${runtimes.length} discovered)`);

  const baseId = options.matrixId ?? `runtime-matrix-${makeRunId()}`;
  const root = path.join(options.artifactsRoot ?? defaultArtifactsRoot(), baseId);
  ensureDir(root);

  const entries = [];
  for (const runtime of usable) {
    const label = String(runtime.version ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
    const result = await runMatrixImpl({
      config: options.config,
      configFile: options.configFile,
      runtimePath: runtime.cmd,
      browserPath: options.browserPath,
      artifactsRoot: root,
      online: options.online === true,
      html: options.html,
      matrixId: `${baseId}-${label}`,
    });
    entries.push({
      cmd: runtime.cmd,
      version: runtime.version,
      status: runtime.status,
      verified: runtime.verified === true,
      matrixId: result.matrixId,
      ok: result.ok,
      runCount: result.runs.length,
      classification: result.classification?.summary
        ? {
          coexist: result.classification.summary.coexist ?? [],
          'manual-review': result.classification.summary['manual-review'] ?? [],
          'high-conflict': result.classification.summary['high-conflict'] ?? [],
        }
        : null,
      conflicts: {
        tokens: result.conflicts.tokens.length,
        bodyAttributes: result.conflicts.bodyAttributes.length,
        slots: result.conflicts.slots.length,
        layers: result.conflicts.layers?.length ?? 0,
      },
      runDir: result.root,
    });
  }

  const summary = {
    matrixId: baseId,
    ok: entries.every((entry) => entry.ok),
    runtimes: entries,
    skipped: skipped.map((runtime) => ({
      cmd: runtime.cmd,
      version: runtime.version,
      status: runtime.status,
      detail: runtime.detail,
      error: runtime.error ?? null,
    })),
    artifacts: {
      root,
      summaryJson: path.join(root, 'runtime-matrix.json'),
      summaryMd: path.join(root, 'runtime-matrix.md'),
    },
  };
  fs.writeFileSync(summary.artifacts.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(summary.artifacts.summaryMd, renderRuntimeMatrixMarkdown(summary), 'utf8');
  return summary;
}
