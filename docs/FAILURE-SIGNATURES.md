# Failure signatures

`src/log-scanner.js` maps a boot log fragment (or a browser console line) to a
category, a root cause, and a suggested fix. `lab verify`/`lab capture` scan
`boot.out.log` + `boot.err.log` **and** the browser console/page errors;
`report.signatureHits[]`, `report.consoleSignatureHits[]`, the
`boot-signatures` and `console-signatures` checks use the same library, and
`lab scan --log <file>` runs it on an existing log.

Print the current library, with the exact fix text, from the CLI:

```powershell
node bin/lab.js scan --list
node bin/lab.js scan --list --json
node bin/lab.js scan --latest          # rescan the newest artifacts/<run>/ boot logs
node bin/lab.js scan --log x.log --explain   # lines around each hit
```

## Categories

| category | where the failure lives |
|---|---|
| `boot` | host startup, port binding, readiness |
| `plugin` | loader entry, apply, tool/slot registration, injections, peers |
| `client` | renderer module loading and slot kinds |
| `profile` | `cordis.patch.yml`, bundle order and bundle patches |
| `env` | filesystem/OS (permissions, path length, atomic writes) |
| `runtime` | DSH service surface mismatches (schemastery, configForms) |
| `crash` | the shell/main process died |

## Entries

| code | id | category | severity | root cause |
|---|---|---|---|---|
| `LAB-PLUGIN-001` | `duplicate-loader-id` | plugin | fatal | two loader entries share one id; the tree will not mount |
| `LAB-PLUGIN-002` | `duplicate-tool` | plugin | fatal | two plugins register the same model tool name |
| `LAB-CLIENT-001` | `keyed-slot-requires-key` | client | fatal | a slot registration does not match the host slot kind |
| `LAB-CLIENT-002` | `unknown-slot-kind` | client | fatal | client registers a slot kind the host does not know |
| `LAB-PLUGIN-003` | `missing-module` | plugin | fatal | a plugin entry or import cannot resolve |
| `LAB-PLUGIN-004` | `plugin-tree-failed` | plugin | fatal | the composed plugin tree failed on one loader entry |
| `LAB-PLUGIN-005` | `unresolved-service` | plugin | fatal | a plugin injected a service the host never registered |
| `LAB-PLUGIN-006` | `engines-unsatisfied` | plugin | fatal | plugin engines range does not satisfy the runtime |
| `LAB-PROFILE-001` | `yaml-parse-error` | profile | fatal | a `cordis.patch.yml` layer is not a valid YAML array |
| `LAB-PROFILE-002` | `bundle-patch-missing` | profile | fatal | a bundle points at a patch file that does not exist |
| `LAB-PROFILE-003` | `bundle-dependency-mismatch` | profile | fatal | a bundle has no matching dependency |
| `LAB-BOOT-001` | `fiber-pending` | boot | fatal | a plugin never settled during startup |
| `LAB-BOOT-002` | `port-in-use` | boot | fatal | the host could not bind its port |
| `LAB-BOOT-003` | `host-boot-timeout` | boot | fatal | no readiness line within the timeout |
| `LAB-CRASH-001` | `electron-main-crash` | crash | fatal | the shell main process crashed |
| `LAB-CLIENT-003` | `client-module-load` | client | fatal | the renderer could not load a plugin client module |
| `LAB-ENV-001` | `atomic-write-eperm` | env | fatal | an atomic write could not replace its target |
| `LAB-ENV-002` | `permission-denied` | env | fatal | `EACCES` opening a file or directory |
| `LAB-ENV-003` | `path-too-long` | env | fatal | a path hit the Windows length limit |
| `LAB-RUNTIME-001` | `schemastery-volatile-missing` | runtime | fatal | resolved `schemastery` is older than the plugin expects |
| `LAB-RUNTIME-002` | `configforms-missing` | runtime | fatal | plugin expects the 0.2.x `configForms` service |
| `LAB-PLUGIN-007` | `peer-conflict` | plugin | warning | a peer range disagrees with the host |

The codes are **stable**: once a code is published it keeps its meaning even if
the wording of the signature changes. New signatures get the next free number
in their category. `LAB-UNKNOWN` is reserved for a failed run that matched no
signature (its evidence is the failed checks plus a bounded boot-log tail); a
clean run reports `LAB-OK` with an empty `errorCodes` list.

## Adding a signature

1. Add the entry to `SIGNATURES` with `id`, `category`, a *specific* `pattern`,
   `severity`, `rootCause`, and `fix`.
2. Add the real log line to the table-driven `CASES` in
   `tests/unit/log-scanner.test.js` (asserts the id, severity, and that no
   other entry matches it).
3. Add or extend the clean-log negative test so benign startup output never
   trips it.

Keep `severity: 'fatal'` for anything that stops the tree from mounting; a
false fatal fails an entire run, so a pattern must be no broader than the real
failure sentence.

## Install-stage codes

These are not boot-log fingerprints. They classify a failed `dsh plugin add`
(pnpm) before the host starts, in `src/plugin-install-diagnostics.js`:

| code | trigger |
|---|---|
| `LAB-INSTALL-NOTFOUND` | `ERR_PNPM_FETCH_404` / "is not in the npm registry" |
| `LAB-INSTALL-NETWORK` | `ECONNRESET` / `ETIMEDOUT` / a codeload retry loop / install timeout |
| `LAB-INSTALL-UNKNOWN` | a non-zero install with no recognizable pnpm line |

The `plugin-install` check detail carries the elapsed time and the pnpm key
line, and `report.errorCode` is set even though the run never booted a host. A
GitHub-looking spec that fails online is pre-checked: a private/monorepo source
gets a "this is source, install the published package" hint (for
`mini-yifan/dsh-orb-cordis`, `npm:dsh-orb`) without replacing the input.

## Known limits

- Only patterns already seen in this repo's runs are covered. An **unknown**
  failure is handled rather than guessed at: when nothing matches but the log
  looks like a failure, `lab scan` prints the last lines and says
  `no known signature, but the log looks like a failure`. A failed run writes
  `report.failureContext = { reason, errors, bootTail, consoleErrors,
  pageErrors }`, which the HTML/Markdown reports render. That tail is exactly
  what a new signature should be written from.
- One version of DSH (0.2.0-rc.2) is covered. A future runtime may rename
  messages; the library is version-agnostic string matching by design.
