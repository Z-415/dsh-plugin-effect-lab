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
    sequentially and takes about 100 seconds (two concurrent runs plus three
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

Do not attach large screenshots to a model context. `artifacts/**/screenshots`
are evidence for humans; machine decisions come from the DOM/token JSON.
