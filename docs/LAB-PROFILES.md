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
node bin/lab.js profile list          # name + recorded plugin specs
node bin/lab.js profile create dev    # just the skeleton
node bin/lab.js profile path dev
node bin/lab.js profile remove dev    # delete the whole profile
```

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
