# Architecture

## Isolation model

Every run creates `<temp>/dsh-lab-<id>/` with `home/`, `agents/`, and `tmp/`.
`DSH_HOME`, `DSH_AGENTS_HOME`, `TEMP`, and `TMP` all point inside that root.
The real `~/.dsh` is never a write target and is not used as a fallback.

The minimal profile is the official shipped `web` template:

```json
{
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
```

First-party bundles resolve from the Desktop installation anchor. Third-party
plugins are installed by the official CLI into the isolated profile and then
appended to `dsh.profile.bundles`.

## Lifecycle

`src/runner.js` owns the sequence:

```text
locate runtime
  -> hash real structural profile files
  -> create isolated home
  -> write minimal profile
  -> optional dsh plugin add
  -> official session-persistence fixture seeding (default on)
  -> dsh --profile <lab> --no-open --port 0
  -> parse dsh web: URL + token
  -> mint auth cookie, probe routes
  -> Edge headless CDP: screenshot, DOM, tokens, console
  -> stop trees, verify port free, delete temp home
  -> re-hash real files and write report
```

## Browser driver

The driver uses the locally installed Edge (`msedge.exe`) with
`--headless=new --remote-debugging-port=0`, reads `DevToolsActivePort`, and
speaks CDP over Node's built-in `WebSocket`. No Playwright/Puppeteer download is
required. `--browser <exe>` and `DSH_LAB_BROWSER` override the executable.

## Plugin validation

`plugin-resolver.js` resolves a spec without installing it. Directory and
tarball sources expose a manifest before install; npm and GitHub sources are
validated after the official CLI has installed them into the isolated profile.
`manifest-validator.js` checks engines, peer ranges, bundle patch files and ids,
`dsh.client`, `exports["./client"]`, and known 0.1.x/0.2.x API differences.
Cross-plugin duplicate loader ids are reported as blockers.

## Conflict probes

The DOM probe records `--dsw-*` / `--we-*` token values, body attributes, and
`data-slot` names. `theme-token-probe.js` and `slot-probe.js` compare candidate
runs against a baseline. `matrix-runner.js` runs a JSON list of combinations
and reports tokens or slots touched by more than one plugin.

## Loopback mock model

`mock-llm-server.js` implements an OpenAI-compatible Chat Completions endpoint
on loopback. `provider-patcher.js` points the isolated profile's `llm-pi-ai`
route at it. The runner creates a real session, selects `lab-mock/lab-mock-model`,
prompts it, and waits for `turn/end`. The first response streams a tool call; the
second response follows the tool result. No real provider or credential is used.

## Failure signatures

`src/log-scanner.js` maps boot-log fingerprints to a category, a root cause,
and a fix. Fatal signatures fail the run; peer conflicts are warnings. The
library covers seven categories (`boot`, `plugin`, `client`, `profile`, `env`,
`runtime`, `crash`); `docs/FAILURE-SIGNATURES.md` lists them and
`lab scan --list` prints them at runtime. The Node `DEP0180` `fs.Stats`
warning seen on 0.2.0-rc.2 is explicitly noise.
