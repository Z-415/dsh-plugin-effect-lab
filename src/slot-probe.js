/** Diff slot names between a baseline DOM and one candidate DOM. */
export function diffSlots(before = [], after = []) {
  const left = new Set(before ?? []);
  const right = new Set(after ?? []);
  return {
    added: [...right].filter((name) => !left.has(name)).sort(),
    removed: [...left].filter((name) => !right.has(name)).sort(),
  };
}

/** Detect slots added by two or more candidate runs. */
export function detectSlotConflicts(runs) {
  const owners = new Map();
  for (const run of runs) {
    for (const slot of run.slots?.added ?? []) {
      const list = owners.get(slot) ?? [];
      list.push(run.id);
      owners.set(slot, list);
    }
  }
  return [...owners.entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([slot, ids]) => ({ slot, runs: [...new Set(ids)] }));
}
