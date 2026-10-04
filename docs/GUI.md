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
0.2.0-rc.2) into:

```text
%LOCALAPPDATA%\dsh-plugin-effect-lab\gui-<electron-version>\
  DSH Plugin Effect Lab.exe      <- renamed copy of the official Electron exe
  resources\app\{main.js,preload.js,index.html}
  userdata\gui-config.json
  userdata\gui.log
```

The official install (`D:\DeepSeek Harness`) is only read. Set
`DSH_LAB_GUI_HOME` to relocate the copied runtime.

## What the buttons do

Every button spawns the same `bin/lab.js` command the CLI exposes, streams its
output into the log pane, and never bypasses the lab's isolation rules.

| Group | Button | Command |
|---|---|---|
| 检查 | 自检 doctor | `doctor` |
| 检查 | 快速验证 | `verify` |
| 检查 | 验证 + 设置页截图 | `verify --screenshot home --screenshot settings` |
| 检查 | 空会话 / 长会话 | `verify --fixture-variant empty\|long` |
| Electron 壳 | 打开壳窗口（20 秒） | `shell --no-compare-web --show --show-hold 20000` |
| Electron 壳 | 打开壳窗口（自己关） | `shell --no-compare-web --keep-open` |
| Electron 壳 | 壳 vs web 对比 | `shell` |
| 插件与主题 | 验证 wallpaper 插件 | `verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online` |
| 插件与主题 | 主题冲突矩阵 | `matrix --config fixtures/matrix/theme-conflict.json --online` |
| 插件与主题 | 效果探针矩阵 | `matrix --config fixtures/matrix/effect-conflict.json` |

Footer buttons open the newest `report.html` / `matrix.html` in your default
browser, or the `artifacts/` folder. **中止** kills the running child tree.

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
