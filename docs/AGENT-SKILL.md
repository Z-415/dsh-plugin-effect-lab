# Agent Notes

An agent using this tool should:

1. run `node bin/lab.js doctor` first and stop if it fails;
2. use `verify` or `capture` with no plugin to establish a clean baseline;
3. add one plugin at a time, in `--offline` mode when using a local tarball or
   directory;
4. read `report.json` rather than guessing from console output;
5. treat fatal `signatureHits` as blockers, warnings as context;
6. never run `dsh plugin --profile desktop` and never point `DSH_HOME` at the
   real `~/.dsh`;
7. use `scan --log` for previously captured boot logs;
8. use `clean --dry-run` before deleting orphan lab temp homes.
9. run `matrix --config <json>` when two plugins may touch the same token,
   body attribute, or slot;
10. use `--no-fixture` only when the fixed session would interfere with a
    specific plugin test.
11. use `--mock-model` when a real streamed assistant/tool turn is required
    without network or credentials.
12. use `lab shell` to compare Electron and web DOM/body/tokens, and read
    `dom/shell-vs-web.json` plus the `shell-*` checks instead of eyeballing a
    screenshot.
13. run runtime-touching commands with permission to spawn and force-kill
    child processes. A sandbox that denies `taskkill` leaves the host and
    Electron alive, so the CLI cannot exit and the temp home cannot be deleted.
    That is an environment limitation, not a lab failure.
14. read duplicate findings by namespace: `loader` (patch id) is not the same
    as `slot-registration` (a slot `id`), `slot-key` (a slot `name`), or
    `tool`. Only the first three can be detected statically; a shared slot key
    is usually legitimate.
15. for theme combinations use `matrix --config` and read
    `classification.summary`: `high-conflict` means two runs set the same
    token/body attribute/layer z-index to different values, `coexist` means no
    theme-axis change, and `manual-review` needs a human visual decision.
    `layers` in each run's DOM lists background layers with their z-index.
16. read `agentCoverage` to know whether a run used the fixed fixture only or
    the loopback mock model. `realModelRequests` is always false; never claim a
    real provider was exercised.
17. pass `--screenshot settings` when the settings page matters; the run
    records the settings-only slot delta in `report.settings`.
18. treat `cleanup.residue.checks` as the per-run no-residue proof.
    `advisory['no-new-lab-homes']` may be false when another lab run overlaps;
    that is not a failure of the run under test.
19. pass an explicit `--runtime` or `--browser` only when that exact path must
    be used; the command fails if it is missing instead of falling back.
20. run `test:e2e` with `DSH_LAB_E2E=1`. It executes integration files
    sequentially and takes about 140 seconds (two concurrent runs plus three
    stability repeats).
21. express DOM checks with `--assert-token` / `--assert-slot` /
    `--assert-body-attr` / `--min-slots`; the checks are evaluated by
    `src/dom-assertions.js` and appear as `token:` / `slot:` /
    `body-attribute:` / `min-slots` in the report.
22. `lab shell --plugin <spec> [--online]` installs plugins with the same
    pipeline as `verify`. Read `shell.screenshotDiff` (or
    `dom/shell-screenshot-diff.json`) for the pixel diff; an unmodified profile
    must be `identical: true`. `shell.desktopOnly.hintedBodyAttributes` lists
    desktop-only attributes such as `data-we-adapter`.
23. use `npm run ci` as the single entry: unit tests always run, then doctor and
    the integration suite when the official runtime is present.
24. choose the conversation fixture with `--fixture-variant default|empty|long`.
    The specs live in `fixtures/web-session/`; every message-producing event
    needs `surfaceOp: "append"` or the session format rejects it.
25. read `report.shell.capabilities` for desktop-only surfaces. Window controls
    and the clipboard round-trip are real; the directory picker is a stub that
    returns the fixture workspace, and notifications are recorded but
    suppressed. Add `--native-desktop --show` for the real
    `dialog.showOpenDialog` / `Notification` paths (the OS toast is asserted;
    the modal folder dialog needs `--probe-native-dialog` and a human). A
    visible run also creates a real tray (`shell-tray`).
26. open `report.html` (or `matrix.html`) when a human needs to read a run: it
    embeds the screenshots and the diffs and needs no server. `--no-html` skips
    it. Use `lab shell --show` (optionally `--keep-open`) when someone needs to
    look at or click the real Electron window; that opens a real window on the
    desktop.
27. prefer `lab gui` when the user wants to drive the lab with a mouse. It is a
    thin launcher: every button runs the same `bin/lab.js` command, so behavior
    and safety are identical to the CLI. Its copied runtime lives in the
    project's `gui-runtime\gui-<version>` (override with `DSH_LAB_GUI_HOME`),
    and the official install is only read. Do not build it under
    `%LOCALAPPDATA%`: a packaged host such as the Codex desktop app redirects
    that into its own MSIX sandbox and the Desktop shortcut then fails.
    The launcher reads `DSH_LAB_GUI_CONFIG`, or `gui-config.json` next to
    `main.js` for a plain double-click.
28. use `--profile-lab <name>` when a plugin must stay installed across runs,
    or when plugins should be added one at a time to study their interaction.
    The profile lives in `<project>\.lab-profiles\<name>` (git-ignored) and
    never touches the real `~/.dsh`. Adding a plugin audits the whole profile
    (`plugin-profile-audit`), which is the only place an A+B-only conflict
    shows up - a per-run precheck cannot see A. One-shot runs stay the default.

29. use `lab profile remove-plugin <name> <plugin>` to uninstall a single
    plugin from a persistent profile. Selectors accept a bare name,
    `name@version`, or the recorded spec; the bundle order and the
    `link:`/`file:` junction are cleaned up with `removeTreeSafely()`, so the
    plugin source is never touched.
30. read both signature sources: `report.signatureHits` (boot logs, deduped
    with the console) and `report.consoleSignatureHits` (renderer only). When a
    failed run matches no fatal signature the report carries
    `report.failureContext` (last 30 boot lines + console/page errors); that is
    the raw material for a new entry in `src/log-scanner.js`. `lab scan --list`
    prints the 22-entry library and `--explain` prints the lines around a hit.
31. use `lab runtimes` to see every official launcher the machine has and its
    verdict (`verified` / `untested` / `unsupported` / `unknown`). Add installs
    with `DSH_LAB_RUNTIMES` (semicolon-separated `dsh.cmd` or install dir);
    `lab matrix --config X --runtime-matrix` runs the same matrix once per
    supported runtime. Read `docs/VERSION-POLICY.md` before promoting a version:
    a new 0.2.x passes with an informational note, not a failure.
32. use `lab clean` (or `--dry-run` first) to remove leftover temp directories
    **and** reap orphan lab processes. A process is only reaped when its run
    directory is gone or is being removed, so a concurrent run is safe.
33. leave `--boot-transport` at its `stdout` default. The `ipc` value is
    implemented and tested (direct host spawn + `ipc` stdio, typed
    `{ type: 'ready', url, injections }` rows, packaged-dist index), but the
    isolated `dsh web` app never sends that message; only the app's private
    `dsh-desktop-host/lib/index.js` entry does, and the lab must not run it.
    `shell-boot-globals` / `shell-boot-injections` are the always-on evidence.

Do not attach large screenshots to a model context. `artifacts/**/screenshots`
are evidence for humans; machine decisions come from the DOM/token JSON.
