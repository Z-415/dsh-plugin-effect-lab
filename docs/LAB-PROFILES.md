# Persistent lab profiles (multi-plugin work)

By default every run is one-shot: an isolated `DSH_HOME` under `%TEMP%`, the
plugins installed into it, then the whole thing is deleted. That is the safest
default, but it makes it impossible to "install once, look later" or to study
how plugins affect each other over several steps.

`--profile-lab <name>` switches to a **persistent** lab profile.

```text
<project>\.lab-profiles\<name>\
  home\          DSH_HOME
  home\profiles\lab-<name>\   the DSH profile (dependencies + bundle order)
  agents\        DSH_AGENTS_HOME
  tmp\
  lab-profile.json            { name, createdAt, plugins: [{ spec, addedAt }] }
```

It is still fully isolated: the real `~/.dsh` is never a target
(`real-home-unchanged` still runs), and `.lab-profiles/` is git-ignored.

## Install once, open later

```powershell
# 1) install a plugin into the "dev" profile (created on first use)
node bin/lab.js shell --profile-lab dev --plugin dsh-plugin-wallpaper-engine@1.2.0 --online `
  --no-compare-web --show --keep-open

# 2) later, with no --plugin at all: the plugin is still installed
node bin/lab.js shell --profile-lab dev --no-compare-web --show --keep-open
```

`cleanup-home` reports `kept lab profile "dev"` instead of a deletion.

## Add a second plugin and check the interaction

```powershell
node bin/lab.js shell --profile-lab dev --plugin dsh-ui-tweaks@0.20.0 --online --no-compare-web
```

Adding a plugin audits **the whole profile**, not just the new spec, so a
combination that only breaks when A and B are both present is reported:

```text
[PASS] plugin-postcheck: installed manifests are compatible
[FAIL] plugin-profile-audit: duplicate-slot-registration-id:conversation.composer.dock#lab-dup-decoration, duplicate-tool-name:lab_dup_tool, shared-slot-key:conversation.composer.dock
```

The same audit surfaces in `report.json` as `profileAudit = { names, conflicts }`
and in each plugin's findings marked `[profile]`.

## Managing profiles

```powershell
node bin/lab.js profile list                        # name + recorded plugin specs
node bin/lab.js profile create dev                  # just the skeleton
node bin/lab.js profile path dev
node bin/lab.js profile remove-plugin dev B@2       # uninstall one plugin
node bin/lab.js profile remove dev                  # delete the whole profile
```

`lab profile list --json` returns `name` / `dir` / `plugins[]` /
`createdAt` / `mtimeMs` plus `nodeModulesExists`, `dependenciesCount`,
`bundlesCount`, and `lastRunAt` (the DSH profile directory's mtime). The
desktop launcher renders the same payload as a profile drawer with inline
open / clone-one-shot / uninstall / open-directory / delete actions; see
[GUI.md](GUI.md).

## Uninstall a single plugin

`remove-plugin` keeps the profile and every other installed plugin, which is the
point of a persistent profile: add A and B, then drop B and reopen A.

```powershell
node bin/lab.js profile remove-plugin dev dsh-ui-tweaks          # by name
node bin/lab.js profile remove-plugin dev dsh-ui-tweaks@0.20.0   # by name@version
node bin/lab.js profile remove-plugin dev .\my-plugin            # by the recorded spec
```

A selector may be the bare package name, `name@version`, or the exact spec shown
by `profile list`. The command:

1. runs `dsh plugin remove` in the profile (pnpm drops the dependency);
2. trims that package from `dsh.profile.bundles`, so the profile still validates;
3. unlinks any leftover `link:`/`file:` junction in `node_modules` with an
   `lstat`-based removal that never follows the link into the plugin source;
4. drops the recorded spec from `lab-profile.json`.

Selectors that are not installed are reported and make the command exit 1; a
fully unmatched invocation never starts the runtime.

`profile remove` deletes entry by entry with the `lstat`-based
`removeTreeSafely`, so a `file:`/`link:` junction in `node_modules` is
unlinked instead of followed into the plugin source. A profile locked by a
running lab process returns a readable error and exit 1.

Delete `.lab-profiles/` by hand to clear everything.

## Multi-plugin in one run

You do not need a persistent profile to test several plugins at once:

```powershell
node bin/lab.js verify --plugin A@1 --with B@2 --online
node bin/lab.js shell --profile-lab dev --plugin A@1 --with B@2 --online
```

`matrix --config` still runs each combination in a fresh one-shot environment,
which is the right tool when you want comparable per-plugin DOM/token/screenshot
diffs.

## Plugin sources and the real package name

`--plugin` / `--with` accept more than a bare registry name:

| form | example | network |
|---|---|---|
| npm name | `dsh-plugin-x@1.2.3` | `--online` |
| explicit npm prefix | `npm:dsh-plugin-x@1.2.3` | `--online` |
| GitHub shorthand | `github:owner/repo#v1.2.3` | `--online` |
| GitHub URL | `https://github.com/owner/repo#main` | `--online` |
| local directory | `.\my-plugin` | `--offline` |
| tarball | `.\my-plugin-1.0.0.tgz` | `--offline` |

`npm:` is stripped before the spec reaches pnpm, and the `#ref` on a GitHub
source is passed through untouched so pnpm can resolve the branch, tag, or
commit.

After a successful install the lab reads the package back from the isolated
profile's `dependencies` + `node_modules/<name>/package.json` and records the
real name. This is what makes an advertised name that differs from the real
package name visible:

```text
[插件] github:author/claimed-name#v2 -> dsh-real-name@2.3.4 (github)
```

`report.json` carries the same mapping in `plugins[]`:
`advertisedSpec`, `resolvedName`, `resolvedVersion`, `resolvedSpec`
(`name@version`), `source` (`npm` / `github` / `directory` / `tarball`), and
`spec`. `report.md` renders it under **插件来源与真实包名**.

A GitHub source that cannot be reached offline is reported as a failed install
with the plugin list empty; the lab does not retry-online silently.

## Starting from the real profile

`lab verify --clone-profile web|desktop` starts from the user's real profile
structure (never `node_modules`, credentials, settings, sessions, or agents)
and rebuilds `node_modules` offline. See
[CLONE-PROFILE.md](CLONE-PROFILE.md) for the allowlist, the hard before/after
hash assertions, and the `--clone-plugins none` / `--clone-exclude` /
`--clone-drop-local` degradation flags.
