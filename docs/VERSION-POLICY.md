# Runtime version policy

DSH ships often. The lab must not turn red just because the installed official
runtime moved, and it must not silently pretend a new version behaves like the
old one. `src/runtime-versions.js` is the single source of truth.

## The three verdicts

| verdict | meaning | effect |
|---|---|---|
| `verified` | the full suite has been run against this exact version | normal pass |
| `untested` | inside the supported range, not verified yet | the `runtime-version` check passes but is **informational** (提示), and the detail says the differences are unverified |
| `unsupported` | outside the supported range | the `runtime-version` check **fails**, every place it is reported |
| `unknown` | the version string could not be parsed | run anyway, informational, so a changed `--version` output cannot block you |

```js
export const VERIFIED_RUNTIME_VERSIONS = ['0.2.0-rc.2'];
export const SUPPORTED_RUNTIME_RANGE = '>=0.2.0-rc.1 <0.3.0';
```

The verdict is written to `report.runtime.compat` for `verify`, `capture`, and
`shell`, and shown by `lab doctor` as the `runtime-version` detail.

## Seeing what is installed

```powershell
node bin/lab.js runtimes
node bin/lab.js runtimes --json
```

Every distinct launcher the machine can see, with its version and verdict. The
official location is the default; add more with `DSH_LAB_RUNTIMES`
(semicolon-separated, each entry either a `dsh.cmd` or an install directory):

```powershell
$env:DSH_LAB_RUNTIMES = 'D:\DeepSeek Harness;D:\DSH-0.2.1\DeepSeek Harness'
node bin/lab.js runtimes
```

`DSH_LAB_RUNTIMES` also feeds `--runtime` resolution, so `lab verify` without an
explicit `--runtime` will use the first existing entry it names.

## Running against more than one version

```powershell
node bin/lab.js matrix --config fixtures/matrix/effect-conflict.json --runtime-matrix
```

The same matrix is run once per discovered, supported runtime; unsupported ones
are skipped and listed. The summary lands in
`artifacts/<runtime-matrix-id>/runtime-matrix.{json,md}` and records per
version: verdict, combination count, classification counts, conflicts, and the
per-version matrix directory. That is how you check whether a plugin effect and
its conflicts are identical on 0.2.0-rc.2 and a newer 0.2.x before promoting
the new version to `verified`.

## Adapting after an official update

1. `lab runtimes` — confirm the version and its verdict.
2. Run the suite against it:
   `npm test`, then
   `$env:DSH_LAB_RUNTIME='<path>'; $env:DSH_LAB_E2E='1'; npm run test:e2e`
   (or set `DSH_LAB_RUNTIMES` and let discovery pick it).
3. All green? Add the version to `VERIFIED_RUNTIME_VERSIONS` and note the date
   in the changelog. That is the whole promotion.
4. Something failed? `report.signatureHits` / `consoleSignatureHits` classify it;
   an unknown failure leaves `report.failureContext` (boot tail + renderer
   errors). Fix the probe or add a signature, then re-run.
5. Version outside the range (for example 0.3.x)? Update
   `SUPPORTED_RUNTIME_RANGE`, then re-check the version-specific assumptions
   below before promoting it.

## Version-specific assumptions to re-check

These are the places where the lab depends on the observed 0.2.x shape. An
update that changes one of them needs a code change *and* a re-verified suite:

- the readiness line `dsh web: http://127.0.0.1:<port>/?token=<token>`
  (`src/port-and-token.js` `WEB_URL_RE`);
- the boot invocation `--profile <name> --no-open --port 0`
  (`src/boot-supervisor.js`);
- the minimal profile scaffold (`package.json`, `cordis.yml`,
  `cordis.patch.yml`, `pnpm-workspace.yaml`, `dsh.profile.bundles`)
  (`src/profile-builder.js`);
- plugin `engines` / `peerDependencies` being compared against the detected
  runtime version (`src/manifest-validator.js`);
- client slot kinds and their error messages
  (`keyed slot ... requires options.key`), plus the failure signatures that
  name them (`src/log-scanner.js`);
- the Remote stream WebSocket route `/api/remote.mux` and the
  `__DSH_TRANSPORT__` bridge (`src/electron-shell/shell-probe.js`,
  `src/electron-shell/main.js`);
- the desktop-only body-attribute hints (`DESKTOP_ATTRIBUTE_HINTS`);
- the session fixture's `surfaceOp: "append"` requirement
  (`fixtures/web-session/*.json`);
- the host's desktop handshake: `dsh.cmd` runs
  `DeepSeek Harness.exe --expose-internals .../dsh-desktop-host/lib/cli.js ...`
  and the host sends `{ type: 'ready', url, injections }` over its IPC channel,
  with `injections: ctx.webServer.collectIndexInjections()`; the frontend
  applies rows of kind `global | script | script-src | script-preload | style |
  html` (`docs/ELECTRON-SHELL.md` has the exact contract, and
  `shell-boot-globals` probes its effects);
- the injected global names the frontend reads (`__DSH_BOOT__`,
  `__DSH_BOOT_READY__`, `__DSH_CONTACT_CONFIG__`, `__DSH_SHORTCUTS_CONFIG__`,
  `__DSH_DOCUMENT_PREVIEW_CONFIG__`, `__DSH_MODELS_ONBOARDING__`,
  `__DSH_CONNECTION_RECOVERY__`);
- the Electron major copied for the shell and GUI runtimes: it comes from the
  official install's `version` file, so it follows the install automatically.

## What is *not* version-specific

The isolated `DSH_HOME` lifecycle, the plugin install pipeline, the headless
Edge driver, the screenshot differ, the signature library, the reports, and the
process/temp cleanup do not depend on the runtime version. An official update
should cost you a suite run plus one line in `VERIFIED_RUNTIME_VERSIONS`.
