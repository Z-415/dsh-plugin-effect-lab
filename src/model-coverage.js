import fs from 'node:fs';
import path from 'node:path';

/**
 * Acceptance case E: prove the lab renders without a model and be explicit
 * about what is not covered.
 *
 * The isolated home must contain no credential material and no provider key.
 * Anything found is reported verbatim (path only, never the value).
 */

const CREDENTIAL_FILE = /(?:^|[.\\/])credentials?(?:[.\-_][a-z0-9]+)?\.(?:ya?ml|json|txt)$/i;
const KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|secret[_-]?key|bearer)\s*[:=]\s*["']?([A-Za-z0-9._\-]{12,})/i;
const MAX_SCAN_BYTES = 512 * 1024;

function walk(dir, out = [], depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out, depth + 1);
      continue;
    }
    out.push(full);
  }
  return out;
}

/** Find credential files and inline API keys inside an isolated home. */
export function scanForCredentials(homeDir) {
  const files = [];
  const keys = [];
  for (const file of walk(homeDir)) {
    const relative = path.relative(homeDir, file).replace(/\\/g, '/');
    if (CREDENTIAL_FILE.test(relative)) files.push(relative);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_SCAN_BYTES || !/\.(?:ya?ml|json|txt|toml|ini|env)$/i.test(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const match = KEY_PATTERN.exec(text);
    if (match) keys.push({ file: relative, kind: 'inline-key' });
  }
  return { files, keys, ok: files.length === 0 && keys.length === 0 };
}

/**
 * Describe which agent surfaces the run actually exercised. `realModelRequests`
 * is always false: the lab never talks to a real provider.
 */
export function describeAgentCoverage(options = {}) {
  const { mockModel = false, credentials = { ok: true } } = options;
  const covered = [
    'isolated host boot',
    'client UI render',
    'fixed session fixture (user/assistant/tool events)',
    ...(mockModel ? ['loopback model turn (lab-mock/lab-mock-model)'] : []),
  ];
  const uncovered = [
    'real provider credentials and sign-in',
    'real model output quality',
    'outbound tool side effects',
  ];
  return {
    mode: mockModel ? 'loopback-mock-model' : 'fixture-only',
    realModelRequests: false,
    credentialsFound: credentials.ok === false,
    covered,
    uncovered,
    note: mockModel
      ? 'Only the loopback lab-mock provider is used; no real key or network provider.'
      : 'No provider key is configured, so only the fixed session fixture is rendered.',
  };
}
