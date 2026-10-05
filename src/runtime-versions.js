import { parseVersion, satisfies } from './semver.js';

/**
 * Which official DSH runtimes this lab knows about.
 *
 * DSH ships often, so the lab must not hard-fail just because the installed
 * version moved. Three outcomes:
 *
 *   verified    - the full suite has been run against this exact version;
 *   untested    - inside the supported range but not verified yet: run it, but
 *                 report the differences as unverified (informational check);
 *   unsupported - outside the range: a real failure, because the 0.2.x shape
 *                 (profile bundles, client slots, `dsh web:` readiness) is
 *                 what the lab is built on;
 *   unknown     - the version string could not be parsed (the `--version`
 *                 output may have changed); run it and flag it.
 *
 * To promote a version to `verified`: install it, run `npm test` and
 * `DSH_LAB_E2E=1 npm run test:e2e` against it, then add it here. See
 * `docs/VERSION-POLICY.md`.
 */
export const VERIFIED_RUNTIME_VERSIONS = ['0.2.0-rc.2'];

/** The 0.2.x line, prereleases included. */
export const SUPPORTED_RUNTIME_RANGE = '>=0.2.0-rc.1 <0.3.0';

export function classifyRuntimeVersion(version, options = {}) {
  const verifiedVersions = options.verifiedVersions ?? VERIFIED_RUNTIME_VERSIONS;
  const range = options.range ?? SUPPORTED_RUNTIME_RANGE;
  const text = String(version ?? '').trim();
  if (!text || !parseVersion(text)) {
    return {
      version: text || null,
      status: 'unknown',
      verified: false,
      supported: true,
      detail: `runtime version ${text || 'unknown'} could not be parsed; running anyway, treat the result as unverified`,
    };
  }
  if (verifiedVersions.includes(text)) {
    return {
      version: text,
      status: 'verified',
      verified: true,
      supported: true,
      detail: `${text} (verified)`,
    };
  }
  if (satisfies(text, range, { includePrerelease: true })) {
    return {
      version: text,
      status: 'untested',
      verified: false,
      supported: true,
      detail: `${text} is inside ${range} but is not in the verified set; differences are unverified`,
    };
  }
  return {
    version: text,
    status: 'unsupported',
    verified: false,
    supported: false,
    detail: `${text} is outside the supported range ${range}`,
  };
}

/** Whether a check for this runtime should merely inform, not fail. */
export function isInformationalRuntime(classification) {
  return classification?.supported === true && classification?.verified !== true;
}
