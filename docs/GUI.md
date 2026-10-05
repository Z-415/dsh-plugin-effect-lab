# Desktop GUI launcher

The lab is CLI-first, but there is a double-clickable desktop launcher for
mouse-driven use.

## Build and launch

```powershell
node bin/lab.js gui                     # build once, then open the window
node bin/lab.js gui --install-shortcut  # also drop a shortcut on the Desktop
node bin/lab.js gui --no-open           # build only
node bin/lab.js gui --rebuild           # copy the runtime again
```

Or double-click `启动实验台.cmd` in the project root, which runs the same
command.

The first build copies the official Electron runtime (about 346 MB on
0.2.0-rc.2) into the project:

```text
<project>\gui-runtime\gui-<electron-version>\
  DSH Plugin Effect Lab.exe      <- renamed copy of the official Electron exe
  resources\app\{main.js,preload.js,index.html,gui-config.json}
  userdata\gui-config.json
  userdata\gui.log
```

`gui-runtime/` is git-ignored. The official install (`D:\DeepSeek Harness`) is
only read. Set `DSH_LAB_GUI_HOME` to relocate the copied runtime.

## Troubleshooting

**"A JavaScript error occurred in the main process ... Received undefined" on
double-click.** The launcher needs `gui-config.json`. It reads
`DSH_LAB_GUI_CONFIG` when started by `lab gui`, and otherwise falls back to the
copy next to `main.js`. Run `node bin/lab.js gui` once from the project to write
it, then the shortcut works.

**The shortcut points into an app's private data.** Build the GUI from a normal
terminal. Inside a packaged host (for example the Codex desktop app),
`%LOCALAPPDATA%` is redirected into that package's sandbox, so an earlier
version of this launcher could create the runtime in
`...\Packages\<app>\LocalCache\Local\...`. The runtime now defaults to the
project directory precisely to avoid that; `gui-runtime/` must be readable by
your normal user account.

## What the buttons do

Every button spawns the same `bin/lab.js` command the CLI exposes, streams its
output into the log pane, and never bypasses the lab's isolation rules.

| Group | Button | Command |
|---|---|---|
| 自定义插件 / 持久 profile | 验证这个插件 | `verify --plugin <spec> [--profile-lab <name>] …` |
| 自定义插件 / 持久 profile | 在壳窗口打开（自己关） | `shell --no-compare-web --plugin <spec> --keep-open` |
| 自定义插件 / 持久 profile | 在壳窗口打开（20 秒） | `shell --no-compare-web --plugin <spec> --show --show-hold 20000` |
| 自定义插件 / 持久 profile | 和另一个插件一起验证 | `shell --plugin A --with B --show …` |
| 自定义插件 / 持久 profile | 列出 profile | `profile list` |
| 自定义插件 / 持久 profile | 卸载 profile 里的这个插件 | `profile remove-plugin <name> <spec>` |
| 检查 | 自检 doctor | `doctor` |
| 检查 | 快速验证 | `verify` |
| 检查 | 验证 + 设置页截图 | `verify --screenshot home --screenshot settings` |
| 检查 | 空会话 / 长会话 | `verify --fixture-variant empty\|long` |
| 检查 | 查看失败签名库 | `scan --list` |
| 检查 | 扫描最近一次运行的日志 | `scan --latest` |
| Electron 壳 | 打开壳窗口（20 秒） | `shell --no-compare-web --show --show-hold 20000 [--native-desktop] [--probe-native-dialog]` |
| Electron 壳 | 打开壳窗口（自己关） | `shell --no-compare-web --keep-open [--native-desktop] [--probe-native-dialog]` |
| Electron 壳 | 壳 vs web 对比 | `shell [--native-desktop] [--probe-native-dialog]` |
| 插件与主题 | 验证 wallpaper 插件 | `verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online` |
| 插件与主题 | 主题冲突矩阵 | `matrix --config fixtures/matrix/theme-conflict.json --online` |
| 插件与主题 | 效果探针矩阵 | `matrix --config fixtures/matrix/effect-conflict.json` |

Footer buttons open the newest `report.html` / `matrix.html` in your default
browser, or the `artifacts/` folder. **中止** kills the running child tree.

## 运行输出去哪看

窗口下半部分是**常驻日志区**：命令的 stdout/stderr 实时流进来，跑完自动滚到最新。
上方按钮区如果放不下会自己滚动，不会再把日志区挤没（日志区固定至少 220px）。

命令结束时还有两道提示，不用去翻报告：

- **窗口内横幅**：绿=完成、红=失败，写明「命令 · 退出码 · 用时」；成功的 8 秒后自动
  消失，失败的会一直留着直到下一次运行。
- **系统通知**：失败、或运行超过 5 秒的命令，会再弹一条 Windows 通知，切到别的窗口
  也能看到结果（成功且很快的命令只闪横幅，避免刷屏）。

要完整证据再点 **打开最新 HTML 报告**；原始日志也会写入
`gui-runtime/gui-<version>/userdata/gui.log`。

The two text fields drive the custom buttons:

- **插件**: `dsh-plugin-x@1.2.3`, or a local directory / `.tgz` path. Local
  paths automatically use `--offline`; package names use `--online`.
- **profile 名**: leave empty for a one-shot run (fresh temp home, deleted
  afterwards). Fill it in to keep the isolated profile under
  `.lab-profiles/<name>/`, so the plugin stays installed and the shell window
  can be reopened later without re-installing. See
  [LAB-PROFILES.md](LAB-PROFILES.md).

## 卸载单个插件（鼠标操作）

1. **profile 名** 填要操作的持久 profile（例如 `dev`）。
2. **插件** 填要卸载的插件名或 spec（`dsh-ui-tweaks`、`dsh-ui-tweaks@0.20.0`、
   或当初装的本地路径都行）。
3. 点 **卸载 profile 里的这个插件**。

只会卸掉这一个插件，profile 和其余插件保留；日志会打印
`removed …` 和 `still installed …`。没匹配到会提示 `unmatched` 并以退出码 1 结束。
不想动真实在用的 profile，可以先点「验证这个插件」并填一个新的 profile 名来造一个。

## 原生桌面开关（Electron 壳）

「Electron 壳」这一组有两个复选框，作用于上面三个壳按钮：

| 勾选 | 效果 |
|---|---|
| 都不勾（默认） | 确定性桩：目录选择返回夹具路径、通知只记录不弹系统提示，适合反复跑 |
| 原生桌面：真实文件夹对话框 + 系统通知 | 走真实 Electron `dialog` / `Notification`；系统通知会自动弹出并断言 |
| 再勾「启动时弹出文件夹对话框」 | 运行过程中真的弹出选择目录对话框，窗口会等你选一个目录或点**取消**，然后继续跑完 |

注意：真实对话框是模态的，会自动把窗口显示出来。选完（或取消）才会继续；若长时间不点，
整轮会在壳的超时时间（默认 120 秒）后结束。报告里会看到 `shell-native-dialog` 一行，
写明你选了什么或是否取消。

## Requirements

- Windows with the official DeepSeek Harness install (the runtime source).
- The first `gui` build needs read access to `D:\DeepSeek Harness`.
- No packaging tool (electron-builder/pkg) and no extra npm dependency; the
  launcher reuses the official Electron runtime.

## Notes

- The launcher runs `lab.js` with `ELECTRON_RUN_AS_NODE=1`, so it does not need
  a separate Node.js install at runtime.
- One command runs at a time; **中止** uses `taskkill /T /F` on that child.
- Closing the window aborts any running command.
