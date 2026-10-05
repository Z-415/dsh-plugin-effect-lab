# Failure signatures

`src/log-scanner.js` maps a boot log fragment (or a browser console line) to a
category, a root cause, and a suggested fix. `lab verify`/`lab capture` scan
`boot.out.log` + `boot.err.log`; `report.signatureHits[]` and the
`boot-signatures` check use the same library, and `lab scan --log <file>` runs
it on an existing log.

Print the current library, with the exact fix text, from the CLI:

```powershell
node bin/lab.js scan --list
node bin/lab.js scan --list --json
node bin/lab.js scan --latest          # rescan the newest artifacts/<run>/ boot logs
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

| id | category | severity | root cause |
|---|---|---|---|
| `duplicate-loader-id` | plugin | fatal | two loader entries share one id; the tree will not mount |
| `duplicate-tool` | plugin | fatal | two plugins register the same model tool name |
| `keyed-slot-requires-key` | client | fatal | a slot registration does not match the host slot kind |
| `unknown-slot-kind` | client | fatal | client registers a slot kind the host does not know |
| `missing-module` | plugin | fatal | a plugin entry or import cannot resolve |
| `plugin-tree-failed` | plugin | fatal | the composed plugin tree failed on one loader entry |
| `unresolved-service` | plugin | fatal | a plugin injected a service the host never registered |
| `engines-unsatisfied` | plugin | fatal | plugin engines range does not satisfy the runtime |
| `yaml-parse-error` | profile | fatal | a `cordis.patch.yml` layer is not a valid YAML array |
| `bundle-patch-missing` | profile | fatal | a bundle points at a patch file that does not exist |
| `bundle-dependency-mismatch` | profile | fatal | a bundle has no matching dependency |
| `fiber-pending` | boot | fatal | a plugin never settled during startup |
| `port-in-use` | boot | fatal | the host could not bind its port |
| `host-boot-timeout` | boot | fatal | no readiness line within the timeout |
| `electron-main-crash` | crash | fatal | the shell main process crashed |
| `client-module-load` | client | fatal | the renderer could not load a plugin client module |
| `atomic-write-eperm` | env | fatal | an atomic write could not replace its target |
| `permission-denied` | env | fatal | `EACCES` opening a file or directory |
| `path-too-long` | env | fatal | a path hit the Windows length limit |
| `schemastery-volatile-missing` | runtime | fatal | resolved `schemastery` is older than the plugin expects |
| `configforms-missing` | runtime | fatal | plugin expects the 0.2.x `configForms` service |
| `peer-conflict` | plugin | warning | a peer range disagrees with the host |

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

## Known limits

- Only patterns already seen in this repo's runs are covered. An unknown
  failure still reports the raw logs (`boot.out.log` / `boot.err.log`);
  `lab scan` then says "clean" rather than guessing.
- One version of DSH (0.2.0-rc.2) is covered. A future runtime may rename
  messages; the library is version-agnostic string matching by design.
