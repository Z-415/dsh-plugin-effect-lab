/**
 * Classify theme/effect combinations for acceptance case D.
 *
 * Three outcomes:
 *   high-conflict   two runs set the same token / body attribute / layer
 *                   z-index to different values, or a run failed to boot
 *   manual-review   a run changed theme properties that need a human visual
 *                   decision, with no mechanical collision
 *   coexist         a run changed nothing on the theme axes (additive-only)
 *
 * The classifier reads absolute DOM values, so "same key, same value" is
 * cooperation and "same key, different value" is a collision.
 */

export const AXES = ['tokens', 'bodyAttributes', 'layers'];

function valueOf(value) {
  return value === undefined || value === null ? '' : String(value);
}

/** Keys whose value differs between two string maps. */
export function changedStringKeys(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((key) => valueOf(before?.[key]) !== valueOf(after?.[key])).sort();
}

/** Flatten a probe's stacking layers into `key -> zIndex`. */
export function layerIndex(dom = {}) {
  const index = {};
  for (const layer of dom?.layers ?? []) index[layer.key] = layer.zIndex;
  return index;
}

function axisMap(dom, axis) {
  if (axis === 'layers') return layerIndex(dom);
  return dom?.[axis] ?? {};
}

function collectAxis(baselineDom, candidates, axis) {
  const baseline = axisMap(baselineDom, axis);
  const byRun = new Map();
  const byKey = new Map();
  for (const run of candidates) {
    const current = axisMap(run.dom, axis);
    const changed = changedStringKeys(baseline, current);
    byRun.set(run.id, changed);
    for (const key of changed) {
      const list = byKey.get(key) ?? [];
      list.push({ run: run.id, value: current[key] ?? baseline[key] ?? '' });
      byKey.set(key, list);
    }
  }
  return { byRun, byKey };
}

/**
 * Classify each non-baseline run. `runs` entries need `{ id, baseline?, booted,
 * dom, notes? }`. `booted: false` means the run produced no DOM; a failed
 * non-boot check or a console warning is a note, not a conflict.
 */
export function classifyMatrixRuns(runs = []) {
  const baseline = runs.find((run) => run.baseline) ?? runs[0] ?? null;
  const candidates = runs.filter((run) => run !== baseline);
  const axes = Object.fromEntries(
    AXES.map((axis) => [axis, collectAxis(baseline?.dom ?? {}, candidates, axis)]),
  );

  const hardConflicts = [];
  const sharedValues = [];
  for (const axis of AXES) {
    for (const [key, entries] of axes[axis].byKey) {
      if (entries.length < 2) continue;
      const distinct = new Set(entries.map((entry) => valueOf(entry.value)));
      const detail = { axis, key, entries };
      if (distinct.size > 1) hardConflicts.push(detail);
      else sharedValues.push(detail);
    }
  }
  const hardKeys = new Set(hardConflicts.map((conflict) => `${conflict.axis}:${conflict.key}`));

  const results = candidates.map((run) => {
    const changed = Object.fromEntries(AXES.map((axis) => [axis, axes[axis].byRun.get(run.id) ?? []]));
    const collisions = hardConflicts.filter(
      (conflict) => changed[conflict.axis].includes(conflict.key),
    );
    const notes = (run.notes ?? []).filter(Boolean);
    const touched = Object.values(changed).reduce((sum, list) => sum + list.length, 0);

    let classification = 'coexist';
    const reasons = [];
    if (run.booted === false) {
      classification = 'high-conflict';
      reasons.push('run produced no DOM (boot failed)');
    } else if (collisions.length) {
      classification = 'high-conflict';
      for (const collision of collisions) {
        reasons.push(`${collision.axis} ${collision.key}: ${collision.entries.map((e) => `${e.run}=${e.value}`).join(' vs ')}`);
      }
    } else if (touched > 0) {
      classification = 'manual-review';
      reasons.push(`${touched} theme value(s) changed without a direct collision`);
    } else {
      reasons.push('no token/body/layer change versus baseline');
    }
    return { id: run.id, classification, changed, collisions, reasons, notes };
  });

  const summary = {
    'high-conflict': results.filter((item) => item.classification === 'high-conflict').map((item) => item.id),
    'manual-review': results.filter((item) => item.classification === 'manual-review').map((item) => item.id),
    coexist: results.filter((item) => item.classification === 'coexist').map((item) => item.id),
  };
  return { baselineId: baseline?.id ?? null, results, hardConflicts, sharedValues, summary };
}
