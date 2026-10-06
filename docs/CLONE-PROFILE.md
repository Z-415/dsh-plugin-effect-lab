# Clone a real DSH profile

`lab verify --clone-profile web|desktop` starts from the user's real profile
instead of the minimal template, so a plugin can be tested against something
close to the environment it will actually run in.

```powershell
node bin/lab.js verify --clone-profile web --no-fixture
node bin/lab.js verify --clone-profile desktop --no-fixture
node bin/lab.js verify --clone-profile web --clone-plugins none --no-fixture
node bin/lab.js verify --clone-profile web --clone-exclude dsh-better-sidebar --no-fixture
node bin/lab.js verify --clone-profile web --clone-drop-local --no-fixture
```

`--clone-profile` is supported by `lab verify` / `lab capture`. `lab shell`
keeps its own runner and rejects the flag with a readable error.

## One-shot vs persistent

There are two ways to use a clone. The difference is whether it lands in an
isolated temp home or in `.lab-profiles/`.

| goal | command |
|---|---|
| temporary clone, deleted when the run ends | `lab verify --clone-profile web --no-fixture` |
| persistent clone, visible and reusable | `lab verify --profile-lab clone-web --clone-profile web --no-fixture` |
| same, with sugar | `lab verify --clone-to clone-web --clone-profile web --no-fixture` |
| overwrite an existing target | add `--force` |

**Persistent** means `--profile-lab <name>` (or `--clone-to <name>`, which is
exactly `--profile-lab <name> --clone-profile <kind>`). The clone is written to
`.lab-profiles/<name>/` and stays after the run:

```text
$ node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture
[通过] clone-source: cloned real web profile structure: 5 file(s), 0 patch(es)
[通过] clone-real-profile-unchanged: ... source hash ... unchanged
[通过] clone-no-credentials: cloned home has no credential file or inline API key
[通过] real-home-unchanged: all structural hashes unchanged
DSH 插件效果实验舱: 通过

$ node bin/lab.js profile list
- clone-web: cloned from web (5 file(s)), no plugins recorded

$ node bin/lab.js shell --profile-lab clone-web --show --show-hold 3000
```

`lab-profile.json` records the source so it is recognizable later:

```json
{
  "name": "clone-web",
  "plugins": [],
  "clonedFrom": {
    "kind": "web",
    "at": "2026-10-06T...",
    "sourceHash": "2D5846D10F08",
    "copiedFiles": 5,
    "excluded": ["dsh-better-sidebar@0.19.1", "..."],
    "plugins": "none"
  }
}
```

`lab profile list` (text and `--json`), the GUI drawer row, and `report.md`
(**真实 profile 克隆**) all show it. The GUI drawer's **克隆为持久 profile**
button runs the same `--clone-to` command.

Rules for a persistent target:

- an existing `lab profile` target is **refused** by default with a message
  telling you to pass `--force`; `--force` removes it with the junction-safe
  `removeTreeSafely` and clones fresh;
- `--clone-to X --profile-lab Y` with `X != Y` is an error;
- `--clone-to` still needs `--clone-profile web|desktop` to say where to
  clone from.

**Temporary** means no `--profile-lab` / `--clone-to`. The clone is created in
the throwaway isolated home and deleted at the end; the run prints:

```text
[提示] 本次克隆是临时的，已随隔离 home 删除；想保留请加 --profile-lab <名字>（或 --clone-to <名字>）。
```

The GUI labels the temporary action **克隆为一次性运行（跑完即删）** so the two
are not confused.

`lab real-profiles [--json]` lists the read-only clone sources discovered under
`<real home>\profiles\*` (only directories containing `package.json`;
`node_modules` is filtered out; only the `web`/`desktop` kinds the cloner
accepts are listed). The GUI uses it to fill the clone-source dropdown. Real
profiles are **read-only**: the lab never offers delete, uninstall, or any
write action for them.

## What is copied

Only structural files under `<real home>\profiles\<web|desktop>`:

```text
package.json
cordis.yml
cordis.patch.yml
pnpm-workspace.yaml
pnpm-lock.yaml
compatibility.json    (exact-version peer exemptions, when present)
patches/**            (regular files only; symlinks are skipped)
```

Never copied, never read, never walked:

```text
node_modules/         rebuilt with the official runtime's pnpm instead
sessions/
agents/
.credentials.yaml
settings.yaml
```

The module only iterates the allowlist above; it never walks the profile root,
so a forbidden file cannot be picked up by a broad recursive copy. After
copying, `clone-no-credentials` runs `scanForCredentials()` over the isolated
home.

## Hard safety assertions

- `clone-real-profile-unchanged`: the allowlisted real files (and `patches/`)
  are SHA-256 hashed before and after the copy. A difference aborts the clone.
- `real-home-unchanged`: the existing before/after hash guard still runs at the
  end of the whole run.
- `clone-no-credentials`: the isolated home must contain no credential file and
  no inline API key.
- `forbiddenEntries`: `node_modules`, `sessions`, `agents`,
  `.credentials.yaml`, and `settings.yaml` must not exist in the clone target.
  A leaked entry aborts the clone.
- Cloning is refused when the target is inside the real home or already has a
  `package.json`.

## Rebuilding node_modules

The copied `pnpm-lock.yaml` is used to rebuild the tree offline:

```text
dsh plugin --profile <profileName> install --offline --no-frozen-lockfile
```

The run is executed with the isolated `DSH_HOME` and `cwd = <clone profile>`.
Afterwards every dependency is checked for a real
`node_modules/<name>/package.json`.

## Cloning the real plugins (the default)

The point of a clone is to start from the plugins the user actually runs, so
`--clone-plugins` defaults to `all`: every third-party dependency in the real
profile is installed into the clone.

DSH refuses to *approve* a plugin whose peer range does not match the current
runtime (`Plugin name@version is incompatible with dsh ...`). With the real web
profile that is 6 of 20 plugins. The lab now:

- copies `compatibility.json` (if the real profile has one), so existing
  exact-version exemptions carry over;
- installs every dependency anyway: `clone-install` passes when all packages
  are present, and `missing` is the hard failure;
- lists the denied plugins under `clone-compat` (informational);
- with `--clone-accept-risk`, runs
  `dsh plugin --profile <clone> allow-version <name>@<version> --dsh-version <runtime> --accept-risk`
  **inside the clone** for each denied plugin, then re-runs the install so the
  gate approves and the plugins actually load. The real profile is untouched.
- a package that is not in the pnpm offline store needs the explicit `--online`
  opt-in; without it the dependency is reported as `missing` (a real install
  failure). The desktop profile needs this for at least one registry tarball.
- cross-plugin slot/tool conflicts found in a cloned profile are reported as
  **informational** (`plugin-profile-audit`), because they are pre-existing in
  the real profile the user started from.

```powershell
# full clone: 20 plugins installed, 6 exemptions granted in the clone
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-accept-risk --no-fixture
# -> [通过] clone-install: pnpm/DSH exit 0; 20 present, 0 missing
# -> [通过] clone-compat: no incompatible plugin was denied by DSH
# -> [通过] clone-exemptions: granted 6 exact-version exemption(s) inside the clone

# desktop has a registry tarball missing from the offline store
node bin/lab.js verify --clone-to clone-desktop --clone-profile desktop --clone-accept-risk --online --no-fixture
# -> [通过] clone-install: pnpm/DSH exit 0; 26 present, 0 missing
```

Without `--clone-accept-risk` the plugins are still installed and the clone is
still created; the denied ones are listed and stay denied at startup until you
grant them (in the clone) with `dsh plugin --profile <clone> allow-version`.

## Expected failures (reported, not hidden)

A clone is not guaranteed to boot. The real desktop profile has ~25
third-party plugins; peers may disagree with 0.2.0-rc.2, a tarball may be
missing, or the installation may need the network. The lab reports:

- `clone-install`: the pnpm/DSH exit code, `installed` and `missing` counts;
- `clone-plugins-present`: every dependency that has no installed manifest;
- `clone-compat`: the plugins DSH denied by peer range, parsed from the install
  output (`Plugin <name>@<version> is incompatible ...`);
- `clone-exemptions`: with `--clone-accept-risk`, which exact-version
  exemptions were granted (and which failed) inside the clone.

`report.json` stores the same evidence under `clone`:

```text
clone = {
  kind, sourceDir, sourceSnapshot: { hash, files },
  copiedFiles, copiedPatches,
  plugins: 'all' | 'none',
  excluded: [{ name, spec, reason }],
  droppedLocal: [{ name, spec }],
  localPlugins: [{ name, spec, kind: 'file' | 'link' | 'path' }],
  incompatibleBefore: [{ name, version }],
  install: { ok, code, installed, missing, rejected, incompatible },
  exemptions: { granted: [{ name, version }], failures: [{ name, version, reason }] }
}
```

`report.md` renders it under **真实 profile 克隆**. `clone-install.log` keeps
the full pnpm/DSH output next to `report.json`.

## Degrading a clone

| flag | effect |
|---|---|
| `--clone-plugins all` | default: keep every real third-party plugin |
| `--clone-accept-risk` | grant the exact-version exemptions DSH asks for **inside the clone**, then re-install, so peer-mismatched real plugins load |
| `--clone-plugins none` | drop every third-party dependency and trim `dsh.profile.bundles` to the first-party bundles |
| `--clone-exclude <plugin>` | drop one dependency by package name or exact spec |
| `--clone-drop-local` | drop `file:` / `link:` / path dependencies that would otherwise point at the real plugins directory |

Without `--clone-drop-local`, a `file:`/`link:` dependency is kept as a
read-only reference to the real path (the lab never copies
`~/.dsh/plugins`). It is listed under `localPlugins` in the report.

Repeated `--clone-exclude` is supported. `--clone-exclude` and
`--clone-plugins none` also trim the matching entries from
`dsh.profile.bundles`; `cordis.patch.yml` is copied verbatim (read-only
snapshot) and is never written back to the real profile.
