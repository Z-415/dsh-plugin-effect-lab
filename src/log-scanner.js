/**
 * Failure fingerprints harvested from DSH 0.2.x boot logs and the reference
 * labs. Each hit carries a root cause and a suggested fix.
 */
export const SIGNATURES = [
  {
    id: 'duplicate-loader-id',
    pattern: /duplicate loader entry id[:\s]+([A-Za-z0-9@/_.-]+)/i,
    severity: 'fatal',
    rootCause: 'Two loader entries share one id, so the profile tree refuses to mount.',
    fix: 'Remove or rename the duplicate cordis.patch.yml entry; keep a single id per plugin.',
  },
  {
    id: 'duplicate-tool',
    pattern: /tool ["']([A-Za-z0-9_]+)["'] is already registered/i,
    severity: 'fatal',
    rootCause: 'Two plugins register the same model tool name.',
    fix: 'Rename one tool and update its prompt/docs references.',
  },
  {
    id: 'keyed-slot-requires-key',
    pattern: /keyed slot ["']([^"']+)["'] requires options\.key|list slot ["']([^"']+)["'] requires options\.id/i,
    severity: 'fatal',
    rootCause: 'A client slot registration does not match the host slot kind.',
    fix: 'Register both key and id so the slot store accepts either declared kind.',
  },
  {
    id: 'missing-module',
    pattern: /Cannot find module ["']([^"']+)["']|ERR_MODULE_NOT_FOUND/i,
    severity: 'fatal',
    rootCause: 'A plugin entry or one of its imports cannot resolve.',
    fix: 'Check the package main/exports, build output, and profile node_modules layout.',
  },
  {
    id: 'plugin-tree-failed',
    pattern: /plugin tree failed to load|failed to apply loader entry/i,
    severity: 'fatal',
    rootCause: 'The composed plugin tree failed while applying one loader entry.',
    fix: 'Use the named entry in the surrounding log and disable or fix that plugin first.',
  },
  {
    id: 'yaml-parse-error',
    pattern: /YAMLException|bad indentation of a mapping entry|unknown tag|unresolved tag|must be a top-level YAML array/i,
    severity: 'fatal',
    rootCause: 'A cordis.patch.yml layer is not a valid top-level YAML array.',
    fix: 'Keep [] as an empty placeholder or emit a proper list of patch entries.',
  },
  {
    id: 'fiber-pending',
    pattern: /fiber (?:is )?(?:still )?pending|waiting for fiber|startup timed out/i,
    severity: 'fatal',
    rootCause: 'A plugin never settled during startup.',
    fix: 'Inspect that plugin fiber and its injected services; remove the blocking await.',
  },
  {
    id: 'atomic-write-eperm',
    pattern: /EPERM[^\n]*rename|atomic write[^\n]*failed|operation not permitted[^\n]*rename/i,
    severity: 'fatal',
    rootCause: 'An atomic profile or storage write could not replace its target file.',
    fix: 'Stop the writer that holds the file, then retry in the isolated profile.',
  },
  {
    id: 'schemastery-volatile-missing',
    pattern: /field\.volatile is not a function|\.volatile is not a function/i,
    severity: 'fatal',
    rootCause: 'The resolved @deepseek-ai/schemastery copy is older than the plugin declares.',
    fix: 'Align schemastery to >=3.18.4 in the isolated profile.',
  },
  {
    id: 'configforms-missing',
    pattern: /this\.forms\.configure is not a function|configForms/i,
    severity: 'fatal',
    rootCause: 'A plugin expects the 0.2.x configForms service but the profile is on an older surface.',
    fix: 'Use the 0.2.0-rc.2 runtime and a plugin build that targets it.',
  },
  {
    id: 'peer-conflict',
    pattern: /Conflicting peer dependencies:|missing peer @deepseek-ai\/[a-z-]+@/i,
    severity: 'warning',
    rootCause: 'A plugin peer range disagrees with the host, but the host copy may still resolve.',
    fix: 'Boot-verify the plugin; bump the peer range if it loads cleanly.',
  },
];

/** Non-fatal environment noise that must never be reported as a blocker. */
export const NOISE = [
  { id: 'dep0180-fs-stats', pattern: /DEP0180|fs\.Stats constructor is deprecated/i },
];

export function scanLogs(text) {
  const input = String(text ?? '');
  if (!input) return [];
  const hits = [];
  for (const signature of SIGNATURES) {
    const match = input.match(signature.pattern);
    if (!match) continue;
    hits.push({
      id: signature.id,
      severity: signature.severity,
      matched: match[0].trim().slice(0, 240),
      rootCause: signature.rootCause,
      fix: signature.fix,
    });
  }
  return hits;
}

export function scanNoise(text) {
  const input = String(text ?? '');
  return NOISE.filter((item) => item.pattern.test(input)).map((item) => ({ id: item.id }));
}

export function hasFatal(hits) {
  return hits.some((hit) => hit.severity === 'fatal');
}

export function summarize(hits) {
  if (!hits?.length) return 'No known failure signatures matched.';
  const fatal = hits.filter((hit) => hit.severity === 'fatal');
  const warn = hits.filter((hit) => hit.severity !== 'fatal');
  const lines = [];
  if (fatal.length) {
    lines.push(`BLOCKER (${fatal.length}):`);
    for (const hit of fatal) lines.push(`  - [${hit.id}] ${hit.rootCause} -> ${hit.fix}`);
  }
  if (warn.length) {
    lines.push(`WARNINGS (${warn.length}):`);
    for (const hit of warn) lines.push(`  - [${hit.id}] ${hit.rootCause} -> ${hit.fix}`);
  }
  return lines.join('\n');
}
