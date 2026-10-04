import { runMatrix } from '../matrix-runner.js';

export async function runMatrixCommand(options) {
  if (!options.configFile) {
    process.stderr.write('matrix needs --config <file.json>\n');
    return 2;
  }
  const result = await runMatrix({
    configFile: options.configFile,
    artifactsRoot: options.artifactsRoot,
    runtimePath: options.runtimePath,
    browserPath: options.browserPath,
    online: options.online === true,
    html: options.html,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const hasConflicts = result.conflicts.tokens.length > 0
      || result.conflicts.bodyAttributes.length > 0
      || (result.conflicts.layers?.length ?? 0) > 0
      || result.conflicts.slots.length > 0;
    const headline = result.ok
      ? '通过'
      : hasConflicts ? '未通过（检测到冲突）' : '未通过';
    process.stdout.write(`DSH 插件效果实验舱 · 组合矩阵: ${headline} (${result.matrixId})\n`);
    for (const run of result.runs) process.stdout.write(`[${run.ok ? '通过' : '失败'}] ${run.id}: ${run.runDir}\n`);
    for (const conflict of result.conflicts.tokens) process.stdout.write(`[冲突] token ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.bodyAttributes) process.stdout.write(`[冲突] body 属性 ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.layers ?? []) process.stdout.write(`[冲突] 层叠 z-index ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.slots) process.stdout.write(`[冲突] slot ${conflict.slot}: ${conflict.runs.join(', ')}\n`);
    if (!hasConflicts) {
      process.stdout.write('未检测到冲突\n');
    }
    for (const run of result.compared) {
      if (!run.screenshotDiff) continue;
      process.stdout.write(`[截图] ${run.id}: 完全一致=${run.screenshotDiff.identical === true} 像素变化比例=${run.screenshotDiff.changedRatio ?? 'n/a'}\n`);
    }
    if (result.classification) {
      const { summary } = result.classification;
      process.stdout.write(`[分类] 可共存 coexist: ${summary.coexist.join(', ') || '无'}\n`);
      process.stdout.write(`[分类] 需人工判断 manual-review: ${summary['manual-review'].join(', ') || '无'}\n`);
      process.stdout.write(`[分类] 高冲突 high-conflict: ${summary['high-conflict'].join(', ') || '无'}\n`);
    }
  }
  return result.ok ? 0 : 1;
}
