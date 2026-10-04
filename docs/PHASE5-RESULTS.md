# Phase 5 Results: Stabilization

Date: 2026-10-04 (Asia/Shanghai)
Runtime: official `0.2.0-rc.2`; every run isolated, no real profile or credential.

## Summary

| area | mechanism | evidence |
|---|---|---|
| Windows long paths | `MAX_LAB_ROOT_LENGTH = 120` + `assertShortLabRoot()` | `tests/unit/path-and-ports.test.js` |
| Process leaks | per-run `cleanup.residue` + `cleanup-processes` | `tests/integration/stability.test.js` |
| Port races | two concurrent runs, three sequential runs | `tests/integration/stability.test.js` |
| Failure injection | missing plugin, duplicate declarations, unreachable runtime | `tests/integration/failure-injection.test.js` |
| Determinism | `test:e2e` runs files with `--test-concurrency=1` | `package.json` |
| DOM assertion DSL | `src/dom-assertions.js` + `--assert-slot` / `--assert-body-attr` / `--min-slots` | `artifacts/20261004T144258Z-d33eb9/` |

Final suite: **unit 72/72**, **integration 8/8** (`DSH_LAB_E2E=1`).

## DOM assertion DSL

`src/dom-assertions.js` (the last module the task-book layout asked for)
evaluates a small spec against a captured probe:

```powershell
node bin/lab.js verify `
  --assert-slot conversation.composer `
  --assert-body-attr style `
  --min-slots 30

[PASS] token:--dsw-alias-bg-base: #fff
[PASS] slot:conversation.composer: present
[PASS] body-attribute:style: --dsh-content-font-size: 14px;
[PASS] min-slots: 39 >= 30
```

Check names keep the historical `token:` / `slot:` / `body-attribute:` shape.

## Windows long paths

`src/home-manager.js` now exports `MAX_LAB_ROOT_LENGTH` (120) and
`assertShortLabRoot()`. `createIsolatedHome()` refuses a root longer than that,
so plugin installs never start from a deep temp path. The lab repo itself lives
under a non-ASCII path (`...\新建文件夹 (2)\dsh-plugin-effect-lab`), and every
run above exercised that path end to end.

## Process leaks

`src/cleanup.js` snapshots lab temp homes before a run and verifies after it:

```text
[PASS] cleanup-processes: none
[PASS] cleanup-no-residue: isolated root removed, ports released; new lab homes: 0
```

`isolated-root-removed` and `ports-released` gate `ok`.
`no-new-lab-homes` is advisory because concurrent lab runs legitimately create
their own homes (this was a real flake found under Node's parallel test runner).

## Port races

- Two concurrent `runLab()` calls booted two isolated hosts, took **distinct
  OS-assigned ports**, and both released them: 11.3s, both `ok`, zero residue.
- The same run repeated three times took three distinct ports with an identical
  `data-slot` count (34.4s), satisfying the "repeat three times" Definition of
  Done item.

## Failure injection

| injected failure | result | residue |
|---|---|---|
| missing plugin directory | FAIL in 0.44s at precheck | root removed, ports free |
| duplicate slot/tool declarations | FAIL in 0.31s before boot | root removed, ports free |
| unreachable explicit runtime path | FAIL in 12ms | no home created, no residue |

The explicit-path case exposed a real bug: `--runtime <missing>` silently fell
back to the default install, so the injected failure never happened.
`locateRuntime()` and `findBrowser()` now treat an explicit path as
authoritative and throw when it does not exist.

## Determinism

The stability tests are heavy (one file runs two hosts concurrently and another
runs three sequential host+Edge lifecycles). `npm run test:e2e` therefore uses
`--test-concurrency=1`, so integration files do not compete for ports or
interfere with each other's residue checks.

## Still open

- Real window controls, clipboard, file dialogs, notifications, and updater UI
  are not reproduced.
- Case E/Case F screenshots are saved but not visually diffed across runs.
