# Electron Shell Fidelity (Phase 4)

Status: implemented and verified against the official `0.2.0-rc.2` runtime.
Measured results are in [PHASE4-RESULTS.md](PHASE4-RESULTS.md).

## Confirmed desktop shape on 0.2.0-rc.2

- Electron major is `44.0.0` (copied from the official `DeepSeek Harness.exe`
  runtime; the official install is only read, `app.asar` is never modified).
- The renderer origin is `dsh-app://app`, not the host loopback origin.
- The official `lib/main.js` serves `/`, `/index.html`, `/assets/*`,
  `/favicon.svg`, and `/manifest.webmanifest` from the packaged frontend dist.
  All other paths are forwarded to the host with the launch cookie.
- The window uses `titleBarStyle: "hidden"` with a 40px title-bar overlay.
- There is no service worker in the desktop origin.

## Why a naive shell loses the host connection

The packaged frontend opens the Typert Remote stream as a WebSocket to the
absolute route `/api/remote.mux`. In
`@deepseek-ai/dsh-api-gateway/lib/types/client/stream-client.js` that URL is:

```js
const url = new URL(REMOTE_STREAM_MUX_PATH.slice(1),
  globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
```

In web mode `document.baseURI` is the host origin, so the socket dials
`ws://127.0.0.1:<port>/api/remote.mux` and works. In a shell that serves the
app from `dsh-app://app/`, the same expression dials `ws://app/api/remote.mux`,
which no one answers, and the client logs
`[connection] connection lost, retry #1`.

The official desktop avoids this with two pieces that a minimal launcher must
reproduce:

1. `lib/preload-app.cjs` exposes `window.dshDesktopBoot.ready()`, backed by the
   `dsh-desktop:boot` IPC handler. It resolves
   `{ injections, streamBaseUrl: new URL(hostUrl).origin }`, and the frontend
   then sets `globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }`.
2. `lib/main.js` installs a `session.webRequest.onBeforeSendHeaders` fence for
   `ws://127.0.0.1/*` that requires `origin === "dsh-app://app"` and rewrites
   the handshake to `origin: <host origin>`, `cookie: <launch cookie>`,
   `sec-fetch-site: "same-origin"`.

Both were missing in the first Phase 4 prototype. This is the "trust fence"
that lets the renderer talk to its own Host without weakening the host's
loopback auth.

## Implemented minimal launcher

`src/electron-shell/`:

- `runtime-builder.js` copies the official Electron runtime into
  `%TEMP%\dsh-lab-electron-<version>\` and drops `main.js` + `preload.js` into
  `resources/app`. The official install stays read-only.
- `main.js` registers the `dsh-app://` protocol, forwards non-asset requests to
  the isolated host with the launch cookie, exposes the `dsh-lab:boot` IPC
  bridge, installs the WebSocket header fence, waits for a stable slot count,
  probes the DOM, and captures the window.
- `preload.js` exposes `window.dshDesktopBoot` (the boot bridge) and
  `window.__dshLabShell.collect()` (slots, `--dsw-*` / `--we-*` tokens, body
  and HTML attributes, title-bar geometry, desktop facts).
- `shell-probe.js` normalizes a snapshot and diffs web mode against shell mode.
- Plugins are installed into the isolated profile through the same
  `installProfilePlugins` pipeline as `verify`, so `lab shell --plugin ...`
  tests the plugin's effect inside the shell, not just the bare baseline.
- `main.js` pins `force-device-scale-factor=1` and renders an opacity-0 window,
  so `capturePage()` returns CSS-pixel-sized frames that actually composite
  (a fully hidden window returns a blank surface on Windows).
- `compareScreenshots` diffs the web baseline and the shell capture inside
  headless Edge, returning an overall `changedRatio` and a 64x40 cell grid.

Deviation from the official launcher: this lab serves the **host-rendered**
`index.html` (which already contains the boot injection rows) instead of
rendering the packaged dist and shipping injections over IPC. The boot bridge
therefore returns `injections: []` and only publishes `streamBaseUrl`. This
keeps client plugins loadable without re-implementing the host's
`renderIndex` output.

## Trust boundary

- `dsh-lab:boot` and `dsh-lab:boot-failed` reject any sender whose frame URL is
  not `dsh-app://app/`.
- The WebSocket fence only rewrites handshakes that target the isolated host's
  own `127.0.0.1:<port>` and that carry `origin: dsh-app://app`; anything else
  is cancelled.
- The launch cookie belongs to the temp host and is injected into that
  session's handshake only. The lab never reads real credentials, the real
  `~/.dsh`, or the `desktop` profile.

## Verification

```powershell
node bin/lab.js shell                 # Edge baseline + Electron shell + diff
node bin/lab.js shell --no-compare-web
node bin/lab.js shell --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
node bin/lab.js shell --show          # real window on screen, 6s hold
node bin/lab.js shell --keep-open      # leave it open; close it to finish
```

By default the window renders at `opacity: 0` so automation stays invisible.
`--show` sets it to a normal window (and holds `--show-hold <ms>`, default
6000, before closing); `--keep-open` waits until you close it, then writes the
result and cleans up the isolated home.

Cleanup does not assume the window closed synchronously: after the shell is
stopped the runner reaps every `DeepSeek Harness.exe` / `msedge.exe` process
that references the run root, waits for them to disappear, and retries the
delete with exponential backoff for a 30s budget. If the root still cannot be
removed, `cleanup-home` / `cleanup-no-residue` and `cleanup.json` carry the
locked path, the EBUSY/EPERM code, and the holding pid/name. The
`isolated-root-removed` criterion itself is not relaxed.

The delete walk is also race-tolerant: a plugin such as `dsh-orb` extracts and
then removes its own Electron runtime under the isolated home, so a path can
vanish (`ENOENT`) or briefly reappear (`ENOTEMPTY`) while the lab is deleting
the same tree. The walk treats a vanished entry as already removed and re-sweeps
a directory that is briefly non-empty, instead of aborting the whole attempt.

`lab shell` writes `artifacts/<run-id>/dom/{web-dom.json,shell-dom.json,shell-vs-web.json}`
plus `screenshots/{web-baseline.png,shell.png}` and
`dom/shell-screenshot-diff.json`. The measured baseline is
identical in both modes: 37 slots, 403 tokens, `--dsw-alias-bg-base: #fff`,
body attributes `style`, and no `--dsw-*` value change.

For the unmodified profile the two screenshots are pixel-identical
(`identical: true`, `changedRatio: 0`). With
`dsh-plugin-wallpaper-engine@1.2.0` the shell reports
`data-we-adapter: desktop-official` where web mode reports `browser`, and the
pixel diff is dominated by the plugin's random wallpaper choice.

Two earlier observations are now explained rather than "fixed" in the launcher:

- the old shell probe reported 24 slots because the DOM had not finished
  mounting conversation slots; both probes now wait for a stable slot count;
- `#fff` is the correct light-theme baseline for an unmodified profile, not a
  shell/preload artifact.

## Desktop-only bridges

The preload mirrors the official window names so the UI can use them, and
`lab shell` records what actually happened in `report.shell.capabilities`:

| surface | bridge | behaviour in the lab |
|---|---|---|
| window controls | `navigator.windowControlsOverlay` + `titleBarOverlay{height:40}` | real; `shell-window-controls` asserts available + overlay height |
| clipboard | Electron `clipboard` in the main process | real write/read round-trip; informational because the OS clipboard is shared and another process may own it |
| directory picker | `window.__DSH_DIRECTORY_PICKER__.pick()` | `stub` (default): returns the fixture workspace; `native`: real `dialog.showOpenDialog` |
| host paths | `window.__DSH_HOST_PATHS__.pathFor(file)` | bridged stub returning `file.path` |
| notifications | `window.__dshLabShell.notify()` -> `dsh-lab:notify` | `stub` (default): recorded and suppressed; `native`: real `Notification.show()` toast |

### Desktop modes

Two modes are selected with `--native-desktop`:

- **`stub`** (default). Deterministic: the picker returns the fixture directory
  and notifications are recorded without an OS toast, so automation never
  blocks. `shell-desktop-bridges` and `shell-notification` report the stub
  results as informational.
- **`native`** (`--native-desktop`, requires `--show` or `--keep-open`). The
  main process wires the real Electron `dialog.showOpenDialog` and
  `Notification`. The notification path *is* auto-probed and asserted
  (`shell-notification` requires `shown >= 1`), so a real toast is raised. The
  **folder dialog is never auto-probed** because it is modal and would block
  the run; `shell-desktop-bridges` reports
  `directoryPicker=native (not auto-probed ...)` and you trigger it from the
  visible window.

`--native-desktop` without `--show`/`--keep-open` is refused: the run keeps
going in stub mode and `shell-desktop-mode` fails with the reason, instead of
opening a modal dialog nobody can answer. `report.shell.desktopBridge` records
the resolved mode.

The bridge glue lives in `desktop-bridge.cjs` (copied next to `main.js` in the
cached runtime) so both branches are unit-tested with fake `dialog` /
`Notification` objects in `tests/unit/desktop-bridge.test.js`.

### Screenshot capture

The automated window is `opacity: 0` + `show: true`, but the Windows
compositor still occasionally skips painting it: `capturePage()` can reject
with `UnknownVizError` or return a stale flat frame. `captureWindowFrame()`
retries a few times (never with `invalidate()`, which hung `capturePage()`),
and the result's `capture = { attempts, unpainted, error }` is reported;
`shell-capture-painted` fails if the frame never painted.

The DOM probe refuses to accept an early plateau: `waitForStableShell()` only
accepts a stable slot count once it has reached `minSlots`, which the runner
sets to the web baseline's count. `shell-dom-stable` reports that settle.

`compareScreenshots()` keeps the raw `identical` byte-equality flag and adds
`visuallyIdentical` (`changedRatio <= 0.001`, for Edge-vs-Electron
antialiasing). `shell-screenshot-diff` is a real check on `visuallyIdentical`,
so a stale or genuinely divergent frame fails the run.

## Tray

The official app keeps a tray icon. `lab shell` creates a real Electron `Tray`
for a **visible** run (`--show` / `--keep-open`): a 16x16 icon built in memory
(no asset file), tooltip `DSH Plugin Effect Lab (lab shell)`, and a menu with
`显示窗口` / `退出` (the exit item closes the window, which is what finishes a
`--keep-open` run). A hidden run skips it and reports
`shell-tray: skipped: hidden run (pass --show or --keep-open)`, so automation
stays invisible. `report.shell` carries
`tray = { created, skipped, tooltip, menuItems, error }`.

## Boot injections

The official frontend applies the host's boot rows itself. Reverse-engineered
from the packaged `index-*.js`:

```js
const boot = globalThis.dshDesktopBoot;        // our preload exposes this
if (boot !== undefined) {
  boot.ready().then(({ injections, streamBaseUrl }) => {
    globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl };
    for (const row of injections) switch (row.kind) {
      case 'global':         globalThis[row.name] = row.value; break;
      case 'script':         /* inline <script> text, head | body */ break;
      case 'script-src':     /* external <script src> */ break;
      case 'script-preload': /* nothing to do */ break;
      case 'style':          /* inline <style> */ break;
      case 'html':           /* insertAdjacentHTML, head | body */ break;
      default: throw new Error(`web boot: unknown index injection row ${JSON.stringify(row)}`);
    }
  });
}
```

### Where the rows come from

`ctx.webServer.collectIndexInjections()` runs **inside the host process**
("the typed rows plugins contribute to the boot"), and the host sends them to
its parent over an IPC channel:

```js
if (process.connected) process.send({ type: 'ready', url, injections });
```

The official app gets them by spawning a **private desktop-host entry**, not
`dsh web`:

```js
// reverse-engineered from the packaged main bundle
const entry = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js');
spawn(node, ['--expose-internals', entry, runtimeDir, projectDir, primaryRuntime, ...pnpmAndNodeBin], {
  cwd: projectDir,
  env: desktopNodeEnvironment(...),
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
```

Two things follow, both verified on 0.2.0-rc.2:

1. The isolated `dsh web` profile the lab boots **never sends that message**,
   and `webServer` is **not** on the HTTP RPC surface (probing
   `webServer/collectIndexInjections` and four name variants returns 404).
2. The desktop-host entry is the app's private launcher: it also wires the
   platform session and credential plumbing, so the lab must not run it — that
   would break the "never touch real credentials/sessions" rule.

### What the lab does

- Default transport is `stdout`: spawn `dsh.cmd` and parse the readiness line
  (the pre-existing, zero-overhead path).
- `--boot-transport ipc` opts into the real thing: read the exe + host entry out
  of `dsh.cmd` (`resolveHostLauncher`), spawn the host **directly** with
  `stdio: [..., 'ipc']` and `ELECTRON_RUN_AS_NODE=1` (`spawnTracked({ ipc: true,
  runAsNode: true })`), and accept `{ type: 'ready', url, injections }`. With
  rows in hand the shell serves the **packaged** `dist/index.html` and hands the
  typed rows to the frontend, instead of the host-rendered index. A channel
  handed to `cmd.exe` never reaches the Node process, which is why the direct
  spawn is required.
- If the message never arrives (today's `dsh web`), the boot degrades to the
  stdout path with a reason in `report.<mode>.boot.transport` /
  `shell.bootTransport` and the `boot-transport` / `shell-boot-transport`
  checks. It does not fail the run.

### Evidence on every run

- `shell-boot-globals` probes the injected globals — `__DSH_BOOT__`,
  `__DSH_BOOT_READY__`, `__DSH_TRANSPORT__` (required) plus
  `__DSH_CONTACT_CONFIG__`, `__DSH_SHORTCUTS_CONFIG__`,
  `__DSH_DOCUMENT_PREVIEW_CONFIG__`, `__DSH_MODELS_ONBOARDING__`,
  `__DSH_CONNECTION_RECOVERY__`. A verified run reports `present=8/8`.
- `shell-boot-injections` derives the rows' **content** from the
  host-rendered index (the host inlines the same rows for the web path) and
  reports count, kinds and names. A verified run reports
  `9 row(s) kinds=[script, script-src, style]` with names such as
  `__DSH_CONTACT_CONFIG__` and `plugins/...`.

## Not covered

- The official **update UI** is not reproduced. The lab ships no updater, and
  faking one would be misleading; a plugin that depends on the updater surface
  is out of scope.
- Boot rows reach the document through the server-rendered index by default.
  The desktop IPC transport is implemented (`--boot-transport ipc`) but the
  isolated `dsh web` profile does not send the message, so it degrades unless a
  launcher that does is provided.
- `window.__DSH_FILE_UPLOAD__` is a *page-provided upload carrier hook* the
  frontend reads (it lets blob/stream request bodies use the page's fetch
  instead of a short-lived Worker), not a main-process bridge. The lab does not
  set it, so uploads fall back to the client runtime's Worker path.
- Desktop-only DOM attributes: the minimal launcher exposes desktop facts on
  `window` instead of adding body attributes, so `shell-desktop-only` is
  expected to report empty until a desktop-only attribute is actually added.
