# Changelog

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
