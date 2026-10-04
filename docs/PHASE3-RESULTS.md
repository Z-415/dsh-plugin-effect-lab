# Phase 3 Results

All runs below used an isolated `DSH_HOME`, the official
`0.2.0-rc.2` runtime, and no real profile or credential.

## Loopback mock model

`verify --mock-model` completed a real streamed turn:

- provider/model: `lab-mock/lab-mock-model`
- requests: 3 (tool call, title request, post-tool completion)
- event types included: `assistant/message`, `tool/call`, `todo/write`,
  `tool/result`, `turn/end`
- no external provider request and no real API key

Artifact example: `artifacts/20261004T104719Z-cc6066/mock-llm.json`.

## Wallpaper plugin

`dsh-plugin-wallpaper-engine@1.2.0` installed from npm into the isolated
profile and booted cleanly:

- `GET /wallpaper-engine/inventory` returned `200`
- `data-slot` count grew from 24 to 39
- `--dsw-alias-bg-base` became `transparent`
- no console errors, no fatal signatures
- cleanup removed the temp home and all ports

Artifact example: `artifacts/20261004T105136Z-7168c2`.

## Wallpaper + ui-tweaks

`dsh-plugin-wallpaper-engine@1.2.0` plus `dsh-ui-tweaks@0.20.0`:

- both installed and booted cleanly
- wallpaper route still returned `200`
- `data-slot` count stayed 39
- `--dsw-alias-bg-base` stayed `transparent`
- a DOM/token diff against wallpaper-only found no additional ui-tweaks
  change in the default configuration
- no console errors

Artifact example: `artifacts/20261004T105209Z-23e316`.

The absence of an out-of-box ui-tweaks effect is a measured result, not a
failure. Configure ui-tweaks explicitly if a specific effect is under test.

## Effect conflict matrix

The local client-half probes confirm conflict detection:

- `effect-ok.json`: baseline + one probe passes
- `effect-conflict.json`: two probes touching `--lab-effect-probe-color`
  are reported as a token conflict

Matrix artifacts: `artifacts/matrix-*/matrix.json` and `matrix.md`.
