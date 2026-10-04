# Acceptance C and D Results

Date: 2026-10-04 (Asia/Shanghai)
Runtime: official `0.2.0-rc.2`, isolated `DSH_HOME`, no real profile or credential.

## Case C: duplicate slot id

### What was added

- `src/declaration-scanner.js` reads a plugin's shipped bundle text and labels
  duplicate ids by namespace:
  - `loader` - `cordis.patch.yml` entry ids;
  - `slot-registration` - `ctx.slots.register({ id })`;
  - `slot-key` - `ctx.slots.register({ name })`;
  - `tool` - `defineTool({ name })`.
- `precheckPlugins` reports collisions **before** install/boot for local
  directory and tarball sources; `postcheckPlugins` repeats the check on the
  installed tree.
- Fixtures `fixtures/plugins/dup-slot-one` and `dup-slot-two` use the official
  `ctx.slots.register` API from the shipped plugin-development template.
  They keep **distinct** loader ids, share one **slot registration id**
  (`lab-dup-decoration`), target one **slot key**
  (`conversation.composer.dock`), and declare one **tool name**
  (`lab_dup_tool`).

### Evidence

Pre-boot detection - `artifacts/20261004T134926Z-52f23c/`:

```text
node bin/lab.js verify --plugin ./fixtures/plugins/dup-slot-one \
  --with ./fixtures/plugins/dup-slot-two --offline
DSH Plugin Effect Lab: FAIL  (1.1s, no boot)
[FAIL] plugin-precheck: 4 blocker(s)
```

Per-plugin findings (`plugin-validation.json`):

```text
[blocker] duplicate-slot-registration-id (slot-registration)
[blocker] duplicate-tool-name (tool)
[info]    shared-slot-key (slot-key)
```

No `duplicate-loader-id` finding, because the two loader ids differ. That is the
namespace separation the acceptance asks for.

Runtime proof - `artifacts/20261004T142048Z-14d589/`:

```text
node bin/lab.js verify --plugin ./fixtures/plugins/dup-slot-one --offline \
  --assert-token --lab-dup-slot
[PASS] token:--lab-dup-slot: one
[PASS] dom-slots: 39 data-slot node(s)
[PASS] console-errors: 0 console error(s)
```

The token is written by the fixture's client half, so the slot-registration
plugin really executed in the browser.

## Case D: theme conflicts

### What was added

- The DOM probe now records `layers` (positioned elements with an explicit
  `z-index`, lowest first) and `layerSummary`, so background-layer stacking is
  machine-readable.
- `src/effect-classifier.js` classifies every non-baseline run as
  `high-conflict`, `manual-review`, or `coexist`, using absolute values so
  "same key, different value" is a collision and "same key, same value" is not.
- `matrix-runner` now diffs layers and attaches the classification to
  `matrix.json` / `matrix.md`; the CLI prints `[CLASS]` lines.
- `fixtures/matrix/theme-conflict.json` covers
  `wallpaper-only` / `+ui-tweaks` / `+dream-skin` / `+bloom`.

### Evidence

`artifacts/matrix-20261004T142418Z-e7ffd4/`:

```text
node bin/lab.js matrix --config ./fixtures/matrix/theme-conflict.json --online
[PASS] wallpaper-only
[PASS] wallpaper-ui-tweaks
[PASS] wallpaper-dream-skin
[PASS] wallpaper-bloom
[CLASS] coexist: wallpaper-ui-tweaks
[CLASS] high-conflict: wallpaper-dream-skin, wallpaper-bloom
```

Packages: `dsh-plugin-wallpaper-engine@1.2.0`, `dsh-ui-tweaks@0.20.0`,
`dsh-dream-skin@9.29.0`, `dsh-bloom-theme@0.17.2`.

| run | slots | token changes vs wallpaper | body attributes added | layer summary |
|---|---|---|---|---|
| wallpaper-only (baseline) | 39 | - | - | count 6, min -2, max 1000 |
| wallpaper-ui-tweaks | 37 | 0 | none | count 6, min -2, max 1000 |
| wallpaper-dream-skin | 39 | 39 | none | count 7, min -2, max 1000 |
| wallpaper-bloom | 39 | 85 | `data-bloom-variant` | count 8, min -2, max 99999 |

Background layer z-index evidence (all runs):

```text
#dsh-wallpaper-engine-layer  z-index -2  position fixed
#dsh-wallpaper-engine-scrim  z-index -1  position fixed
```

Dream-skin adds its own background `div` at `z-index -1`; bloom adds
`div.dsh-bloom-switcher` (9999) and `div.dsh-bloom-menu` (99999).

### Conflict

`wallpaper-dream-skin` and `wallpaper-bloom` both re-style the same 28
`--dsw-*` tokens with different values, so both are `high-conflict`. Examples:

```text
--dsw-alias-label-primary      dream-skin=#f3f0fb   bloom=oklch(96% 0.01 240)
--dsw-alias-brand-primary      dream-skin=#8b7cf6   bloom=oklch(72% 0.12 240)
--dsw-alias-bg-overlay         dream-skin=rgba(18,16,26,0.6)  bloom=oklch(34% 0.02 240)
```

`wallpaper-ui-tweaks` changes nothing on the theme axes and is `coexist`.
`manual-review` is empty in this matrix because no run changed theme values
without also colliding; the classifier's manual-review path is unit-tested.

A benign `Failed to load resource: 404` console entry from bloom is recorded as
a note, not a conflict.

## Bugs found and fixed while running C/D

1. `--assert-token --dsw-alias-bg-base` was rejected by the CLI parser because
   the value itself starts with `--`. Token-shaped values that are not CLI flags
   are now accepted.
2. `<command> --help` started a real run instead of printing help.
3. `dsh-dream-skin`'s peer range `>=0.1.0-rc.6 <0.3.0-0` was reported as six
   `peer-incompatible` **blockers**. Strict semver rejects `0.2.0-rc.2` there,
   but the range is explicitly prerelease-aware, and the plugin boots. Such
   ranges now produce a `peer-prerelease-range` **warning**; a plain
   non-prerelease upper bound like `<0.2.0` still blocks.
4. The classifier treated any failed check or console entry as a conflict; it
   now keys on whether the run produced a DOM and reports check/console
   problems as notes.

## Still open

- Case E (no-model mode) and Case F (explicit no-residue assertions) are not
  separately documented.
- `src/dom-assertions.js` and `src/cleanup.js` from the task-book layout still
  do not exist as separate modules.
