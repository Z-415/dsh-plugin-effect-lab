# Reports

Every run writes `artifacts/<run-id>/`:

```text
report.md
report.html
report.json
boot.out.log
boot.err.log
install.log
routes.json
runtime.json
cleanup.json
profile.package.json
profile.cordis.patch.yml
profile.cordis.yml
dom/dom.json
screenshots/home.png
screenshots/fixture.png
plugin-validation.json
fixture.json
mock-llm.json
clone.json            (only for --clone-profile)
clone-install.log     (only for --clone-profile)
```

`report.html` is a self-contained page (checks, screenshots embedded as data
URIs, shell-vs-web diff, plugin findings, cleanup). Double-click it, or open it
in a browser; pass `--no-html` to skip it. Matrix runs write `matrix.html`
instead, with classification and conflicts. Screenshots larger than 2 MB are
listed by name instead of embedded.

`lab shell` writes a shell-specific set into the same run directory:

```text
dom/web-dom.json        headless Edge baseline for the same isolated host
dom/shell-dom.json      Electron renderer probe (preload `__dshLabShell.collect()`)
dom/shell-vs-web.json   slot / body-attribute / token diff, plus desktop-only keys
dom/shell-screenshot-diff.json  web-baseline.png vs shell.png pixel diff
screenshots/web-baseline.png
screenshots/shell.png
shell-result.json       raw shell result (DOM, console errors, page errors, settle)
```

`report.json` is the machine-readable record. Its important fields are:

- `ok`: all non-informational checks passed;
- `checks[]`: boot, token, route, UI, token probe, cleanup, and hash checks;
- `signatureHits[]`: fatal or warning boot-log fingerprints, each with a
  stable `code` (`LAB-BOOT-002`, ...), a `category` (`boot` / `plugin` /
  `client` / `profile` / `env` / `runtime` /
  `crash`), a root cause, and a suggested fix; see
  `docs/FAILURE-SIGNATURES.md` and `lab scan --list`;
- `errorCode` / `diagnostics`: the primary code (`LAB-OK`, a signature code, or
  an install-stage `LAB-INSTALL-*` code, or `LAB-UNKNOWN`), the failed checks,
  and a bounded boot tail. `diagnostics.install` repeats the pnpm key lines and
  any repo suggestion for an early install failure. Pass
  `--diagnostics-bundle <file>` to write the redacted bundle; see
  `docs/DIAGNOSTICS.md`;
- `clone`: for `--clone-profile`, the source snapshot hash, copied files and
  patches, excluded/dropped plugins, local `file:`/`link:` references, and the
  offline `node_modules` rebuild result (`ok`, `missing`, `incompatible`,
  `rejected`);
- `consoleSignatureHits[]`: the same fingerprints, but matched against the
  browser console errors, page errors, and failed requests (`console-signatures`
  check). `signatureHits` is the merge of both sources, deduped.
- `failureContext`: present when a run failed without matching any fatal
  signature, so an unknown failure still carries evidence:
  `{ reason, errors, bootTail, consoleErrors, pageErrors }`. Rendered as
  "未命中签名的失败上下文" in the HTML/Markdown report. The `bootTail` is the
  last 30 non-empty boot-log lines — the raw material for a new signature.
- `browser.consoleErrors[]`, `pageErrors[]`, `networkFailures[]`;
- `cleanup.homeRemoved` and `cleanup.portsLeft`; `cleanup.homeCleanup` records
  the delete attempt (`attempts`, `elapsedMs`) and, when it fails, the locked
  path, `errorCode` (EBUSY/EPERM for a real lock, or ENOENT/ENOTDIR for a
  concurrent-delete race), and the pid/name of every process still referencing
  the root. On success `reaped` lists the pid/name of every process the
  between-retry reaper killed (the shell, Edge, or a plugin helper such as
  dsh-orb's `electron.exe`). The same object is what `cleanup-home` /
  `cleanup-no-residue` detail and `lab clean` print;
- `realHome.diff`: structural file hash comparison against the real `~/.dsh`.
- `plugin-validation.json`: manifest findings for each installed plugin.
- `fixture.json`: fixed session id, workspace id, and event types.
- `mock-llm.json`: loopback provider session, event types, and every request
  summary/scripted response.
- `shell`: Electron result, normalized probes, `shellVsWeb` diff, and
  `diffMagnitude`. `shell.transport` records the renderer
  `__DSH_TRANSPORT__` bridge; `shell.result.consoleErrors` must not contain
  `[connection] connection lost`. `shell.result.tray` records the tray
  (`{ created, skipped, tooltip, menuItems, error }`, `shell-tray` check) and
  `shell.result.bootGlobals` records which host-injected globals reached the
  renderer (`shell-boot-globals` check). `shell.bootTransport` /
  `shell.bootInjections` record how the host was booted and whether typed rows
  arrived, `shell.derivedInjections` records the row content parsed back out of
  the host-rendered index (`shell-boot-injections` check), and
  `shell.result.indexSource` says whether the shell served the packaged dist
  index or the host-rendered one. `verify`/`capture` put the same boot facts on
  `report.boot`.
- `agentCoverage`: `fixture-only` or `loopback-mock-model`, always with
  `realModelRequests: false`, plus the covered/uncovered surface list.
- `settings`: with `--screenshot settings`, `{ totalSlots, added }` lists the
  slots the settings page added on top of the conversation view.
- `cleanup.residue`:
  `{ ok, checks, advisory, newHomes, portsStillListening, labProcesses }`.
  `isolated-root-removed` and `ports-released` gate `ok`; `no-new-lab-homes` and
  `no-lab-processes` are advisory (concurrent lab runs create their own homes;
  a process may still be exiting). `labProcesses.orphans` lists lab-spawned
  Edge/Electron processes whose run directory is gone, and
  `cleanup.orphanProcesses` is the same list on the run report. `lab clean`
  reaps them.
- `shell.screenshotDiff`: `{ identical, dimensionsMatch, pixels }` where
  `pixels.changedRatio` is the fraction of pixels beyond a small threshold and
  `pixels.cells` is a 64x40 per-cell change map. Matrix runs put the same
  summary on each compared entry as `screenshotDiff`.

Matrix runs also write `matrix.json` and `matrix.md` under
`artifacts/<matrix-id>/`, with token, body-attribute, layer z-index, and slot
conflicts plus a `classification` block per run
(`high-conflict` / `manual-review` / `coexist`). The CLI prints `[CLASS]`
lines; a conflict matrix reports `FAIL (conflicts detected)` on purpose.
Per-run `dom/layers` capture background layers (lowest `z-index` first) so
wallpaper-style stacking is machine-readable.

Screenshots are saved even when the UI is not visually inspected by the caller.
DOM and CSS token probes provide the machine-decidable result.
