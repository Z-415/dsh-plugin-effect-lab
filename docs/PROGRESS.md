# Progress protocol

`onProgress` receives a structured event instead of a free string:

```text
{ phase, index, total, label, detail, elapsedMs, phaseMs }
```

`index` / `total` count **phases**, not time. The lab never guesses a time
percentage for an unpredictable boot or install.

## The eight phases

| index | phase | label |
|---|---|---|
| 1 | `locate-runtime` | 定位 runtime |
| 2 | `snapshot` | 快照 |
| 3 | `isolated-home` | 建隔离 home |
| 4 | `install-plugins` | 安装插件 |
| 5 | `boot-host` | 启动宿主 |
| 6 | `probe-ui` | 探针/截图 |
| 7 | `cleanup` | 清理 |
| 8 | `write-report` | 写报告 |

`runLab` (verify/capture) and `runShell` both emit these phases. `progressEvent()`
is the only way to build one; an unknown phase throws so a typo cannot silently
produce a gap in the bar.

## CLI

Each event prints one text line with the step number and the phase duration:

```text
[1/8] 定位 runtime · runtime 0.2.0-rc.2 · 0.4s
[2/8] 快照 · 10 structural file(s) hashed · 0.1s
[3/8] 建隔离 home · isolated home C:\...\dsh-lab-xxxx\home · 0.6s
[5/8] 启动宿主 · isolated host booted on port 11525 · 12.4s
```

The duration is the time spent in that phase, so a slow boot shows its real
wait instead of a fabricated percentage.

## GUI

When `DSH_LAB_GUI=1`, the CLI also writes a machine line before the text line:

```text
\x1eLABPROG\x1e{"phase":"boot-host","index":5,"total":8,"label":"启动宿主","detail":"...","elapsedMs":12345,"phaseMs":1234}
```

The renderer strips those lines from the log and drives the progress bar:

- completed phases set the fill width (`(index-1)/total`);
- the in-flight phase shows an indeterminate shimmer (CSS animation), because
  boot/install time is not predictable;
- the elapsed timer (`已用 42s`) ticks every second while the run is active;
- `--keep-open` stays in the running state until the Electron window is closed
  and the child process really exits, so it never looks "done" while waiting
  for the user.

The animation lives only in the renderer; the lab main flow never blocks on it.
