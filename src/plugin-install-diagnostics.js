/**
 * Diagnose a failed `dsh plugin add` (pnpm) install.
 *
 * `runCommand` already captures the real pnpm output; the runner used to throw
 * it away and report only `exit 1`. This module extracts the few lines that
 * explain the failure and maps them onto stable codes so report.json,
 * diagnostics, the CLI, and the GUI all say the same thing.
 */

/** Stable codes for an install-stage failure, before the host ever boots. */
export const INSTALL_ERROR_CODES = {
  NOTFOUND: 'LAB-INSTALL-NOTFOUND',
  NETWORK: 'LAB-INSTALL-NETWORK',
  UNKNOWN: 'LAB-INSTALL-UNKNOWN',
};

/**
 * One line is "key" when it names a pnpm error, a 404, a network error, or the
 * codeload retry loop. The first such line is what the GUI banner shows, so
 * the order inside the log matters and we keep it.
 */
const KEY_LINE_TEST = /ERR_PNPM_[A-Z0-9_]+|E404|Not Found - 404|404 Not Found|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|[Ww]ill retry|codeload\.github\.com|is not in the npm registry/i;

const NOTFOUND_TEST = /ERR_PNPM_FETCH_404|E404\b|Not Found - 404|404 Not Found|is not in the npm registry/i;
const NETWORK_TEST = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|[Ww]ill retry|codeload\.github\.com/i;

const MAX_KEY_LINE_LENGTH = 300;
const MAX_DETAIL_LENGTH = 900;

/**
 * Rank a matched line so the most specific explanation survives the cap: the
 * pnpm error code first, then the transport error, then the codeload retry,
 * then the human-readable "not in the npm registry" sentence.
 */
function keyLineRank(line) {
  if (/ERR_PNPM_[A-Z0-9_]+/.test(line)) return 0;
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed/.test(line)) return 1;
  if (/Not Found - 404|404 Not Found|E404\b/.test(line)) return 1;
  if (/codeload\.github\.com|[Ww]ill retry/.test(line)) return 2;
  if (/is not in the npm registry/.test(line)) return 3;
  return 4;
}

function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** The pnpm lines that actually explain a failed install, in log order. */
export function extractInstallKeyLines(text, limit = 4) {
  const seen = new Set();
  const matches = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line || !KEY_LINE_TEST.test(line)) continue;
    const clipped = clip(line, MAX_KEY_LINE_LENGTH);
    if (seen.has(clipped)) continue;
    seen.add(clipped);
    matches.push({ clipped, index, rank: keyLineRank(line) });
  }
  matches.sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
  return matches.slice(0, limit).map((entry) => entry.clipped);
}

/**
 * Classify a finished install command into a stable code plus the extracted
 * key lines. A registry 404 wins over the generic network pattern because pnpm
 * reports the fetch failure as both.
 *
 * @param {{ code?: number|null, stdout?: string, stderr?: string, timedOut?: boolean, durationMs?: number }} install
 */
export function classifyInstallFailure(install = {}) {
  const stdout = String(install.stdout ?? '');
  const stderr = String(install.stderr ?? '');
  const text = `${stdout}\n${stderr}`;
  const timedOut = install.timedOut === true;
  const keyLines = extractInstallKeyLines(text);
  const notFound = NOTFOUND_TEST.test(text);
  const network = timedOut || NETWORK_TEST.test(text);
  const code = notFound
    ? INSTALL_ERROR_CODES.NOTFOUND
    : network
      ? INSTALL_ERROR_CODES.NETWORK
      : INSTALL_ERROR_CODES.UNKNOWN;
  return {
    code,
    category: code === INSTALL_ERROR_CODES.NOTFOUND
      ? 'notfound'
      : code === INSTALL_ERROR_CODES.NETWORK
        ? 'network'
        : 'unknown',
    keyLines,
    timedOut,
    durationMs: Number.isFinite(install.durationMs) ? install.durationMs : null,
    // codeload is GitHub's tarball host; a retry loop there is a GitHub
    // download failure, not a bad package name.
    githubDownload: /codeload\.github\.com|[Ww]ill retry/i.test(text),
  };
}

/** `exit 1; [ERR_PNPM_FETCH_404] ...` - the `plugin-install` check detail. */
export function formatInstallDetail(diagnosis, install = {}) {
  const exit = install.timedOut === true ? 'timeout' : (install.code ?? '?');
  const bits = [`exit ${exit}${install.timedOut === true ? ' (timeout)' : ''}`];
  if (diagnosis?.keyLines?.length) bits.push(diagnosis.keyLines.join(' | '));
  return clip(bits.join('; '), MAX_DETAIL_LENGTH);
}

/**
 * The first line of the thrown error. The GUI banner only keeps the first
 * `[失败]` line, so the real pnpm reason has to be here, not only in the tail.
 */
export function installFailureMessage(diagnosis, install = {}) {
  const exit = install.timedOut === true ? 'timeout' : (install.code ?? '?');
  const reason = diagnosis?.keyLines?.[0]
    ?? (install.timedOut === true
      ? `timed out after ${install.durationMs ?? '?'}ms with no pnpm error line`
      : 'no pnpm error line captured; see install.log');
  return clip(`plugin install failed (exit ${exit}): ${reason}`, MAX_DETAIL_LENGTH);
}

/** The report-facing `plugin-install` check. */
export function describePluginInstall(stage, install, diagnosis) {
  const detail = formatInstallDetail(diagnosis, install);
  return { pass: stage !== 'install', detail };
}
