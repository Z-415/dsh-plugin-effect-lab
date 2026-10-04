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
```

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
| directory picker | `window.__DSH_DIRECTORY_PICKER__.pick()` | bridged and **stubbed**: returns the fixture workspace instead of opening a native dialog |
| host paths | `window.__DSH_HOST_PATHS__.pathFor(file)` | bridged stub returning `file.path` |
| notifications | `window.__dshLabShell.notify()` -> `dsh-lab:notify` | recorded and **suppressed**: no OS toast is raised |

`shell-desktop-bridges` reports the stub results; `shell-window-controls` and
`shell-clipboard` report the real surfaces. Native dialogs and OS toasts are
deliberately not raised because they cannot be asserted unattended.

## Not covered

- Window controls, clipboard, native file dialogs, notifications, tray, and
  update UI are not reproduced; they need their own assertions.
- The lab does not inject real host boot rows over IPC, so a plugin that relies
  on desktop-only injection rows would need the packaged-dist path.
- Desktop-only DOM attributes: the minimal launcher exposes desktop facts on
  `window` instead of adding body attributes, so `shell-desktop-only` is
  expected to report empty until a desktop-only attribute is actually added.
