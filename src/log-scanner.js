/**
 * Failure fingerprints harvested from DSH 0.2.x boot logs, the browser
 * console, and the reference labs. Each entry maps a log fragment to a
 * category, a root cause, and a suggested fix.
 *
 * Categories tell the next reader *where* to look: `boot` (host startup),
 * `plugin` (loader/apply/tool/injection), `client` (renderer module/slot),
 * `profile` (bundles/YAML), `env` (filesystem/OS), `runtime` (service
 * surface), `crash` (process died).
 *
 * Patterns must stay specific: a false fatal here fails a whole run, so
 * nothing broader than a real failure sentence belongs here. Add a positive
 * *and* a benign negative test in `tests/unit/log-scanner.test.js` for each.
 */
/** The stable code a failed run gets when no signature matched. */
export const UNKNOWN_CODE = 'LAB-UNKNOWN';

export const SIGNATURES = [
  {
    id: 'duplicate-loader-id',
    code: 'LAB-PLUGIN-001',
    category: 'plugin',
    pattern: /duplicate loader entry id[:\s]+([A-Za-z0-9@/_.-]+)/i,
    severity: 'fatal',
    rootCause: 'Two loader entries share one id, so the profile tree refuses to mount.',
    fix: 'Remove or rename the duplicate cordis.patch.yml entry; keep a single id per plugin.',
  },
  {
    id: 'duplicate-tool',
    code: 'LAB-PLUGIN-002',
    category: 'plugin',
    pattern: /tool ["']([A-Za-z0-9_]+)["'] is already registered/i,
    severity: 'fatal',
    rootCause: 'Two plugins register the same model tool name.',
    fix: 'Rename one tool and update its prompt/docs references.',
  },
  {
    id: 'keyed-slot-requires-key',
    code: 'LAB-CLIENT-001',
    category: 'client',
    pattern: /keyed slot ["']([^"']+)["'] requires options\.key|list slot ["']([^"']+)["'] requires options\.id/i,
    severity: 'fatal',
    rootCause: 'A client slot registration does not match the host slot kind.',
    fix: 'Register both key and id so the slot store accepts either declared kind.',
  },
  {
    id: 'unknown-slot-kind',
    code: 'LAB-CLIENT-002',
    category: 'client',
    pattern: /unknown slot kind|unregistered slot kind|slot kind ["'][^"']*["'] is not registered/i,
    severity: 'fatal',
    rootCause: 'A client registers a slot kind the host slot store does not know.',
    fix: 'Use a slot kind declared by 0.2.0-rc.2, or register a plain data-slot element instead.',
  },
  {
    id: 'missing-module',
    code: 'LAB-PLUGIN-003',
    category: 'plugin',
    pattern: /Cannot find module ["']([^"']+)["']|ERR_MODULE_NOT_FOUND/i,
    severity: 'fatal',
    rootCause: 'A plugin entry or one of its imports cannot resolve.',
    fix: 'Check the package main/exports, build output, and profile node_modules layout.',
  },
  {
    id: 'plugin-tree-failed',
    code: 'LAB-PLUGIN-004',
    category: 'plugin',
    pattern: /plugin tree failed to load|failed to apply loader entry/i,
    severity: 'fatal',
    rootCause: 'The composed plugin tree failed while applying one loader entry.',
    fix: 'Use the named entry in the surrounding log and disable or fix that plugin first.',
  },
  {
    id: 'unresolved-service',
    code: 'LAB-PLUGIN-005',
    category: 'plugin',
    pattern: /cannot (?:get|resolve|find) (?:the )?service ["']?([A-Za-z0-9_.:/-]+)|service ["']([A-Za-z0-9_.:/-]+)["'] is not (?:found|registered|available)/i,
    severity: 'fatal',
    rootCause: 'A plugin injected a service the host never registered (often a desktop-only service in web mode).',
    fix: 'Guard the injection behind the plugin platform check, or run the plugin in `lab shell` where the service exists.',
  },
  {
    id: 'engines-unsatisfied',
    code: 'LAB-PLUGIN-006',
    category: 'plugin',
    pattern: /unsupported engine|engines?[^\n]{0,40}does not satisfy|engine [^\n]{0,40}is incompatible/i,
    severity: 'fatal',
    rootCause: 'A plugin declares an engines range the current DSH runtime does not satisfy.',
    fix: 'Install a build that supports 0.2.0-rc.2, or record the stated range as the incompatibility.',
  },
  {
    id: 'yaml-parse-error',
    code: 'LAB-PROFILE-001',
    category: 'profile',
    pattern: /YAMLException|bad indentation of a mapping entry|unknown tag|unresolved tag|must be a top-level YAML array/i,
    severity: 'fatal',
    rootCause: 'A cordis.patch.yml layer is not a valid top-level YAML array.',
    fix: 'Keep [] as an empty placeholder or emit a proper list of patch entries.',
  },
  {
    id: 'bundle-patch-missing',
    code: 'LAB-PROFILE-002',
    category: 'profile',
    pattern: /bundle patch[^\n]{0,60}not found|cannot (?:find|load) bundle patch|missing bundle patch/i,
    severity: 'fatal',
    rootCause: 'A profile bundle points at a patch file that does not exist.',
    fix: 'Fix the bundle path in the plugin manifest and reinstall it into the isolated profile.',
  },
  {
    id: 'bundle-dependency-mismatch',
    code: 'LAB-PROFILE-003',
    category: 'profile',
    pattern: /bundle ["']([^"']+)["'] has no matching dependency/i,
    severity: 'fatal',
    rootCause: 'The profile lists a bundle that is not installed as a dependency, so the tree cannot compose.',
    fix: 'Reinstall or remove the plugin, and trim dsh.profile.bundles to match dependencies.',
  },
  {
    id: 'fiber-pending',
    code: 'LAB-BOOT-001',
    category: 'boot',
    pattern: /fiber (?:is )?(?:still )?pending|waiting for fiber|startup timed out/i,
    severity: 'fatal',
    rootCause: 'A plugin never settled during startup.',
    fix: 'Inspect that plugin fiber and its injected services; remove the blocking await.',
  },
  {
    id: 'port-in-use',
    code: 'LAB-BOOT-002',
    category: 'boot',
    pattern: /EADDRINUSE|address already in use/i,
    severity: 'fatal',
    rootCause: 'The host could not bind its port because another process owns it.',
    fix: 'Let the lab pick `--port 0`; if it persists, find the owning process and stop it.',
  },
  {
    id: 'host-boot-timeout',
    code: 'LAB-BOOT-003',
    category: 'boot',
    pattern: /timed out waiting for (?:the )?dsh web|dsh web timed out|boot timeout after/i,
    severity: 'fatal',
    rootCause: 'The host never printed its readiness line within the timeout.',
    fix: 'Read boot.err.log for the real error first; the timeout is usually a symptom.',
  },
  {
    id: 'electron-main-crash',
    code: 'LAB-CRASH-001',
    category: 'crash',
    pattern: /A JavaScript error occurred in the main process|FATAL ERROR:|Segmentation fault/i,
    severity: 'fatal',
    rootCause: 'The Electron main process crashed while the shell was loading.',
    fix: 'Re-run with the same profile; if it repeats, bisect plugins and check the main-process stack.',
  },
  {
    id: 'client-module-load',
    code: 'LAB-CLIENT-003',
    category: 'client',
    pattern: /Failed to fetch dynamically imported module|does not provide an export named|Importing a module script failed|SyntaxError: Unexpected token '<'/i,
    severity: 'fatal',
    rootCause: 'The renderer could not load a plugin client module (often an HTML error page served instead of JS).',
    fix: 'Check exports["./client"], the bundle build output, and the host route that serves it.',
  },
  {
    id: 'atomic-write-eperm',
    code: 'LAB-ENV-001',
    category: 'env',
    pattern: /EPERM[^\n]*rename|atomic write[^\n]*failed|operation not permitted[^\n]*rename/i,
    severity: 'fatal',
    rootCause: 'An atomic profile or storage write could not replace its target file.',
    fix: 'Stop the writer that holds the file, then retry in the isolated profile.',
  },
  {
    id: 'permission-denied',
    code: 'LAB-ENV-002',
    category: 'env',
    pattern: /EACCES/i,
    severity: 'fatal',
    rootCause: 'A file or directory could not be opened for the requested access.',
    fix: 'Check the isolated home permissions and any read-only mount; the lab never needs admin rights.',
  },
  {
    id: 'path-too-long',
    code: 'LAB-ENV-003',
    category: 'env',
    pattern: /ENAMETOOLONG/i,
    severity: 'fatal',
    rootCause: 'A path exceeded the Windows limit while installing or loading a plugin.',
    fix: 'Shorten the lab temp root (see MAX_LAB_ROOT_LENGTH) or move the plugin source closer to the drive root.',
  },
  {
    id: 'schemastery-volatile-missing',
    code: 'LAB-RUNTIME-001',
    category: 'runtime',
    pattern: /field\.volatile is not a function|\.volatile is not a function/i,
    severity: 'fatal',
    rootCause: 'The resolved @deepseek-ai/schemastery copy is older than the plugin declares.',
    fix: 'Align schemastery to >=3.18.4 in the isolated profile.',
  },
  {
    id: 'configforms-missing',
    code: 'LAB-RUNTIME-002',
    category: 'runtime',
    pattern: /this\.forms\.configure is not a function|configForms/i,
    severity: 'fatal',
    rootCause: 'A plugin expects the 0.2.x configForms service but the profile is on an older surface.',
    fix: 'Use the 0.2.0-rc.2 runtime and a plugin build that targets it.',
  },
  {
    id: 'peer-conflict',
    code: 'LAB-PLUGIN-007',
    category: 'plugin',
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
      code: signature.code ?? UNKNOWN_CODE,
      category: signature.category ?? 'general',
      severity: signature.severity,
      matched: match[0].trim().slice(0, 240),
      rootCause: signature.rootCause,
      fix: signature.fix,
    });
  }
  return hits;
}

/**
 * Scan several inputs (boot logs, browser console errors, page errors, ...)
 * and dedupe hits by `id` + matched fragment, so one failure reported in two
 * places only shows up once.
 */
export function scanSources(sources) {
  const seen = new Set();
  const hits = [];
  for (const source of sources ?? []) {
    for (const hit of scanLogs(source)) {
      const key = `${hit.id}\u0000${hit.matched}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
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

/** The whole library, for `lab scan --list` and the docs table. */
export function listSignatures() {
  return SIGNATURES.map((signature) => ({
    id: signature.id,
    code: signature.code ?? UNKNOWN_CODE,
    category: signature.category ?? 'general',
    severity: signature.severity,
    rootCause: signature.rootCause,
    fix: signature.fix,
  }));
}

export function summarize(hits) {
  if (!hits?.length) return 'No known failure signatures matched.';
  const fatal = hits.filter((hit) => hit.severity === 'fatal');
  const warn = hits.filter((hit) => hit.severity !== 'fatal');
  const lines = [];
  if (fatal.length) {
    lines.push(`BLOCKER (${fatal.length}):`);
    for (const hit of fatal) lines.push(`  - [${hit.code ?? UNKNOWN_CODE}] ${hit.id} (${hit.category}) ${hit.rootCause} -> ${hit.fix}`);
  }
  if (warn.length) {
    lines.push(`WARNINGS (${warn.length}):`);
    for (const hit of warn) lines.push(`  - [${hit.code ?? UNKNOWN_CODE}] ${hit.id} (${hit.category}) ${hit.rootCause} -> ${hit.fix}`);
  }
  return lines.join('\n');
}

/**
 * The last `count` non-empty lines of a log, trimmed to a readable width.
 * Used when a run fails without matching any signature: the tail is often
 * enough to identify a new pattern, and it is far more useful than "clean".
 */
export function tailLines(text, count = 30, maxLineLength = 400) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0);
  return lines
    .slice(-Math.max(0, count))
    .map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line));
}

/**
 * Lines around the first occurrence of a matched fragment, for
 * `lab scan --explain`. `matched` is capped and trimmed when the hit is built,
 * so a truncated fragment falls back to its first 40 characters.
 */
export function linesAroundMatch(text, needle, radius = 3, maxLineLength = 400) {
  const target = String(needle ?? '').trim();
  if (!target) return [];
  const lines = String(text ?? '').split(/\r?\n/);
  let index = lines.findIndex((line) => line.includes(target));
  if (index < 0 && target.length > 40) index = lines.findIndex((line) => line.includes(target.slice(0, 40)));
  if (index < 0) return [];
  const slice = lines.slice(Math.max(0, index - radius), index + radius + 1);
  while (slice.length && slice[slice.length - 1].trim() === '') slice.pop();
  return slice.map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line));
}

/**
 * Whether a log that matched no signature still looks like a failure. Used so
 * a clean boot log is not reported as an unknown failure, while a real one
 * still gets its tail attached.
 */
export function looksLikeFailure(text) {
  const input = String(text ?? '');
  if (!input.trim()) return false;
  return [
    /\berror\b/i,
    /[A-Za-z]Error\b/,      // TypeError, SomethingWeirdError
    /\bexception\b/i,
    /\bfailed\b|\bfailure\b/i,
    /\bfatal\b/i,
    /\bpanic\b/i,
    /\bcannot\b|\bcan't\b/i,
    /\brefused\b/i,
    /\btimed? out\b|\btimeout\b/i,
    /\bunhandled\b/i,
    /\bcrash(?:ed)?\b/i,
    /\bE[A-Z]{3,}\b/,
    /exit(?:ed)?(?: with)? (?:code|status) [1-9]/i,
    /\[error\]/i,
  ].some((pattern) => pattern.test(input));
}
