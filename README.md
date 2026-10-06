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

## Desktop GUI buttons

`node bin/lab.js gui` (or double-clicking `启动实验台.cmd`) opens the launcher.
Every control runs the same `lab.js` command the CLI does, and the output streams
into the log pane; `中止` stops the running command.

**插件 / 持久 profile** (left)

- `插件` field — the spec to test: an npm/GitHub spec or a local path. Leave it
  empty to load only what the selected profile already has.
- `profile` dropdown — `一次性运行` (a temporary home, deleted afterwards), an
  existing `.lab-profiles/<name>` (its plugins are loaded and kept), or `新建`
  plus a name. `刷新` re-reads the profile list.
- `在壳窗口打开（自己关）` — opens the real Electron shell window for the current
  plugin/profile and leaves it open until you close it.
- `在壳窗口打开（20 秒）` — the same, auto-closing after 20 seconds.
- `壳 vs web 对比` — runs the shell and a web baseline over the same profile and
  diffs DOM slots, `--dsw-*` tokens and pixels.
- `再加一个插件一起验证` — runs the shell with a second plugin alongside the
  current one, so a cross-plugin conflict shows up.
- `卸载这个插件` — removes the plugin named in the `插件` field from the selected
  persistent profile only.
- `列出 profile` — opens the profile drawer: every `.lab-profiles/` entry with
  its plugin list, `克隆自 <kind>` source marker, and inline open / clone
  one-shot / uninstall / open-directory / delete actions. The same drawer has a
  read-only clone bar (**克隆为持久 profile** / **克隆为一次性运行（跑完即删）**)
  fed by the real profiles discovered under `~/.dsh/profiles`.
- `验证这个插件（出报告截图）` — the full isolated `lab verify` for that spec:
  checks, report, screenshots.
- `原生桌面` — use the real folder dialog and OS notification instead of the
  deterministic stubs (`--native-desktop`); `启动时弹出文件夹对话框` also opens the
  real picker during the run (`--probe-native-dialog`).

**检查** (right)

- `自检 doctor` — environment self-check; must PASS before anything else.
- `快速验证` — `lab verify` without installing a new plugin.
- `验证 + 设置页截图` — the same, plus a settings-page screenshot.
- `空会话` / `长会话（12 轮）` — run against the `empty` / `long` conversation fixture.
- `失败签名库` — browse the known failure signatures (`lab scan --list`).
- `扫描最近一次日志` — re-scan the newest run's boot logs (`lab scan --latest`).
- `查看已装的 DSH 版本` — `lab runtimes`.

**更多（矩阵 / 版本）** — collapsed under 检查

- `主题冲突矩阵` / `效果探针矩阵` — run the shipped matrix configs.
- `跨版本矩阵（每个版本各跑一遍）` — run the config once per discovered DSH version.

**清理**

- `查看残留（不改动）` — show leftover lab temp dirs and orphan processes.
- `清理残留临时目录` — reap the orphan processes, then delete those directories.

**Footer**

- `打开最新 HTML 报告` — open the newest `artifacts/<run>/report.html`.
- `打开 artifacts 文件夹` — open the artifacts directory.
- `中止` — stop the running command.

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

### 4b. Clone your real profile (persistent or one-shot)

```powershell
# persistent: kept under .lab-profiles/clone-web and reusable
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture
node bin/lab.js profile list        # clone-web: cloned from web (5 file(s)), no plugins recorded
node bin/lab.js shell --profile-lab clone-web --show --show-hold 3000

# overwrite an existing clone only on purpose
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture --force

# one-shot: deleted at the end; the run prints how to keep it
node bin/lab.js verify --clone-profile web --clone-plugins none --no-fixture
```

The real profile is read-only: only the structural files are copied, never
`node_modules`, credentials, settings, sessions, or agents. `lab real-profiles`
lists the read-only clone sources; the GUI drawer has the same
**克隆为持久 profile** / **克隆为一次性运行（跑完即删）** actions and shows
`克隆自 web` on the cloned row. See [docs/CLONE-PROFILE.md](docs/CLONE-PROFILE.md).

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

## DSH Desktop plugin (launcher)

The repo also ships a tiny DSH plugin, `dsh-plugin-effect-lab-bridge`
(`bridge-plugin/`). It installs into a DSH profile while **the lab itself stays
outside the profile**: it adds a left-sidebar entry (**实验舱**, a flask icon)
that opens a standalone panel, plus a **实验舱桥接** section under
Settings → Plugins. Both carry the same **启动实验舱** button, which starts the
lab's own Electron GUI as a separate process — the DSH window is never replaced
or disturbed. The host half also registers the agent-facing
`lab_verify_plugin` tool. The plugin ships its own stylesheet, so the button
follows the lab's flat palette (borderless light-blue fill, hover step) rather
than the host's default button look.

DSH Desktop manages its own profile, so `dsh plugin add` refuses it
(`profile "desktop" is managed exclusively by the Electron application`).
Install it by editing the profile:

1. Quit DSH Desktop completely (including the tray).
2. In `profiles/desktop/package.json`, add
   `"dsh-plugin-effect-lab-bridge": "file:<repo>/bridge-plugin"` to
   `dependencies`, and `"dsh-plugin-effect-lab-bridge"` to
   `dsh.profile.bundles`.
3. In `profiles/desktop/cordis.patch.yml`, point the plugin at the lab checkout:

   ```yaml
   - id: effect-lab-bridge
     config:
       labPath: '<path to the lab repo>'
   ```

4. Install with the runtime's own pnpm, then start the app again:

   ```powershell
   cd <profile>
   node "D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs" install --offline
   ```

Requirements and caveats:

- A real `node.exe` must be on `PATH`, or set `nodePath` in the same config
  block. The plugin never uses the Electron binary as Node.
- `file:` dependencies are **copied** into `node_modules`, so after changing
  `bridge-plugin/` you must re-run `pnpm install --offline` to refresh the copy
  the profile actually loads.
- `POST /dsh-lab-bridge/launch` is loopback-only and requires the per-host nonce
  injected into the renderer; it runs the fixed command `bin/lab.js gui` and
  never accepts caller-supplied arguments.
- More detail: [bridge-plugin/README.md](bridge-plugin/README.md),
  [docs/TASK-BRIDGE-LAUNCHER.md](docs/TASK-BRIDGE-LAUNCHER.md),
  [docs/BRIDGE-PLUGIN-RESULTS.md](docs/BRIDGE-PLUGIN-RESULTS.md).

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

## License

MIT — see [LICENSE](LICENSE).
