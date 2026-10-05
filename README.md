# DSH Plugin Effect Lab

An isolated lab for finding out **what a DeepSeek Harness (DSH) plugin actually does**
and **how several plugins behave together** — without touching your real `~/.dsh`.

[简体中文](README.zh-CN.md) | **English**

## Why this exists

A DSH plugin is hard to judge from its source: it can install cleanly and still fail at
boot, load without visibly doing anything, fight another plugin over the same CSS token,
or behave differently in the Desktop shell than in the web UI. This lab boots the official
runtime inside a throwaway `DSH_HOME`, installs the plugin there, drives the real UI in
headless Edge, and writes down exactly what changed — then deletes the whole thing.

What you can use it for:

| Question | How |
|---|---|
| Does this plugin load, and does it have a visible effect? | `lab verify --plugin <spec>` — screenshots + DOM / token / body-attribute probes |
| Do two plugins conflict? | `lab matrix --config <file>`, or install both into a persistent profile and read `plugin-profile-audit` |
| Does the Desktop shell match the web UI? | `lab shell` — DOM / token diff plus a pixel diff |
| Why did the host fail to start? | the failure signature library and `lab scan`, plus the HTML report |
| Will this dirty my real DSH install? | every run is isolated; real profile files are hashed before and after |

What is covered today: isolated boot / capture / cleanup, plugin resolution and manifest
validation, fixed conversation fixtures, Electron-shell fidelity, theme and slot conflict
matrices, persistent lab profiles, a loopback mock model that runs a real streamed tool
turn with no network, a failure signature library, and a desktop GUI launcher.

## Requirements

- Windows. The lab drives Edge over CDP and uses `taskkill` to reap process trees.
- Node.js >= 22 (developed on Node 24).
- The official DeepSeek Harness Desktop installation. The default runtime is
  `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`; pass `--runtime <dsh.cmd>`
  to override it.
- Nothing to install: no Playwright/Puppeteer download, no packaging tool, no npm
  dependencies. Shell mode reuses the Electron runtime that ships with DSH.

## Quick start

```powershell
node bin/lab.js gui     # open the desktop launcher (builds once, then reuses it)
node bin/lab.js doctor  # environment self-check; must be PASS
```

You can also double-click `启动实验台.cmd`. The launcher runs the same commands as the
CLI and streams their output into a live log pane.

## Common workflows

### 1. Verify a plugin

```powershell
# a local directory or tarball — no network needed
node bin/lab.js verify --plugin .\my-plugin --offline

# an npm or GitHub spec — needs registry access
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
```

The run boots the isolated host, installs the plugin into an isolated profile, opens the
UI, captures screenshots, records `data-slot` nodes, `--dsw-*` tokens and body attributes,
then cleans up. Open `artifacts/<run>/report.html` to see the result.

Add assertions when you want a pass/fail gate:

```powershell
node bin/lab.js verify --plugin .\my-plugin --offline `
  --assert-slot conversation.composer --assert-body-attr style --min-slots 30
```

### 2. Compare the Desktop shell with the web UI

```powershell
node bin/lab.js shell
node bin/lab.js shell --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
node bin/lab.js shell --show                    # render the real Electron window for 6s
node bin/lab.js shell --native-desktop --show   # real folder dialog + OS notification
```

On an unmodified profile the shell and web screenshots are pixel-identical; the report
lists any DOM, token, or body-attribute differences the shell introduces.

### 3. Test several plugins together

```powershell
node bin/lab.js matrix --config .\fixtures\matrix\theme-conflict.json --online
```

`matrix` runs each combination and classifies it as `coexist`, `manual-review`, or
`high-conflict`, naming the exact tokens or slots the plugins fight over.

### 4. Keep a profile and add plugins one at a time

```powershell
node bin/lab.js shell --profile-lab dev --plugin dsh-plugin-wallpaper-engine@1.2.0 --online --show --keep-open
node bin/lab.js shell --profile-lab dev --plugin dsh-ui-tweaks@0.20.0 --online   # audits A+B
node bin/lab.js shell --profile-lab dev --show --keep-open                       # reopen, no --plugin
node bin/lab.js profile list
node bin/lab.js profile remove-plugin dev dsh-ui-tweaks@0.20.0
```

The profile stays isolated under `.lab-profiles/<name>/`, never in your real `~/.dsh`.
Adding a second plugin audits the whole profile, so an A+B conflict is reported even when
B alone passes.

### 5. Run a real agent turn without a real model

```powershell
node bin/lab.js verify --mock-model
```

A loopback OpenAI-compatible provider streams a scripted tool call and a `tool/result`
event, exercising the full turn loop with no network and no API key.

### 6. Diagnose a failure

```powershell
node bin/lab.js scan --latest
node bin/lab.js scan --log .\artifacts\<run>\boot.err.log --explain
node bin/lab.js scan --list   # browse the failure signature library
```

### 7. Clean up

```powershell
node bin/lab.js clean --dry-run   # show leftover temp dirs and orphan lab processes
node bin/lab.js clean             # remove them
```

## Command reference

| Command | What it does |
|---|---|
| `lab gui` | Desktop launcher window (`--install-shortcut` also adds a Desktop shortcut) |
| `lab doctor` | Self-check: runtime, Node, temp home, browser, real-home guard |
| `lab verify` | Full isolated plugin verification: boot, probes, screenshots, cleanup, report |
| `lab capture` | The same pipeline, tuned for screenshots |
| `lab shell` | Electron-shell fidelity: DOM / token and pixel diff against the web baseline |
| `lab matrix` | Run a JSON list of plugin combinations and classify conflicts |
| `lab runtimes` | List installed official DSH versions and their support status |
| `lab profile` | Manage persistent lab profiles: `list` / `create` / `remove` / `remove-plugin` / `path` |
| `lab scan` | Scan boot and console logs against the failure signature library |
| `lab clean` | Remove leftover lab temp dirs and orphan lab processes |

Every command accepts `--json`; `verify`, `capture`, `shell`, and `matrix` also accept
`--no-html`. Run `node bin/lab.js --help` for the full option list.

## Reports and artifacts

Each run writes `artifacts/<run-id>/` containing:

- `report.html` — self-contained (screenshots embedded), in Chinese
- `report.md` / `report.json` — the same checks in Markdown and machine-readable form
- `boot.out.log` / `boot.err.log`, `install.log`, `cleanup.json`
- `screenshots/`, plus DOM and diff data such as `dom/dom.json`

The HTML report can be opened or shared on its own, without the rest of the run
directory.

## Safety

- Never starts the real `desktop` profile; never reads credentials, sessions, or settings.
- Never modifies the official installation — `app.asar` is read-only to the lab.
- Every run uses a `dsh-lab-*` temp home that is deleted afterwards; the real profile's
  structural files are hashed before and after and must be unchanged.
- This is **not** a security sandbox. A malicious plugin still runs with your user
  privileges, so read [docs/SAFETY.md](docs/SAFETY.md) before testing untrusted plugins.

## Tests

```powershell
npm test
$env:DSH_LAB_E2E='1'; npm run test:e2e   # boots the real runtime; run it in a normal terminal
npm run ci
```

The integration suite boots the official runtime in an isolated home, drives headless
Edge, and asserts cleanup plus real-home hash invariance. It must run where child
processes can be spawned and killed: a sandbox that denies `taskkill` will leave the host
alive and the command will not finish.

## More documentation

- [docs/HANDOFF-20261005.md](docs/HANDOFF-20261005.md) — status, code map, pitfalls, checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — isolation model and run lifecycle
- [docs/GUI.md](docs/GUI.md) — the desktop launcher
- [docs/LAB-PROFILES.md](docs/LAB-PROFILES.md) — persistent profiles
- [docs/ELECTRON-SHELL.md](docs/ELECTRON-SHELL.md) — shell fidelity mode
- [docs/FIXTURES.md](docs/FIXTURES.md) / [docs/MOCK-MODEL.md](docs/MOCK-MODEL.md) — fixtures and the loopback provider
- [docs/VERSION-POLICY.md](docs/VERSION-POLICY.md) — adapting to a new official DSH runtime
