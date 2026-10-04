# Phase 4 Results: Electron Shell

Date: 2026-10-04 (Asia/Shanghai)
Runtime: official `0.2.0-rc.2` at `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`
Electron: `44.0.0` (copied from the official install, read-only)

## Replayable evidence

- Shell run: `artifacts/20261004T131835Z-80cc95/`
  - `report.json`, `report.md`
  - `dom/web-dom.json`, `dom/shell-dom.json`, `dom/shell-vs-web.json`
  - `screenshots/web-baseline.png`, `screenshots/shell.png`
  - `shell-result.json`, `boot.out.log`, `boot.err.log`
- Earlier failing shell run (before the trust fence):
  `artifacts/20261004T131523Z-a44590/` and `artifacts/20261004T131636Z-43340c/`.
- Regression tests: `tests/unit/shell-probe.test.js`,
  `tests/unit/electron-preload.test.js`,
  `tests/integration/shell-mode.test.js`.

Reproduce:

```powershell
node bin/lab.js shell
node bin/lab.js shell --json
node bin/lab.js shell --no-compare-web
$env:DSH_LAB_E2E='1'; npm run test:e2e
```

## Checks (run 20261004T131835Z-80cc95)

| check | result | detail |
|---|---|---|
| host-boot | PASS | isolated `dsh web` on an OS-assigned port |
| host-token | PASS | 303 + `dsh-auth-*` cookie |
| web-baseline-ui | PASS | 37 slots, 403 tokens (headless Edge) |
| shell-ui-ready | PASS | 37 slots, 403 tokens (Electron) |
| shell-token | PASS | `--dsw-alias-bg-base: #fff` |
| shell-stream-connected | PASS | no `[connection] connection lost` |
| shell-transport-bridge | PASS | `{present:true, ownsHost:true, streamBaseUrl:"http://127.0.0.1:4177"}` |
| shell-web-slots | PASS | web=37 shell=37, added=[], removed=[] |
| shell-web-body-attributes | PASS | 0 changed |
| shell-web-tokens | PASS | 403 vs 403, 0 changed |
| shell-desktop-only | PASS | body=[], tokens=[] |
| real-home-unchanged | PASS | all structural hashes unchanged |
| cleanup-home / cleanup-ports | PASS | temp home removed, port released |

Shell DOM settle: `{stable:true, slots:37, waitedMs:2153}`.
`shellVsWeb` diff magnitude: `0`.

## Findings

1. `[connection] connection lost, retry #1` was a real launcher defect, not
   host noise. The frontend resolves the WebSocket mux route against
   `__DSH_TRANSPORT__.streamBaseUrl ?? document.baseURI`; under `dsh-app://app`
   that produced `ws://app/api/remote.mux`. Fixed by adding the
   `dshDesktopBoot.ready()` bridge (`src/electron-shell/preload.js` + the
   `dsh-lab:boot` IPC handler) and the `ws://127.0.0.1/*` header fence in
   `src/electron-shell/main.js`.
2. `24 slots` was an unstable-DOM artifact. The web baseline used to be probed
   as soon as `#root` existed, before conversation slots mounted; the shell
   waited 5s. Both probes now wait until the slot count is stable, and both
   report 37 slots.
3. `#fff` is the correct light-theme baseline for an unmodified profile. It is
   identical in web and shell mode. The wallpaper plugin changes it to
   `transparent` in web mode; that is plugin effect, not shell drift.
4. `shell-desktop-only` is empty because this minimal launcher exposes desktop
   facts on `window` (`dshDesktopBoot`, `__dshLabShell`) instead of adding DOM
   body attributes. The diff check is in place and will report attributes and
   tokens as soon as a desktop-only surface adds any.
5. The preload probe runs in an isolated world, so `__DSH_TRANSPORT__` must be
   read from the main world; `probeDom()` in `main.js` does that explicitly.

## Shell plugin support and pixel diff (follow-up)

`lab shell` now installs plugins through the shared `installProfilePlugins`
pipeline, and compares `screenshots/web-baseline.png` with
`screenshots/shell.png` in headless Edge.

| run | result | evidence |
|---|---|---|
| unmodified profile | shell and web screenshots pixel-identical (`identical: true`, `changedRatio: 0`) | `artifacts/20261004T150359Z-e14a1f/` |
| `dup-slot-one` fixture plugin | `shell-token:--lab-dup-slot: one`, 0 shell/web token drift | `artifacts/20261004T145203Z-abf60e/` |
| `dsh-plugin-wallpaper-engine@1.2.0` | `bg-base: transparent` both modes; `data-we-adapter` = `desktop-official` (shell) vs `browser` (web) | `artifacts/20261004T150204Z-af6507/` |

Two launcher bugs surfaced while making the pixel diff honest:

- a fully hidden `BrowserWindow` does not composite on Windows, so
  `capturePage()` returned a near-white frame; the shell window is now visible
  with `opacity: 0` and `skipTaskbar: true`;
- Windows display scaling made `capturePage()` 1.5x the CSS size;
  `force-device-scale-factor=1` pins it to the CDP baseline.

The preload probe also ignored caller-asserted tokens, so an inline custom
property such as `--lab-dup-slot` was missing from the shell snapshot; asserted
tokens are now read from the main world and merged.

## Still open (Phase 5 / Definition of Done)

- Acceptance C (duplicate slot id) and D (`wallpaper + dream-skin`,
  `wallpaper + bloom`) are not yet run.
- Same-test stability x3 and process/port race tests are Phase 5.
- Window controls, clipboard, file dialogs, and notifications are not
  reproduced by this launcher.
- `src/dom-assertions.js` and `src/cleanup.js` from the task-book layout still
  do not exist as separate modules.
