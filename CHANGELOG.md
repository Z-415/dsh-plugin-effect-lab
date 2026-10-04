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
