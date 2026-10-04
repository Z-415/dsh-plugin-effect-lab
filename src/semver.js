/** Minimal semver implementation for plugin engines/peer ranges. */

export function parseVersion(value) {
  const text = String(value ?? '').trim().replace(/^[=v]/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function trimZero(parts) {
  const out = [...parts];
  while (out.length > 0 && out.at(-1) === 0) out.pop();
  return out.length ? out : [0];
}

function lowerBoundFor(operator, version) {
  return { operator, version };
}

function upperBoundExclusive(version, bump) {
  const parts = [version.major, version.minor, version.patch];
  const index = bump === 'major' ? 0 : bump === 'minor' ? 1 : 2;
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i += 1) parts[i] = 0;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function parseComparator(text) {
  const value = text.trim();
  if (!value || value === '*' || /^x(\.x){0,2}$/i.test(value)) return { any: true };
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  const operator = match[1] ?? '=';
  const major = Number(match[2]);
  const minor = match[3] === undefined || /x|\*/i.test(match[3]) ? null : Number(match[3]);
  const patch = match[4] === undefined || /x|\*/i.test(match[4]) ? null : Number(match[4]);
  const prerelease = match[5] ?? '';
  const version = `${major}.${minor ?? 0}.${patch ?? 0}${prerelease ? `-${prerelease}` : ''}`;
  const bump = minor === null ? 'major' : patch === null ? 'minor' : 'patch';
  return { operator, version, major, minor, patch, prerelease, bump };
}

function applyComparator(version, comparator) {
  if (comparator.any) return true;
  const current = parseVersion(version);
  if (!current) return false;
  const target = parseVersion(comparator.version);
  if (!target) return false;
  const cmp = compareVersions(version, comparator.version);
  if (cmp === null) return false;
  switch (comparator.operator) {
    case '=':
      return cmp === 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '~': {
      const upper = upperBoundExclusive(target, target.minor === null ? 'major' : 'minor');
      const lower = compareVersions(version, comparator.version);
      const high = compareVersions(version, upper);
      return lower !== null && lowIncludes(current, target, lower) && high !== null && high < 0;
    }
    case '^': {
      let upper;
      if (target.major > 0) upper = upperBoundExclusive(target, 'major');
      else if (target.minor !== null && target.minor > 0) upper = upperBoundExclusive(target, 'minor');
      else upper = upperBoundExclusive(target, 'patch');
      const lower = compareVersions(version, comparator.version);
      const high = compareVersions(version, upper);
      return lower !== null && lowIncludes(current, target, lower) && high !== null && high < 0;
    }
    default:
      return false;
  }
}

/** Prerelease versions only enter a range when that comparator names a prerelease. */
function lowIncludes(current, target, cmp) {
  if (cmp < 0) return false;
  if (current.prerelease.length && !target.prerelease.length) return false;
  return true;
}

/**
 * Whether the range itself mentions a prerelease (e.g. `>=0.1.0-rc.6`).
 * A range that names prereleases is prerelease-aware; a plain `<0.2.0` is not,
 * and a prerelease version must not be let in by tolerance.
 */
export function rangeIncludesPrerelease(range) {
  const text = String(range ?? '');
  return text.split('||').some((alternative) => alternative
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .some((comparator) => /^\^|~|>=|<=|>|<|=/.test(comparator)
      ? /-[0-9A-Za-z.-]+/.test(comparator)
      : false));
}

export function satisfies(version, range, options = {}) {
  const { includePrerelease = false } = options;
  const text = String(range ?? '').trim();
  if (!text || text === '*' || text === 'latest') return true;
  const current = parseVersion(version);
  if (!current) return false;
  for (const alternative of text.split('||')) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean).map(parseComparator);
    if (comparators.some((comparator) => comparator === null)) continue;
    // Standard semver: a prerelease version only satisfies a comparator set
    // when a comparator with the same major.minor.patch carries a prerelease.
    if (current.prerelease.length > 0 && !includePrerelease) {
      const allowed = comparators.some((comparator) => {
        if (comparator.any || !comparator.prerelease) return false;
        const target = parseVersion(comparator.version);
        return target
          && target.major === current.major
          && target.minor === current.minor
          && target.patch === current.patch;
      });
      if (!allowed) continue;
    }
    if (comparators.every((comparator) => applyComparator(version, comparator))) return true;
  }
  return false;
}

/** Parse an npm spec into `{ name, version }`, handling scoped names. */
export function parseNpmSpec(spec) {
  const text = String(spec ?? '').trim();
  if (!text) return null;
  const match = text.startsWith('@')
    ? /^(@[^/]+\/[^@]+)(?:@(.+))?$/.exec(text)
    : /^([^@]+)(?:@(.+))?$/.exec(text);
  if (!match) return null;
  return { name: match[1], version: match[2] ?? null };
}
