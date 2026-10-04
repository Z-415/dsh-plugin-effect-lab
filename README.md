# DSH Plugin Effect Lab

Isolated plugin compatibility and effect verification for the official
DeepSeek Harness Desktop runtime `0.2.0-rc.2`.

Phase 1 is the minimum closed loop:

1. locate the official `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`;
2. create a short-lived isolated `DSH_HOME` under the OS temp directory;
3. write the shipped minimal `web` profile (empty dependencies plus
   `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`);
4. boot `dsh web --no-open --port 0` and parse the real port and launch token;
5. open the UI in headless Edge over CDP and save a screenshot;
6. capture boot logs, console errors, page errors, and host route status;
7. stop the process tree, verify the port is free, and delete the temp home;
8. compare SHA-256 hashes of real structural profile files before and after.

Phase 2 adds:

- plugin source resolution for npm, local directory, tarball, and GitHub specs;
- manifest checks for engines, peers, bundle patches, client declarations, and
  known incompatible APIs;
- an official fixed session fixture with user, assistant, and tool events;
- real client-half effect probes and token/body-attribute conflict detection;
- a JSON matrix runner for plugin combinations.

Phase 3 adds:

- a loopback OpenAI-compatible mock provider (`--mock-model`);
- a real streamed agent turn with a scripted tool call and `tool/result`;
- no external network and no real API key for that turn.
- explicit plugin route probing with `--route /plugin/health`;
- verified isolated runs for `dsh-plugin-wallpaper-engine@1.2.0` and
  `dsh-plugin-wallpaper-engine@1.2.0 + dsh-ui-tweaks@0.20.0`.

Phase 4 adds:

- a minimal Electron launcher that copies the official Electron runtime
  (read-only source) into a temp app dir;
- the desktop boot bridge (`dshDesktopBoot` -> `__DSH_TRANSPORT__`) so the
  packaged frontend talks to the isolated host;
- the `ws://127.0.0.1/*` header fence that forwards the renderer's launch
  cookie to the host Remote-stream socket;
- a shell-vs-web DOM / body-attribute / `--dsw-*` token diff, plus desktop-only
  attribute detection.

Measured Phase 4 results are in [docs/PHASE4-RESULTS.md](docs/PHASE4-RESULTS.md).

Acceptance C (duplicate slot id) and D (theme conflicts) are implemented and
measured: [docs/ACCEPTANCE-C-D-RESULTS.md](docs/ACCEPTANCE-C-D-RESULTS.md).
Duplicate ids are reported by namespace (`loader` / `slot-registration` /
`slot-key` / `tool`), and `matrix` classifies theme combinations as
`high-conflict` / `manual-review` / `coexist`.

Acceptance E (no-model mode) and F (no residue) are in
[docs/ACCEPTANCE-E-F-RESULTS.md](docs/ACCEPTANCE-E-F-RESULTS.md). Every run
records `agentCoverage`, scans the isolated home for credentials, and emits a
`cleanup-no-residue` check.

Phase 5 stabilization (long paths, process leaks, port races, failure
injection) is in [docs/PHASE5-RESULTS.md](docs/PHASE5-RESULTS.md).
The DOM assertion DSL lives in `src/dom-assertions.js` and is driven by
`--assert-token`, `--assert-slot`, `--assert-body-attr`, and `--min-slots`.

Shell mode installs plugins too (`lab shell --plugin <spec>`), and compares the
web baseline against the shell with both a DOM/token diff and a pixel diff
(`dom/shell-screenshot-diff.json`). On an unmodified profile the two
screenshots are pixel-identical.

Conversation fixtures are committed data (`fixtures/web-session/`) with
`default`, `empty`, and `long` variants selected by `--fixture-variant`. Shell
mode also bridges and reports the desktop-only surfaces (window controls,
clipboard, directory picker, host paths, notifications); the directory picker
is stubbed so nothing blocks on a native dialog.

The lab never starts the real `desktop` profile, never reads credentials,
sessions, or settings, and never installs a plugin outside its own temp home.

## Usage

```powershell
node bin/lab.js doctor
node bin/lab.js verify
node bin/lab.js verify --screenshot home --screenshot settings
node bin/lab.js verify --fixture-variant long
node bin/lab.js capture --screenshot home
node bin/lab.js verify --mock-model
node bin/lab.js verify --assert-slot conversation.composer --assert-body-attr style --min-slots 30
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online --route /wallpaper-engine/inventory
node bin/lab.js matrix --config .\fixtures\matrix\effect-conflict.json
node bin/lab.js matrix --config .\fixtures\matrix\theme-conflict.json --online
node bin/lab.js shell
node bin/lab.js shell --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
node bin/lab.js shell --no-compare-web
node bin/lab.js scan --log .\artifacts\<run>\boot.err.log
node bin/lab.js clean --dry-run
```

All commands that boot the real runtime need permission to spawn and terminate
child processes. A sandbox that denies `taskkill` will leave the host alive and
the command will not finish; run those commands outside such a sandbox.
An explicit `--runtime` or `--browser` path is authoritative: if it does not
exist the command fails instead of silently using the default.

Plugin installs are opt-in and require `--online` for registry/GitHub sources:

```powershell
node bin/lab.js verify --plugin .\my-plugin.tgz --offline
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
```

Fixtures and matrix examples are described in
[docs/FIXTURES.md](docs/FIXTURES.md).
The loopback provider is described in [docs/MOCK-MODEL.md](docs/MOCK-MODEL.md).
Phase 3 measured results are in [docs/PHASE3-RESULTS.md](docs/PHASE3-RESULTS.md).
The Electron shell evaluation is in
[docs/ELECTRON-SHELL.md](docs/ELECTRON-SHELL.md).

## Tests

```powershell
npm test
$env:DSH_LAB_E2E='1'; npm run test:e2e
npm run ci            # unit always; integration only when the runtime exists
```

The integration test boots the official runtime in an isolated home, drives
headless Edge, and asserts cleanup plus real-home hash invariance.
`test:e2e` runs files with `--test-concurrency=1` and covers isolated boot,
the loopback mock turn, the Electron shell, failure injection, a two-run port
race, and a three-times stability repeat.

## Safety

Read [docs/SAFETY.md](docs/SAFETY.md) before running any third-party plugin.
This tool is not a security sandbox; it is an isolation and evidence harness.
