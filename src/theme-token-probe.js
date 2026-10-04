/** Diff one plain string map (theme tokens or body attributes). */
export function diffStringMap(before = {}, after = {}) {
  const changed = {};
  const added = {};
  const removed = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const had = Object.hasOwn(before ?? {}, key);
    const has = Object.hasOwn(after ?? {}, key);
    if (!had && has) added[key] = after[key];
    else if (had && !has) removed[key] = before[key];
    else if (before[key] !== after[key]) changed[key] = { before: before[key], after: after[key] };
  }
  return { changed, added, removed };
}

function ownersToConflicts(owners) {
  return [...owners.entries()]
    .filter(([, runs]) => new Set(runs).size > 1)
    .map(([key, runs]) => ({ key, runs: [...new Set(runs)] }));
}

/** Detect tokens or body attributes touched by two or more runs. */
export function detectEffectConflicts(runs) {
  const tokenOwners = new Map();
  const attributeOwners = new Map();
  const add = (map, key, runId) => {
    const list = map.get(key) ?? [];
    list.push(runId);
    map.set(key, list);
  };
  for (const run of runs) {
    for (const key of [...Object.keys(run.tokens?.changed ?? {}), ...Object.keys(run.tokens?.added ?? {})]) {
      add(tokenOwners, key, run.id);
    }
    for (const key of [...Object.keys(run.bodyAttributes?.changed ?? {}), ...Object.keys(run.bodyAttributes?.added ?? {})]) {
      add(attributeOwners, key, run.id);
    }
  }
  return {
    tokens: ownersToConflicts(tokenOwners),
    bodyAttributes: ownersToConflicts(attributeOwners),
  };
}
