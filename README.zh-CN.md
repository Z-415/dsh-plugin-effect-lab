# DSH 插件效果实验舱

面向官方 DeepSeek Harness 桌面版运行时 `0.2.0-rc.2` 的插件兼容性与效果隔离验证工具。

[English](README.md) | **简体中文**

> 接手继续开发请看 [docs/HANDOFF-20261005.md](docs/HANDOFF-20261005.md)
> 官方 DSH 升级后怎么适配请看 [docs/VERSION-POLICY.md](docs/VERSION-POLICY.md)
> （状态、命令、代码地图、踩过的坑、检查清单）。

## 桌面 GUI

```powershell
node bin/lab.js gui                     # 首次构建，然后打开启动器
node bin/lab.js gui --install-shortcut  # 同时在桌面创建快捷方式
```

也可以双击 `启动实验台.cmd`。启动器是一个普通 Windows 窗口，按钮包括
自检 / 快速验证 / 设置页 / 空会话 / 长会话 / 壳窗口 / 插件 / 主题矩阵 / 清理，
带一个实时日志面板，以及"在浏览器打开最新 report.html / artifacts 目录"的按钮。
它复用官方 Electron 运行时（不需要打包工具、不引入额外依赖），每个按钮执行的都是
CLI 里同一条 `lab.js` 命令。详见 [docs/GUI.md](docs/GUI.md)。

第 1 阶段是最小闭环：

1. 定位官方 `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`；
2. 在系统临时目录下创建短生命周期的隔离 `DSH_HOME`；
3. 写入官方自带的最小 `web` profile（空依赖，加 `@deepseek-ai/dsh-base` 与
   `@deepseek-ai/dsh-web-app`）；
4. 启动 `dsh web --no-open --port 0`，解析真实端口与启动 token；
5. 用 CDP 在无头 Edge 中打开界面并保存截图；
6. 采集启动日志、控制台错误、页面错误与宿主路由状态；
7. 结束进程树、确认端口已释放、删除临时 home；
8. 对比运行前后真实 profile 结构文件的 SHA-256。

第 2 阶段增加：

- npm、本地目录、tarball、GitHub 四种插件来源解析；
- engines、peers、bundle patch、client 声明与已知不兼容 API 的 manifest 校验；
- 包含 user、assistant、tool 事件的官方固定会话夹具；
- 真实的 client 半区效果探针与 token / body 属性冲突检测；
- 面向插件组合的 JSON 矩阵运行器。

第 3 阶段增加：

- 回环的 OpenAI 兼容 mock provider（`--mock-model`）；
- 一个真实的流式 agent 回合，带脚本化 tool call 与 `tool/result`；
- 该回合不访问外网、不需要真实 API key。
- 显式的插件路由探测 `--route /plugin/health`；
- 已验证的隔离运行：`dsh-plugin-wallpaper-engine@1.2.0`，以及
  `dsh-plugin-wallpaper-engine@1.2.0 + dsh-ui-tweaks@0.20.0`。

第 4 阶段增加：

- 最小 Electron 启动器：把官方 Electron 运行时（只读来源）复制进临时 app 目录；
- 桌面启动桥（`dshDesktopBoot` -> `__DSH_TRANSPORT__`），让打包后的前端连到隔离宿主；
- `ws://127.0.0.1/*` 头部栅栏：把渲染进程的启动 cookie 转发给宿主的 Remote-stream socket；
- 壳与 web 的 DOM / body 属性 / `--dsw-*` token 差异，外加桌面专属属性检测。

第 4 阶段的实测结果在 [docs/PHASE4-RESULTS.md](docs/PHASE4-RESULTS.md)。

验收 C（重复 slot id）与 D（主题冲突）已实现并实测：[docs/ACCEPTANCE-C-D-RESULTS.md](docs/ACCEPTANCE-C-D-RESULTS.md)。
重复 id 会按命名空间（`loader` / `slot-registration` / `slot-key` / `tool`）报告，
`matrix` 把主题组合分类为 `high-conflict` / `manual-review` / `coexist`。

验收 E（无模型模式）与 F（无残留）见 [docs/ACCEPTANCE-E-F-RESULTS.md](docs/ACCEPTANCE-E-F-RESULTS.md)。
每次运行都会记录 `agentCoverage`、扫描隔离 home 中是否存在凭据，并给出
`cleanup-no-residue` 检查。

第 5 阶段稳定性（长路径、进程泄漏、端口竞争、故障注入）见
[docs/PHASE5-RESULTS.md](docs/PHASE5-RESULTS.md)。
DOM 断言 DSL 位于 `src/dom-assertions.js`，由 `--assert-token`、`--assert-slot`、
`--assert-body-attr`、`--min-slots` 驱动。

壳模式也会安装插件（`lab shell --plugin <spec>`），并对 web 基线与壳做 DOM/token
差异和像素差异对比（`dom/shell-screenshot-diff.json`）。在未修改的 profile 上，
两张截图像素级一致。

会话夹具是提交入库的数据（`fixtures/web-session/`），有 `default`、`empty`、`long`
三种变体，用 `--fixture-variant` 选择。壳模式还会桥接并报告桌面专属能力（窗口控件、
剪贴板、目录选择器、宿主路径、通知）；目录选择器默认走桩，不会卡在原生对话框上。

`--profile-lab <name>` 会在 `.lab-profiles/<name>/` 下保留一个可复用但仍隔离的
profile：装一次插件，之后不带 `--plugin` 也能重开壳界面，再加第二个插件观察两者如何
相互影响。追加插件时会审计整个 profile（`plugin-profile-audit`），因此即使 B 单独能过，
A+B 的冲突也会被报出来。详见 [docs/LAB-PROFILES.md](docs/LAB-PROFILES.md)。

每次运行还会在 `report.md` 旁边写一份自包含的 `report.html`（检查项 + 内嵌截图 +
差异）；`--no-html` 可跳过。`lab shell --show` 会在屏幕上渲染真实 Electron 窗口
（`--show-hold <ms>`，默认 6000），`--keep-open` 则保持打开直到你手动关闭。运行过程
会流式输出 `[lab] ...` 进度行，长时间步骤不会看起来像卡死；配合 `--keep-open` 时，
只有你关闭窗口后运行才结束（Ctrl+C 中止，并把临时 home 留给 `lab clean`）。

这个实验舱从不启动真实的 `desktop` profile，从不读取凭据、sessions 或 settings，
也从不在自己的临时 home 之外安装插件。

## 用法

```powershell
node bin/lab.js gui
node bin/lab.js doctor
node bin/lab.js verify
node bin/lab.js verify --screenshot home --screenshot settings
node bin/lab.js verify --fixture-variant long
node bin/lab.js capture --screenshot home
node bin/lab.js verify --mock-model
node bin/lab.js verify --assert-slot conversation.composer --assert-body-attr style --min-slots 30
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online --route /wallpaper-engine/inventory
node bin/lab.js matrix --config .\fixtures\matrix\effect-conflict.json
node bin/lab.js matrix --config .\fixtures\matrix\theme-conflict.json --online
node bin/lab.js runtimes                       # 本机拥有的官方 DSH 版本
node bin/lab.js matrix --config .\fixtures\matrix\effect-conflict.json --runtime-matrix
node bin/lab.js shell
node bin/lab.js shell --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
node bin/lab.js shell --show                          # 真实窗口，停留 6 秒
node bin/lab.js shell --keep-open                     # 由你自己关闭
node bin/lab.js shell --native-desktop --show         # 真实文件夹对话框 + 系统通知
node bin/lab.js shell --profile-lab dev --plugin dsh-plugin-wallpaper-engine@1.2.0 --online --show --keep-open
node bin/lab.js shell --profile-lab dev --show --keep-open   # 插件仍然装着
node bin/lab.js profile list
node bin/lab.js profile remove-plugin dev dsh-ui-tweaks@0.20.0
node bin/lab.js shell --no-compare-web
node bin/lab.js scan --log .\artifacts\<run>\boot.err.log
node bin/lab.js scan --list                            # 失败签名库
node bin/lab.js scan --latest                          # 重扫最近一次运行的启动日志
node bin/lab.js scan --log .\artifacts\<run>\boot.err.log --explain   # 命中点上下文
node bin/lab.js clean --dry-run                        # 残留目录 + 游离 lab 进程
```

所有会启动真实 runtime 的命令都需要允许派生子进程并结束它们。若沙箱禁止 `taskkill`，
宿主进程会继续存活、命令不会结束；请在这类沙箱之外运行这些命令。显式传入的
`--runtime` 或 `--browser` 路径具有最高优先级：路径不存在时命令会失败，而不是悄悄
回退到默认值。

插件安装是显式选项，registry/GitHub 来源需要 `--online`：

```powershell
node bin/lab.js verify --plugin .\my-plugin.tgz --offline
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
```

夹具与矩阵示例见 [docs/FIXTURES.md](docs/FIXTURES.md)。
回环 provider 见 [docs/MOCK-MODEL.md](docs/MOCK-MODEL.md)。
第 3 阶段实测结果见 [docs/PHASE3-RESULTS.md](docs/PHASE3-RESULTS.md)。
Electron 壳的评估见 [docs/ELECTRON-SHELL.md](docs/ELECTRON-SHELL.md)。

## 测试

```powershell
npm test
$env:DSH_LAB_E2E='1'; npm run test:e2e
npm run ci            # 单元必跑；只有官方 runtime 存在时才跑集成
```

集成测试会在隔离 home 中启动官方 runtime、驱动无头 Edge，并断言清理结果与真实 home
的哈希不变。`test:e2e` 以 `--test-concurrency=1` 运行测试文件，覆盖隔离启动、回环
mock 回合、Electron 壳、故障注入、双运行端口竞争，以及三次重复的稳定性用例。

## 安全

运行任何第三方插件前请先读 [docs/SAFETY.md](docs/SAFETY.md)。本工具不是安全沙箱，
而是一个隔离与证据采集框架。
