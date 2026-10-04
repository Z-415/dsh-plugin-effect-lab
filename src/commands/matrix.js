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
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const hasConflicts = result.conflicts.tokens.length > 0
      || result.conflicts.bodyAttributes.length > 0
      || (result.conflicts.layers?.length ?? 0) > 0
      || result.conflicts.slots.length > 0;
    const headline = result.ok
      ? 'PASS'
      : hasConflicts ? 'FAIL (conflicts detected)' : 'FAIL';
    process.stdout.write(`DSH Plugin Effect Lab matrix: ${headline} (${result.matrixId})\n`);
    for (const run of result.runs) process.stdout.write(`[${run.ok ? 'PASS' : 'FAIL'}] ${run.id}: ${run.runDir}\n`);
    for (const conflict of result.conflicts.tokens) process.stdout.write(`[CONFLICT] token ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.bodyAttributes) process.stdout.write(`[CONFLICT] body attribute ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.layers ?? []) process.stdout.write(`[CONFLICT] layer z-index ${conflict.key}: ${conflict.runs.join(', ')}\n`);
    for (const conflict of result.conflicts.slots) process.stdout.write(`[CONFLICT] slot ${conflict.slot}: ${conflict.runs.join(', ')}\n`);
    if (!hasConflicts) {
      process.stdout.write('no conflicts detected\n');
    }
    for (const run of result.compared) {
      if (!run.screenshotDiff) continue;
      process.stdout.write(`[SHOT] ${run.id}: identical=${run.screenshotDiff.identical === true} changedRatio=${run.screenshotDiff.changedRatio ?? 'n/a'}\n`);
    }
    if (result.classification) {
      const { summary } = result.classification;
      process.stdout.write(`[CLASS] coexist: ${summary.coexist.join(', ') || 'none'}\n`);
      process.stdout.write(`[CLASS] manual-review: ${summary['manual-review'].join(', ') || 'none'}\n`);
      process.stdout.write(`[CLASS] high-conflict: ${summary['high-conflict'].join(', ') || 'none'}\n`);
    }
  }
  return result.ok ? 0 : 1;
}
