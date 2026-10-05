# Changelog

## 0.1.0 - 2026-10-05 (flat, grid-aligned GUI)

### Changed

- Reworked the desktop GUI into a flat two-column layout: the plugin workflow
  on the left, 检查 / 清理 on the right. Buttons now sit on equal-width,
  equal-height 2-column action grids instead of ragged flex rows, with a single
  filled primary, a tinted strong style, and a tinted danger style. The new
  `profileTag` badge mirrors the current profile dropdown selection.
- Moved **查看已装的 DSH 版本** (`runtimes`) out of the collapsed disclosure
  into the main 检查 grid; 更多 now holds only the three slow `matrix` presets.
- The default 1080x760 window fits the whole control area without scrolling;
  below 900px wide the columns stack and the control area scrolls on its own
  while the log pane keeps at least 200px.
- The window draws its own **white title bar** (the OS title bar follows the
  Windows accent colour) with a Chinese in-page menu - 文件 / 编辑 / 查看 / 窗口 /
  帮助 - while Electron still draws the minimise/maximise/close buttons. The
  dark console became a white log pane with dark text, so the page is one flat
  light palette.
- Buttons lost their outlines and use the light-blue fill (`#f2f6ff`) with the
  accent text colour; hovering steps the background instead of drawing a
  border, like DSH's own buttons. Only four actions keep a fill of their own:
  **验证这个插件** (solid accent), **在壳窗口打开（自己关）** (blue-100),
  **卸载这个插件** and **清理残留临时目录** (soft red).
- The 插件 group is re-ordered: the two **在壳窗口打开** buttons share the first
  row, the other actions follow, and **验证这个插件** sits alone on the last,
  full-width row.
- In the 更多（矩阵） area the **跨版本矩阵** button now spans the full row, so
  its long label stays on one line instead of wrapping inside a half-width cell.

### Fixed

- A Desktop shortcut kept launching the stale `gui-runtime` copy of the UI
  until `lab gui` ran again. The launcher now re-syncs
  `index.html` / `main.js` / `preload.js` / `app-sync.cjs` / `menu.cjs` from
  `src/gui` at every start (`src/gui/app-sync.cjs`), so the shortcut follows
  the source.
- Adding a new GUI app file no longer forces the 346 MB runtime copy (and no
  longer needs the window closed): the cached build refreshes app files one by
  one, including files a newer build added.
- A long log output no longer squeezes the controls above it: the log pane is
  `flex-basis: 0`, so it only takes the space left over and scrolls internally.
  A regression probe fills it with 600 lines and asserts the controls keep
  their height at both window sizes.

### Tests

- `tests/integration/gui-page.test.js` gained a design probe (grid rows have
  equal cell sizes, labels do not overflow their buttons, controls do not
  overlap or spill out of their rows, and the page has no horizontal scroll)
  plus a second case that runs the same probe at the minimum 820x560 window
  size. It also asserts the menu labels are Chinese, every menu item dispatches
  its action, the title bar/log pane are light, and the log text contrast is at
  least 7:1. `tests/unit/gui-app-sync.test.js` covers the startup sync (copy
  changed files, leave identical ones, tolerate missing paths, log a failed
  copy) and `tests/unit/gui-menu.test.js` covers the Chinese menu template.
  Full suite: unit 194/194, integration 16/16.

## 0.1.0 - 2026-10-04

Phase 4 (Electron shell) completed.

### Added

- `src/electron-shell/preload.js`: exposes `window.dshDesktopBoot` (the boot
  bridge the packaged frontend expects) and `window.__dshLabShell.collect()`
  (slots, `--dsw-*` / `--we-*` tokens, body/HTML attributes, title-bar
  geometry, desktop facts).
- `src/electron-shell/shell-probe.js`: snapshot normalization, web-vs-shell
  diff, desktop-only key detection, and the `[connection] connection lost`
  classifier.
- `lab shell` now opens a headless Edge baseline for the same isolated host and
  diffs it against the Electron renderer; `--no-compare-web` skips the
  baseline.
- `ws://127.0.0.1/*` header fence in the shell main process, matching the
  official desktop trust fence.
- Unit tests for `shell-probe.js` and `preload.js`, plus
  `tests/integration/shell-mode.test.js`.

### Fixed

- The shell no longer logs `[connection] connection lost, retry #1`. The
  renderer resolved the Remote-stream WebSocket against `document.baseURI`
  (`dsh-app://app`) because `__DSH_TRANSPORT__` was never published; the boot
  bridge now supplies the host origin and the fence rewrites the handshake.
- The shell DOM probe returned an object that was still parsed as JSON.
- Slot-count comparisons were unstable because the web probe ran before the
  conversation view mounted; both probes now wait for a stable slot count.
- `--dsw-*` token values are read from the page's main world, not the preload's
  isolated world.

### Known gaps

- Acceptance cases C (duplicate slot id) and D (`dream-skin` / `bloom`) are not
  yet exercised.
- Window controls, clipboard, file dialogs, and notifications are not
  reproduced.
- `src/dom-assertions.js` and `src/cleanup.js` are still not separate modules.

## 0.1.0 - 2026-10-04 (acceptance C and D)

### Added

- `src/declaration-scanner.js`: namespace-aware duplicate detection for loader
  ids, slot registration ids, slot keys, and tool names, wired into
  `precheckPlugins` / `postcheckPlugins`.
- Fixtures `dup-slot-one` / `dup-slot-two` using the official
  `ctx.slots.register` API; a pre-boot run fails with labelled blockers and a
  runtime run proves the client half executes.
- DOM `layers` / `layerSummary` probe (CDP and preload) for background-layer
  z-index evidence.
- `src/effect-classifier.js`: `high-conflict` / `manual-review` / `coexist`
  classification, surfaced in `matrix.json`, `matrix.md`, and `[CLASS]` CLI
  lines.
- `fixtures/matrix/theme-conflict.json`: wallpaper-only, `+ui-tweaks`,
  `+dream-skin`, `+bloom`.

### Fixed

- `--assert-token --dsw-*` / `--we-*` / `--lab-*` values were rejected because
  they start with `--`; token-shaped, non-flag values are now accepted.
- `<command> --help` started a real run instead of printing help.
- Prerelease-aware peer/engine ranges (`>=0.1.0-rc.6 <0.3.0-0`) were reported
  as blockers; they are now warnings, while a plain `<0.2.0` still blocks.
- The matrix classifier treated failed checks and console 404s as conflicts;
  it now keys on DOM production and records them as notes.

### Measured (real packages)

- `dsh-plugin-wallpaper-engine@1.2.0` + `dsh-ui-tweaks@0.20.0`: `coexist`.
- `wallpaper + dsh-dream-skin@9.29.0`: `high-conflict` with
  `wallpaper + dsh-bloom-theme@0.17.2` over 28 `--dsw-*` tokens
  (`docs/ACCEPTANCE-C-D-RESULTS.md`).

## 0.1.0 - 2026-10-04 (acceptance E and F)

### Added

- `src/model-coverage.js`: isolated-home credential scan (paths only) and an
  `agentCoverage` record with covered/uncovered surfaces.
- `--screenshot settings` opens the settings page, captures
  `screenshots/settings.png`, and records the settings-only slot delta.
- New checks: `no-model-credentials`, `settings-ui`, `agent-coverage`
  (informational).
- `src/cleanup.js`: `listLabResidue`, `snapshotLabResidue`, `diffResidue`,
  `verifyNoResidue`; both runners now emit a `cleanup-no-residue` check and a
  `cleanup.residue` block. `lab clean` shares the same residue listing.

### Fixed

- A global "no new lab homes" assertion was flaky under Node's parallel test
  runner; it is now advisory, and only the run's own isolated root and port
  gate `ok`.
- The settings slot delta included conversation slots; it now samples the slot
  set immediately before opening settings.

### Measured

- No-model run renders conversation + settings with zero credentials and
  `realModelRequests: false` (`docs/ACCEPTANCE-E-F-RESULTS.md`).

## 0.1.0 - 2026-10-04 (Phase 5 stabilization)

### Added

- `MAX_LAB_ROOT_LENGTH` / `assertShortLabRoot()` so isolated roots stay well
  below the Windows path limit.
- `tests/integration/stability.test.js`: two concurrent runs take distinct
  ports and leave no residue; the same run repeated three times takes three
  distinct ports with a stable slot count.
- `tests/integration/failure-injection.test.js`: missing plugin source,
  duplicate slot declarations, and an unreachable runtime path all fail
  cleanly with no residue.
- `tests/unit/path-and-ports.test.js`: root-length budget and real TCP
  listen/free tracking.
- `src/dom-assertions.js` with `--assert-slot`, `--assert-body-attr`, and
  `--min-slots` (the last module from the task-book layout).

### Fixed

- `--runtime <missing>` silently fell back to the default install, so an
  injected failure never happened. `locateRuntime()` and `findBrowser()` now
  treat an explicit path as authoritative and throw when it does not exist.

### Changed

- `npm run test:e2e` runs integration files with `--test-concurrency=1` so the
  heavy stability tests do not compete for ports or interfere with each other's
  residue checks.

Final suite: unit 72/72, integration 8/8 (`docs/PHASE5-RESULTS.md`).

## 0.1.0 - 2026-10-04 (shell plugins, screenshot diff, CI)

### Added

- `src/plugin-install.js`: the precheck -> `dsh plugin add` -> append bundles ->
  postcheck pipeline shared by `verify` and `shell`. `lab shell` now accepts
  `--plugin` / `--with` / `--online` / `--no-fixture`.
- `src/screenshot-diff.js` + `browser-driver.evaluateOnce()`: pixel diff of two
  PNGs inside headless Edge, returning `changedRatio` and a 64x40 cell grid.
  Shell runs write `dom/shell-screenshot-diff.json`; matrix runs attach
  `screenshotDiff` to each compared entry and print `[SHOT]` lines.
- `scripts/ci.mjs` + `.github/workflows/ci.yml` + `npm run ci`: unit tests
  always, doctor + integration tests when the official runtime is present.

### Fixed

- A fully hidden Electron window does not composite on Windows, so
  `capturePage()` returned a near-white frame. The shell window is now visible
  with `opacity: 0` and `skipTaskbar: true`, and
  `force-device-scale-factor=1` pins captures to CSS pixels.
- The preload probe ignored caller-asserted token names, so inline custom
  properties such as `--lab-dup-slot` were missing from the shell snapshot.
- The web DOM probe ran before the workspace/session interaction, so the
  stability test saw 39/37/39 slot drift. The probe now runs after the
  interactions and matches the captured conversation state.
- `desktopOnly` only counted attributes absent from web; it now also reports
  changed values, which surfaced `data-we-adapter: desktop-official` in the
  shell versus `browser` in web mode.

### Measured

- Unmodified profile: shell and web screenshots are pixel-identical
  (`identical: true`, `changedRatio: 0`).
- `wallpaper-engine@1.2.0` in the shell: `--dsw-alias-bg-base: transparent`
  in both modes, `data-we-adapter: desktop-official` (shell only).
- Theme matrix screenshot diff: ui-tweaks 0.0000, dream-skin 0.7765,
  bloom 0.8060.

Final suite: unit 77/77, integration 9/9.

## 0.1.0 - 2026-10-04 (fixture variants and desktop bridges)

### Added

- `fixtures/web-session/{fixed,empty,long}-session.json`: the conversation
  fixture is now committed data instead of hardcoded events. `--fixture-variant
  default|empty|long` selects one; the seeder reads `DSH_LAB_FIXTURE_FILE` and
  keeps an inline default so it still works standalone.
- Desktop bridges in the shell preload: `__DSH_DIRECTORY_PICKER__` (stubbed to
  the fixture workspace), `__DSH_HOST_PATHS__`, and
  `__dshLabShell.notify()`. `report.shell.capabilities` records the window
  controls, a real clipboard round-trip, the directory-picker stub, host-path
  resolution, and suppressed notification requests.
- New shell checks: `shell-window-controls` (real, hard),
  `shell-clipboard` (real, informational), `shell-desktop-bridges` (stubs).

### Fixed

- Generated sessions now set `surfaceOp: "append"` on every message-producing
  event; the 0.2.0-rc.2 session format rejects a second turn without it.
- `discoverCursor` did not parse the `past cursor -1` reported by an empty
  session, so the empty variant failed before its events were read.
- The CLI printed `[FAIL]` for informational checks that do not affect the
  result; they now print `[INFO]`.

### Measured

- Empty and long variants both boot and render (`fixture-variant` integration
  tests).
- `shell-window-controls`: overlay available, height 40.
- `shell-desktop-bridges`: directory picker stubbed to the fixture workspace,
  host paths resolved, notification recorded and suppressed.

Final suite: unit 83/83, integration 11/11.

## 0.1.0 - 2026-10-04 (HTML reports and a visible shell window)

### Added

- `src/html-report.js`: self-contained `report.html` for every run (checks with
  PASS/FAIL/INFO badges, screenshots embedded as data URIs, shell-vs-web diff,
  DOM probe, plugin findings, agent coverage, cleanup) and `matrix.html` for
  matrix runs (classification + conflicts). `--no-html` skips it.
- `lab shell --show` renders the real Electron window on screen with a hold
  (default 6000 ms, `--show-hold <ms>`), and `--keep-open` leaves it open until
  you close it, then writes the result and cleans up.

### Fixed

- The shell report had no `runDir`/`screenshots` entries, so its HTML report
  silently embedded nothing.

Final suite: unit 87/87, integration 11/11.

## 0.1.0 - 2026-10-04 (desktop GUI launcher)

### Added

- `lab gui`: copies the official Electron runtime once into the project's
  `gui-runtime\gui-<version>\` (renamed to
  `DSH Plugin Effect Lab.exe`) and opens a desktop launcher. `--install-shortcut`
  drops a Desktop shortcut, `--rebuild` re-copies, `--no-open` only builds.
- `src/gui/{main.js,preload.js,index.html}`: buttons for doctor / verify /
  settings screenshot / empty / long / shell (20 s) / shell (keep open) /
  shell-vs-web / wallpaper plugin / theme matrix / effect matrix / clean, a
  live log pane, an abort button, and buttons to open the newest HTML report or
  the artifacts folder. Every button spawns the same `bin/lab.js` command.
- `启动实验台.cmd` for double-clicking from the project folder.
- `DSH_LAB_GUI_HOME` relocates the copied runtime.

### Fixed

- Runs looked like a hang because nothing was printed until the end; `verify`,
  `capture`, and `shell` now stream `[lab] ...` progress lines, and
  `--show`/`--keep-open` centre, focus, and keep the window on top.
- Double-clicking the GUI shortcut crashed with
  `ERR_INVALID_ARG_TYPE ... Received undefined`: the launcher only accepted a
  config passed through `DSH_LAB_GUI_CONFIG` by `lab gui`. It now also reads
  `gui-config.json` next to `main.js` and shows a readable dialog when neither
  exists.
- The runtime was built under `%LOCALAPPDATA%`, which a packaged host (the
  Codex desktop app) redirects into its own MSIX sandbox, so the Desktop
  shortcut pointed at a path a normal double-click could not use. The default
  runtime home is now the project's `gui-runtime/` (git-ignored).

Final suite: unit 90/90, integration 11/11.

## 0.1.0 - 2026-10-05 (persistent lab profiles, multi-plugin audit)

### Added

- `--profile-lab <name>`: use a persistent, still-isolated profile under
  `.lab-profiles/<name>/` instead of a one-shot temp home. Plugins stay
  installed, so the shell UI can be reopened later without `--plugin`.
- `lab profile list|create|remove|path`: manage those profiles.
- `plugin-profile-audit`: after installing, the whole profile is scanned for
  cross-plugin duplicates (loader id, slot registration id, slot key, tool
  name). Adding plugin B to a profile that already has A now reports the A+B
  conflict even though B alone passes precheck.
- GUI: a "自定义插件 / 持久 profile" panel with a plugin field, a profile field,
  and buttons for verify / shell (timed and keep-open) / two-plugins-together /
  profile list.
- `docs/LAB-PROFILES.md`.

### Changed

- Reusing a lab profile no longer rewrites its `package.json`, and it gets a
  stable profile name (`lab-<name>`) so installed dependencies survive.
- `cleanup-home` reports `kept lab profile "<name>"` for persistent runs; the
  real-home hash check still runs unchanged.

Final suite: unit 96/96, integration 12/12.

## 0.1.0 - 2026-10-05 (single-plugin uninstall)

### Added

- `lab profile remove-plugin <name> <plugin...>`: uninstall one plugin from a
  persistent lab profile without deleting the profile. A selector may be a bare
  package name, `name@version`, or the recorded spec; the command runs
  `dsh plugin remove`, trims `dsh.profile.bundles`, unlinks any leftover
  `link:`/`file:` junction with `removeTreeSafely`, and drops the recorded spec
  from `lab-profile.json`. Unmatched selectors are reported and exit non-zero
  without spawning the runtime.
- `removeBundles()` in `profile-builder.js` and `forgetProfilePlugins()` /
  `profilePluginMatches()` in `lab-profile.js`, with unit coverage.
- `tests/integration/profile-remove-plugin.test.js`: installs two local
  fixtures, removes one, and asserts the bundle, `node_modules`, and recorded
  manifest all shrink while the other plugin and the fixture source survive.

### Fixed

- `verify`/`capture` with `--profile-lab` used a random profile name and
  rewrote `package.json` on every run, so plugins never accumulated and a
  second run could wipe the profile. They now share the stable `lab-<name>`
  profile with `shell` and only scaffold it when it is missing.
- `recordProfilePlugins` now stores the resolved package name next to the spec,
  so a local-directory plugin can be removed by package name.

Final suite: unit 103/103, integration 15/15.

## 0.1.0 - 2026-10-05 (real desktop dialog and notification)

### Added

- `lab shell --native-desktop`: drive the Electron shell with the real
  `dialog.showOpenDialog` folder picker and `Notification.show()` toast instead
  of the deterministic stubs. It requires `--show`/`--keep-open`; without a
  visible window the run stays in stub mode and `shell-desktop-mode` fails with
  the reason rather than opening a modal nobody can answer.
- `src/electron-shell/desktop-bridge.cjs`: the picker/notification glue, copied
  next to `main.js` into the cached runtime, unit-tested with fake `dialog` /
  `Notification` objects (`tests/unit/desktop-bridge.test.js`).
- `shell-notification` and `shell-desktop-mode` checks, plus
  `report.shell.desktopBridge` recording the resolved mode;
  `shell-desktop-bridges` now names the mode and whether the picker ran.

### Changed

- The native folder dialog is deliberately not auto-probed (it is modal and
  would block the run); the report shows it as wired but not auto-probed. The
  notification path is auto-probed and asserted in native mode.
- `runtime-builder.js` copies and refreshes its app files from an `APP_FILES`
  list instead of hard-coding `main.js` + `preload.js`.

Final suite: unit 116/116, integration 15/15.

### Fixed

- **Headless Edge leaked a process tree per run.** Edge's `msedge.exe`
  launcher exits as soon as it hands the real browser to a broker process, so
  `stopTracked` saw `exitCode !== null` and skipped the tree kill; a single
  `npm run test:e2e` left ~180 `msedge` processes and 19 temp dirs behind,
  which then slowed every later run and caused slot-count/pixel flakiness.
  Both browser paths now send CDP `Browser.close` and then
  `reapBrowserProcesses()` kills every `msedge` whose command line carries the
  run's unique `--user-data-dir`. Unit coverage in
  `tests/unit/browser-reap.test.js`; a suite run now leaves 0 extra processes.
- **Shell screenshot could be a stale/unpainted frame.**
  `captureWindowFrame()` retries `capturePage()` when it rejects
  (`UnknownVizError`) or returns a flat frame, without `invalidate()` (which
  hung `capturePage()`). `report.shell.result.capture` records the attempts and
  whether the frame stayed unpainted, and `shell-capture-painted` fails when it
  did.
- The shell probe now refuses to accept an early DOM plateau below the web
  baseline's slot count (`minSlots`), so a 24-slot pre-mount frame is no longer
  treated as "stable". `shell-dom-stable` reports the settle result.
- `compareScreenshots()` reports `visuallyIdentical` next to the raw
  `identical` flag, using a 0.001 changed-ratio tolerance for Edge-vs-Electron
  antialiasing; `shell-screenshot-diff` is now a real check on it.

Final suite: unit 120/120, integration 15/15.

## 0.1.0 - 2026-10-05 (failure signature library)

### Added

- The boot-log signature library grew from 11 to 22 entries and each entry now
  carries a `category`: `boot`, `plugin`, `client`, `profile`, `env`,
  `runtime`, or `crash`. New fingerprints: `unknown-slot-kind`,
  `unresolved-service`, `engines-unsatisfied`, `bundle-patch-missing`,
  `bundle-dependency-mismatch`, `port-in-use`, `host-boot-timeout`,
  `electron-main-crash`, `client-module-load`, `permission-denied`,
  `path-too-long`.
- `lab scan --list [--json]` prints the whole library (id, category, severity,
  root cause, fix) so the next reader does not have to grep the source.
- `docs/FAILURE-SIGNATURES.md`: the category table, the full entry list, and
  the rule for adding a pattern (positive *and* benign negative test).
- `report.signatureHits[]` and the HTML/Markdown reports now show the
  category next to each hit.

### Changed

- The log-scanner suite is table-driven: one real log line per signature plus a
  clean-boot negative test and a "ids are unique, fields present" library test.

Final suite: unit 145/145, integration 15/15.

## 0.1.0 - 2026-10-05 (visible run log and completion toast)

### Fixed

- **The GUI log pane had been squeezed to 0px.** Adding the new control rows
  pushed `.logwrap` below the 760px launcher window (measured:
  `logwrap.height = 0`, `top = 739`), so the CLI output was invisible and the
  only way to read a run was to open the report. The control groups now live in
  their own scroll region (`#controls`) and the log pane keeps
  `min-height: 220px`, so stdout/stderr is always on screen.
  `tests/integration/gui-page.test.js` now measures the real 1080x760 window and
  fails if the log pane collapses or the page overflows.

### Added

- The launcher shows an in-window result banner when a command finishes
  (green = 完成, red = 失败, with exit code and elapsed time; failures stay until
  the next run) and raises a real Windows notification for failures or runs
  longer than 5 seconds, via a new `lab:notify` IPC in
  `src/gui/{main,preload}.js`.

Final suite: unit 148/148, integration 15/15.

## 0.1.0 - 2026-10-05 (orphan processes and console signatures)

### Added

- `src/process-reaper.js`: one unit-tested reaper for the two things the lab can
  leak. `lab clean` now reaps orphaned lab processes as well as their temp
  directories, and runs report them via `report.cleanup.orphanProcesses`,
  `residue.advisory['no-lab-processes']`, and the `cleanup-orphan-processes`
  check. A process is an orphan when its run directory is gone, or is about to
  be removed by this `clean`; a concurrent run keeps its directory and is left
  alone.
- The Electron shell is now spawned with a per-run
  `--user-data-dir=<iso.root>\electron-userdata` and reaped by it when the run
  ends, so a killed or timed-out shell no longer survives.
- `consoleSignatureHits[]`: the failure signature library also reads browser
  console errors, page errors, and failed requests (`console-signatures`), and
  `signatureHits` is the deduped merge of boot logs + renderer errors. The shell
  report gained the same `boot-signatures` / `console-signatures` checks.

### Fixed

- `lab clean` deleted run directories before killing the processes holding
  them, which failed with `EBUSY` and left both behind. It now reaps first, then
  removes the directories.

Final suite: unit 160/160, integration 15/15.

## 0.1.0 - 2026-10-05 (unknown-failure context)

### Added

- `report.failureContext`: when a run fails without matching any fatal
  signature, the report now carries `{ reason, errors, bootTail, consoleErrors,
  pageErrors }` — the last 30 non-empty boot-log lines plus the renderer errors.
  Rendered as "未命中签名的失败上下文" in the HTML and Markdown reports, so an
  unknown failure is evidence instead of silence.
- `lab scan` no longer answers a real failure with "clean": when nothing matches
  but the log looks like a failure it prints the tail and says
  `no known signature, but the log looks like a failure`. A clean boot log still
  reports `scan: clean`.
- `lab scan --explain`: prints the lines around every match (boot or console),
  and the tail when nothing matched.
- `looksLikeFailure()` / `tailLines()` / `linesAroundMatch()` in
  `src/log-scanner.js`, with unit coverage.

Final suite: unit 167/167, integration 15/15.

## 0.1.0 - 2026-10-05 (host probe retries)

### Added

- `fetchWithRetry()` / `isRetryableNetworkError()` in `src/net-utils.js`:
  retries connection-level failures (`fetch failed`, `ECONNRESET`,
  `ECONNREFUSED`, ...) with a fresh per-attempt `AbortSignal.timeout()`, and
  deliberately does **not** retry timeouts or HTTP error statuses.
  `mintAuthCookie()` and `httpProbe()` use it (2 retries, 250 ms backoff),
  which removes the occasional `run: TypeError: fetch failed` that the
  stability run hit right after boot.
- A token-mint failure is now a failed `token-mint` check plus a
  `failureContext` entry instead of aborting the whole run, so the boot tail
  and console errors are still captured.

### Changed

- `rpc()` (the mock-model session RPC) is intentionally left without retries:
  it is a POST with side effects, and a blind retry could double-apply a
  mutation.

Final suite: unit 174/174, integration 15/15.

## 0.1.0 - 2026-10-05 (runtime version policy and version matrix)

### Added

- `src/runtime-versions.js`: the single source of truth for which official DSH
  versions the lab accepts, with four verdicts — `verified` / `untested` /
  `unsupported` / `unknown`. `doctor`, `verify`/`capture`, and `shell` use it for
  their `runtime-version` check, so an official 0.2.x update passes with an
  informational note instead of failing every run; `report.runtime.compat`
  records the verdict.
- `lab runtimes [--json]`: every distinct official launcher this machine can
  see, with its version and verdict. Extra installs come from
  `DSH_LAB_RUNTIMES` (semicolon-separated `dsh.cmd` or install directory), which
  also feeds `--runtime` resolution.
- `lab matrix --config X --runtime-matrix`: runs the same matrix once per
  discovered supported runtime and writes
  `artifacts/<id>/runtime-matrix.{json,md}`, with per-version classification and
  conflict counts. Unsupported runtimes are skipped and listed, never run.
- `docs/VERSION-POLICY.md`: the verdicts, the promotion procedure, and the list
  of version-specific assumptions to re-check after an official update.

### Changed

- Tests no longer pin the exact installed version: they assert
  `report.runtime.compat.supported` and that `readRuntimeVersion` parses a
  semver, so an official update does not break the suite by itself.

Final suite: unit 182/182, integration 15/15.

## 0.1.0 - 2026-10-05 (real boot-row transport, opt-in)

### Added

- `resolveHostLauncher()` plus a real IPC boot path: `dsh.cmd` is parsed for its
  exe and host entry, the host is spawned **directly** with
  `stdio: [..., 'ipc']` and `ELECTRON_RUN_AS_NODE=1`, and the
  `{ type: 'ready', url, injections }` message is accepted. With typed rows in
  hand the shell serves the packaged `dist/index.html` and hands the rows to the
  frontend (the desktop path) instead of the host-rendered index.
- `--boot-transport stdout|ipc` on `verify`/`capture`/`shell`. `stdout` is the
  default because the isolated `dsh web` app never sends that message; `ipc`
  opts in and degrades to stdout with a reason instead of failing.
- `spawnTracked({ ipc, runAsNode })` and `childEnv(env, { runAsNode })`: an IPC
  stdio channel, and a way to put `ELECTRON_RUN_AS_NODE=1` back for the host
  child (the default `childEnv` deliberately strips it).
- `shell-boot-injections`: parses the rows' *content* back out of the
  host-rendered index (count, kinds, names — a verified run shows
  `9 row(s) kinds=[script, script-src, style]`), while
  `shell-boot-transport`, `shell-index-source` and `boot-transport` record which
  transport was actually used.

### Fixed

- An `ipc` stdio channel kept the parent's event loop alive after the child was
  killed; `stopTracked` now disconnects it.
- `stopTracked` raced `once(child, 'exit')` against `sleep(ms)` without clearing
  the timer, so every Windows cleanup left a 5 s timer pending and delayed
  process exit. `waitForExit()` cancels it; the unit suite went from 5.9 s back
  to 1.8 s.

### Documented

- `docs/ELECTRON-SHELL.md` records the reverse-engineered desktop handshake —
  the private `dsh-desktop-host/lib/index.js` entry with its positional args and
  `ipc` channel, why the lab must not run it (it also wires the platform
  session and credentials), and what the lab does instead.

Final suite: unit 186/186, integration 15/15.

## 0.1.0 - 2026-10-05 (desktop shell: tray and boot-injection evidence)

### Added

- A real Electron `Tray` for visible shell runs (`--show` / `--keep-open`): an
  in-memory 16x16 icon (no asset file), tooltip, and a `显示窗口` / `退出` menu.
  Hidden runs skip it so automation stays invisible. The report carries
  `shell.tray` plus the `shell-tray` check, and `shell-mode.test.js` asserts the
  hidden-run shape (`skipped` + reason is informational, not a failure).
- `shell-boot-globals`: probes the host's index-injected globals
  (`__DSH_BOOT__`, `__DSH_BOOT_READY__`, `__DSH_TRANSPORT__` are required, plus
  `__DSH_CONTACT_CONFIG__`, `__DSH_SHORTCUTS_CONFIG__`,
  `__DSH_DOCUMENT_PREVIEW_CONFIG__`, `__DSH_MODELS_ONBOARDING__`,
  `__DSH_CONNECTION_RECOVERY__`) and reports `present=n/total`. A verified run
  shows `present=8/8` — evidence that the boot injections reached the shell.
- `docs/ELECTRON-SHELL.md` documents the reverse-engineered boot contract: the
  row kinds (`global | script | script-src | script-preload | style | html`),
  the host's IPC `{ type: 'ready', url, injections }` message from
  `ctx.webServer.collectIndexInjections()`, and why the lab uses the
  server-rendered index instead. The tray and the `__DSH_FILE_UPLOAD__`
  difference are documented there too.

### Changed

- `docs/VERSION-POLICY.md`'s version-specific assumption list gained the desktop
  handshake (`dsh.cmd` → `--expose-internals .../dsh-desktop-host/lib/cli.js`)
  and the injected global names.

Final suite: unit 182/182, integration 15/15.

## 0.1.0 - 2026-10-05 (matrix back in the GUI, collapsed)

### Added

- A collapsed **更多（矩阵）** disclosure in the GUI's 检查 group holds the two
  `matrix` presets (theme conflict, effect probe), so the mouse-driven flow has
  them again without giving up the log pane: it costs no height until opened,
  and opening it only makes the controls area scroll.
- `tests/integration/gui-page.test.js` asserts the disclosure starts closed,
  that the layout still fits when it is opened, and that the buttons dispatch
  `matrix --config ...`.

Final suite: unit 174/174, integration 15/15.

## 0.1.0 - 2026-10-05 (leaner GUI, profile dropdown)

### Changed

- The launcher is down to three groups. The old **Electron 壳** and
  **插件与主题** groups are gone: the shell buttons and the desktop checkboxes
  moved into the main **插件 / 持久 profile** group, and the wallpaper /
  matrix presets were dropped (the `matrix` command is still on the CLI).
  **检查** and **清理** stay as compact groups.
- The profile field is now a dropdown of the existing `.lab-profiles` entries,
  with `一次性运行（跑完删除）` and `新建 profile…` options. It is filled by a new
  `lab:profiles` IPC that runs `profile list --json`, refreshes after every run
  and from the 刷新 button, and shows each profile's installed specs in the
  option label.
- At the real 1080x760 window everything now fits without scrolling
  (controls 371px, log 197px), and
  `tests/integration/gui-page.test.js` asserts the dropdown wiring alongside
  the layout and banner checks.

Final suite: unit 148/148, integration 15/15.

## 0.1.0 - 2026-10-05 (mouse-driven entries for the new features)

### Added

- GUI launcher buttons for the three new capabilities: **卸载 profile 里的这个
  插件** (`profile remove-plugin`, uses the profile + plugin fields),
  **查看失败签名库** (`scan --list`), and two checkboxes in the Electron shell
  group — **原生桌面（真实文件夹对话框 + 系统通知）** and **启动时弹出文件夹
  对话框**.
- `lab shell --probe-native-dialog`: opens the real folder dialog during the
  run, waits for the user to pick a folder or cancel, and records the answer in
  the `shell-native-dialog` check. It needs `--native-desktop` plus
  `--show`/`--keep-open`; asking for it without those fails the check with the
  reason instead of opening a modal nobody can answer.
- `tests/integration/gui-page.test.js` now ticks both desktop checkboxes and
  asserts the shell commands carry `--native-desktop` / `--probe-native-dialog`
  (and that the dialog probe forces `--show`).
- `lab scan --latest [--artifacts <dir>]`: rescan the newest
  `artifacts/<run>/` that has boot logs, so the GUI's **扫描最近一次运行的日志**
  button works without a file picker. Unit coverage in
  `tests/unit/scan-latest.test.js`.

### Changed

- `docs/GUI.md` documents the new buttons and both desktop modes, including how
  to uninstall a single plugin without touching the others.

Final suite: unit 145/145, integration 15/15.
