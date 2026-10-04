# Acceptance E and F Results

Date: 2026-10-04 (Asia/Shanghai)
Runtime: official `0.2.0-rc.2`, isolated `DSH_HOME`, no real profile or credential.

## Case E: no-model mode

### What was added

- `src/model-coverage.js`:
  - `scanForCredentials(home)` walks the isolated home for credential files and
    inline API keys; it reports paths only, never values.
  - `describeAgentCoverage()` records the mode, that `realModelRequests` is
    always false, and what is not covered.
- `verify --screenshot settings` opens the settings page through
  `[data-slot="settings.trigger" | "settings.launcher" | "sidebar.settings"]`,
  captures `screenshots/settings.png`, and records which slots the settings
  page added.
- New checks: `no-model-credentials` (hard), `settings-ui` (hard when a
  settings screenshot is requested), `agent-coverage` (informational).

### Evidence

`artifacts/20261004T143431Z-7a274a/` (no API key, no `--mock-model`, no
`--online`):

```text
node bin/lab.js verify --screenshot home --screenshot settings
DSH Plugin Effect Lab: PASS
[PASS] no-model-credentials: isolated home has no credential file or inline API key
[PASS] fixture-workspace: ... (fixed workspace registered)
[PASS] fixture-session-listed / fixture-session-events: 9 event(s)
[PASS] dom-slots: 39 data-slot node(s)
[PASS] settings-ui: opened=true; sections added=5
       [settings.action, settings.close, settings.general.item, settings.header, settings.section]
[PASS] console-errors: 0 console error(s)
[PASS] agent-coverage: fixture-only: realModelRequests=false;
       uncovered=[real provider credentials and sign-in, real model output quality, outbound tool side effects]
```

`report.json` carries `agentCoverage`:

```json
{
  "mode": "fixture-only",
  "realModelRequests": false,
  "credentialsFound": false,
  "covered": ["isolated host boot", "client UI render", "fixed session fixture (user/assistant/tool events)"],
  "uncovered": ["real provider credentials and sign-in", "real model output quality", "outbound tool side effects"]
}
```

The conversation and settings pages both render with no model configured, and
the fixed fixture supplies `user/message`, `assistant/message`, and
`tool/result` without any provider key.

## Case F: no residue after a run

### What was added

- `src/cleanup.js` (the module the task-book layout asked for):
  - `listLabResidue()` / `snapshotLabResidue()` list real lab temp homes and
    exclude the reusable `dsh-lab-electron-<version>` cache.
  - `verifyNoResidue({ isolatedRoot, ports, before, after })` proves the run's
    own isolated root is gone and its port is free.
- `runner.js` and `electron-shell/shell-runner.js` snapshot residue before the
  run and record a `cleanup-no-residue` check plus `cleanup.residue` in
  `report.json`.
- `lab clean` now shares `listLabResidue()`.

### Evidence

Every run now prints:

```text
[PASS] cleanup-home: true
[PASS] cleanup-ports: none
[PASS] cleanup-processes: none
[PASS] cleanup-no-residue: isolated root removed, ports released; new lab homes: 0
[PASS] real-home-unchanged: all structural hashes unchanged
```

`report.json` `cleanup.residue`:

```json
{
  "ok": true,
  "checks": { "isolated-root-removed": true, "ports-released": true },
  "advisory": { "no-new-lab-homes": true },
  "failures": [],
  "newHomes": [],
  "portsStillListening": []
}
```

`isolated-root-removed` and `ports-released` are the per-run authoritative
signals. `no-new-lab-homes` is advisory: two lab runs may legitimately overlap
(the e2e suite runs test files in parallel), so a home created by another run
must not fail this one.

## Bugs found and fixed while running E/F

1. The first `cleanup-no-residue` implementation failed the mock-model and
   shell e2e tests with `no-new-lab-homes`. Node's test runner executes test
   files in parallel, so another run's isolated home appeared during this run.
   The global scan is now advisory and only the run's own root/port gate `ok`.
2. The settings check initially counted slots that the conversation view added;
   it now samples the slot set immediately before clicking settings, so the
   reported sections are settings-only.

## Still open (Phase 5)

- Windows long-path behaviour.
- Port-race and process-leak stress tests.
- Failure injection (host crash mid-run, install failure, browser death).
