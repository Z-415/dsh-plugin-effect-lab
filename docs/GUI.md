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

## Layout

Three groups, in this order:

1. **插件 / 持久 profile** — the main group: plugin field, profile dropdown,
   and every plugin-related action (verify, open the shell window, uninstall,
   list, two plugins together, desktop-mode switches).
2. **检查** — `doctor`, the plain `verify` presets, and the failure-signature
   tools.
3. **清理** — dry-run and clean of the leaked temp directories.

Below the groups: the result banner, the always-visible log pane, and the
footer (open report / open artifacts / abort).

## What the buttons do

| Group | Button | Command |
|---|---|---|
| 插件 / 持久 profile | 验证这个插件（出报告截图） | `verify --screenshot home --screenshot settings [--plugin <spec>] [--profile-lab <name>]` |
| 插件 / 持久 profile | 在壳窗口打开（自己关） | `shell --no-compare-web [--plugin <spec>] [--profile-lab <name>] --keep-open` |
| 插件 / 持久 profile | 在壳窗口打开（20 秒） | `shell --no-compare-web [--plugin <spec>] … --show --show-hold 20000` |
| 插件 / 持久 profile | 壳 vs web 对比 | `shell [--plugin <spec>] [--profile-lab <name>]` |
| 插件 / 持久 profile | 再加一个插件一起验证 | `shell --plugin A --with B --show --show-hold 20000` |
| 插件 / 持久 profile | 卸载这个插件 | `profile remove-plugin <name> <spec>` |
| 插件 / 持久 profile | 列出 profile | `profile list`, then refresh the dropdown |
| 插件 / 持久 profile | 刷新 | re-read `.lab-profiles` for the dropdown |
| 检查 | 自检 doctor | `doctor` |
| 检查 | 快速验证 | `verify` |
| 检查 | 验证 + 设置页截图 | `verify --screenshot home --screenshot settings` |
| 检查 | 空会话 / 长会话 | `verify --fixture-variant empty\|long` |
| 检查 | 失败签名库 | `scan --list` |
| 检查 | 扫描最近一次日志 | `scan --latest` |
| 清理 | 查看残留（不改动） | `clean --dry-run`（残留目录 + 游离的 lab 进程） |
| 清理 | 清理残留临时目录 | `clean`（先回收游离进程，再删目录） |

The three shell-window buttons also append `--native-desktop` /
`--probe-native-dialog` when the matching checkboxes are ticked (see below).

Footer buttons open the newest `report.html` / `matrix.html` in your default
browser, or the `artifacts/` folder. **中止** kills the running child tree.

## 插件 + profile 怎么填

- **插件**（文本框）：`dsh-plugin-x@1.2.3`，或本地目录 / `.tgz` 路径。本地路径自动
  用 `--offline`，包名自动用 `--online`。**留空** = 这次不装新插件，只用 profile 里
  已经装好的（或一次性的空环境）。
- **profile**（下拉框）：
  - `一次性运行（跑完删除）`（默认）：临时隔离环境，跑完删掉，不留东西；
  - 选已有的 profile（例如 `dev（dsh-plugin-wallpaper-engine@1.2.0, dsh-ui-tweaks@0.20.0）`）：
    复用 `.lab-profiles/<name>/`，里面已装的插件会一起加载，跑完保留；
  - `新建 profile…`：旁边出现一个名字输入框，填名字后第一次运行会创建它；
  - **刷新** 重新读取 `.lab-profiles` 目录；跑完任何命令也会自动刷新。

只要 profile 下拉选了已有项，顶部按钮就会自动带上 `--profile-lab <name>`。

## 卸载单个插件（鼠标操作）

1. **profile 下拉**选要操作的持久 profile（例如 `dev`）。
2. **插件**框填要卸载的插件名或 spec（`dsh-ui-tweaks`、`dsh-ui-tweaks@0.20.0`、
   或当初装的本地路径都行）。
3. 点 **卸载这个插件**。

只会卸掉这一个插件，profile 和其余插件保留；日志会打印 `removed …` 和
`still installed …`。没匹配到会提示 `unmatched` 并以退出码 1 结束。选「一次性运行」
时不能卸载（没有可卸载的对象），按钮会直接提示。

## 原生桌面开关

第一组底部有两个复选框，作用于三个「壳窗口」按钮：

| 勾选 | 效果 |
|---|---|
| 都不勾（默认） | 确定性桩：目录选择返回夹具路径、通知只记录不弹系统提示，适合反复跑 |
| 原生桌面：真实文件夹对话框 + 系统通知 | 走真实 Electron `dialog` / `Notification`；系统通知会自动弹出并断言 |
| 再勾「启动时弹出文件夹对话框」 | 运行过程中真的弹出选择目录对话框，窗口会等你选一个目录或点**取消**，然后继续跑完 |

注意：真实对话框是模态的，会自动把窗口显示出来。选完（或取消）才会继续；若长时间不点，
整轮会在壳的超时时间（默认 120 秒）后结束。报告里会看到 `shell-native-dialog` 一行，
写明你选了什么或是否取消。

## 运行输出去哪看

窗口下半部分是**常驻日志区**：命令的 stdout/stderr 实时流进来，跑完自动滚到最新。
上方按钮区放不下时会自己滚动，不会再把日志区挤没（日志区固定至少 220px）。

命令结束时还有两道提示，不用去翻报告：

- **窗口内横幅**：绿=完成、红=失败，写明「命令 · 退出码 · 用时」；成功的 8 秒后自动
  消失，失败的会一直留着直到下一次运行。
- **系统通知**：失败、或运行超过 5 秒的命令，会再弹一条 Windows 通知，切到别的窗口
  也能看到结果（成功且很快的命令只闪横幅，避免刷屏）。

要完整证据再点 **打开最新 HTML 报告**；原始日志也会写入
`gui-runtime/gui-<version>/userdata/gui.log`。

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
