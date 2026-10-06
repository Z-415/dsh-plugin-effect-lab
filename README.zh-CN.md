# DSH 插件效果实验舱

一个隔离的实验舱，用来搞清楚 **DeepSeek Harness（DSH）插件到底做了什么**、以及
**多个插件放在一起会怎样** —— 全程不碰你真实的 `~/.dsh`。

[English](README.md) | **简体中文**

## 它解决什么问题

光看源码很难判断一个 DSH 插件：装得上不代表启动得起来，可能加载了却看不出任何效果，
可能和别的插件抢同一个 CSS token，也可能在桌面壳和网页里的表现不一样。这个实验舱会在
一次性的 `DSH_HOME` 里启动官方 runtime、把插件装进去、用无头 Edge 驱动真实界面，把
"到底变了什么"写成报告，然后把整个临时环境删掉。

它能回答的问题：

| 问题 | 怎么做 |
|---|---|
| 这个插件加载了吗？有效果吗？ | `lab verify --plugin <spec>` —— 截图 + DOM / token / body 属性探针 |
| 两个插件会冲突吗？ | `lab matrix --config <文件>`，或把两者装进持久 profile 后看 `plugin-profile-audit` |
| 桌面壳和网页表现一致吗？ | `lab shell` —— DOM / token 差异 + 像素差异 |
| 宿主为什么起不来？ | 失败签名库 + `lab scan`，再看 HTML 报告 |
| 会不会弄脏我真实的 DSH？ | 每次运行都隔离；真实 profile 文件在前后做哈希比对 |

目前覆盖的能力：隔离启动 / 截图 / 清理、插件来源解析与 manifest 校验、固定会话夹具、
Electron 壳保真对比、主题与 slot 冲突矩阵、持久 lab profile、无需联网即可跑通真实流式
工具回合的回环 mock 模型、失败签名库，以及桌面 GUI 启动器。

## 环境要求

- Windows。实验舱通过 CDP 驱动 Edge，并用 `taskkill` 回收进程树。
- Node.js >= 22（开发环境为 Node 24）。
- 已安装官方 DeepSeek Harness 桌面版。默认 runtime 路径是
  `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，可用 `--runtime <dsh.cmd>` 覆盖。
- 无需安装任何依赖：不下载 Playwright/Puppeteer，不需要打包工具，没有 npm 依赖。
  壳模式复用 DSH 自带的 Electron 运行时。

## 快速开始

```powershell
node bin/lab.js gui     # 打开桌面启动器（首次构建，之后复用）
node bin/lab.js doctor  # 环境自检，必须 PASS
```

也可以直接双击 `启动实验台.cmd`。启动器执行的就是 CLI 里同一条命令，输出会流式显示在
日志面板里。

## 桌面 GUI 按钮说明

`node bin/lab.js gui`（或双击 `启动实验台.cmd`）会打开启动器。每个按钮执行的都是 CLI
里同一条 `lab.js` 命令，输出流式显示在日志区；`中止` 用来停止正在跑的命令。

**插件 / 持久 profile**（左侧）

- `插件` 输入框 —— 要测的规格：npm/GitHub 规格或本地路径。留空表示只加载所选 profile
  里已经装好的插件。
- `profile` 下拉框 —— `一次性运行`（临时 home，跑完删除）、已有的
  `.lab-profiles/<name>`（连同它已装的插件一起加载，跑完保留）、或 `新建` + 填名字。
  `刷新` 重新读取 profile 列表。
- `在壳窗口打开（自己关）` —— 用当前插件/profile 打开真实 Electron 壳窗口，保持打开
  直到你自己关闭。
- `在壳窗口打开（20 秒）` —— 同上，20 秒后自动关闭。
- `壳 vs web 对比` —— 对同一份 profile 分别跑壳与网页基线，对比 DOM 槽位、
  `--dsw-*` token 和像素。
- `再加一个插件一起验证` —— 在当前插件之外再加一个插件跑壳窗口，用来暴露跨插件冲突。
- `卸载这个插件` —— 只从选中的持久 profile 里卸掉 `插件` 框里写的那个插件。
- `列出 profile` —— 打开 profile 抽屉：每个 `.lab-profiles/` 条目显示插件列表、
  `克隆自 <kind>` 来源标记，以及行内的打开 / 一次性克隆 / 卸载 / 打开目录 / 删除。
  抽屉顶部还有只读的来源下拉和 **克隆为持久 profile** /
  **克隆为一次性运行（跑完即删）**（来源是 `~/.dsh/profiles` 下发现的真实 profile）。
- `验证这个插件（出报告截图）` —— 对这个规格跑完整的隔离 `lab verify`：检查项、报告、截图。
- `原生桌面` —— 用真实的文件夹对话框和系统通知，而不是默认的确定性桩
  （`--native-desktop`）；`启动时弹出文件夹对话框` 会在运行过程中真的弹出选择框
  （`--probe-native-dialog`）。

**检查**（右侧）

- `自检 doctor` —— 环境自检，必须 PASS。
- `快速验证` —— 不装新插件的 `lab verify`。
- `验证 + 设置页截图` —— 同上，额外截一张设置页。
- `空会话` / `长会话（12 轮）` —— 分别用 `empty` / `long` 会话夹具运行。
- `失败签名库` —— 浏览已知失败签名（`lab scan --list`）。
- `扫描最近一次日志` —— 重扫最近一次运行的启动日志（`lab scan --latest`）。
- `查看已装的 DSH 版本` —— `lab runtimes`。

**更多（矩阵 / 版本）** —— 折叠在「检查」里

- `主题冲突矩阵` / `效果探针矩阵` —— 跑仓库自带的矩阵配置。
- `跨版本矩阵（每个版本各跑一遍）` —— 按发现的每个 DSH 版本各跑一遍。

**清理**

- `查看残留（不改动）` —— 只列出残留的 lab 临时目录和游离进程。
- `清理残留临时目录` —— 先回收游离进程，再删除这些目录。

**底部**

- `打开最新 HTML 报告` —— 打开最新的 `artifacts/<run>/report.html`。
- `打开 artifacts 文件夹` —— 打开产物目录。
- `中止` —— 停止正在跑的命令。

## 常用工作流

### 1. 验证一个插件

```powershell
# 本地目录或 tarball —— 不需要联网
node bin/lab.js verify --plugin .\my-plugin --offline

# npm 或 GitHub 规格 —— 需要 registry 访问
node bin/lab.js verify --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
```

运行会启动隔离宿主、把插件装进隔离 profile、打开界面、截图，并记录 `data-slot` 节点、
`--dsw-*` token 与 body 属性，最后清理干净。结果看 `artifacts/<run>/report.html`。

需要"通过 / 不通过"的判定时，加上断言：

```powershell
node bin/lab.js verify --plugin .\my-plugin --offline `
  --assert-slot conversation.composer --assert-body-attr style --min-slots 30
```

### 2. 对比桌面壳与网页

```powershell
node bin/lab.js shell
node bin/lab.js shell --plugin dsh-plugin-wallpaper-engine@1.2.0 --online
node bin/lab.js shell --show                    # 真实 Electron 窗口，停留 6 秒
node bin/lab.js shell --native-desktop --show   # 真实文件夹对话框 + 系统通知
```

在未修改的 profile 上，壳与网页的截图像素级一致；报告会列出壳引入的 DOM、token 与
body 属性差异。

### 3. 测试多个插件放在一起

```powershell
node bin/lab.js matrix --config .\fixtures\matrix\theme-conflict.json --online
```

`matrix` 会逐个组合运行，并分类为 `coexist` / `manual-review` / `high-conflict`，
同时指出两个插件具体在抢哪些 token 或 slot。

### 4. 保留一个 profile，逐个加插件

```powershell
node bin/lab.js shell --profile-lab dev --plugin dsh-plugin-wallpaper-engine@1.2.0 --online --show --keep-open
node bin/lab.js shell --profile-lab dev --plugin dsh-ui-tweaks@0.20.0 --online   # 审计 A+B
node bin/lab.js shell --profile-lab dev --show --keep-open                       # 不带 --plugin 重开
node bin/lab.js profile list
node bin/lab.js profile remove-plugin dev dsh-ui-tweaks@0.20.0
```

profile 单独保存在 `.lab-profiles/<name>/` 下，不会进你真实的 `~/.dsh`。追加第二个
插件时会审计整个 profile，所以即使 B 单独能过，A+B 的冲突也会被报出来。

### 4b. 克隆真实 profile（可持久复用 / 一次性）

```powershell
# 持久：保存在 .lab-profiles/clone-web，可反复复用
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture
node bin/lab.js profile list        # clone-web: cloned from web (5 file(s)), no plugins recorded
node bin/lab.js shell --profile-lab clone-web --show --show-hold 3000

# 只有明确要覆盖已有克隆时才加 --force
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture --force

# 一次性：跑完即删，运行结束会提示怎么保留
node bin/lab.js verify --clone-profile web --clone-plugins none --no-fixture
```

真实 profile 始终只读：只复制结构文件，不复制 `node_modules`、凭据、settings、
sessions、agents。`lab real-profiles` 列出可用作克隆来源的真实 profile；GUI 抽屉里有
**克隆为持久 profile** / **克隆为一次性运行（跑完即删）** 两个入口，克隆出来的行会显示
`克隆自 web`。详见 [docs/CLONE-PROFILE.md](docs/CLONE-PROFILE.md)。

### 5. 不用真实模型跑一个真实回合

```powershell
node bin/lab.js verify --mock-model
```

回环的 OpenAI 兼容 provider 会流式返回一个脚本化 tool call 和 `tool/result` 事件，
从而在无外网、无 API key 的情况下跑通完整回合。

### 6. 定位失败原因

```powershell
node bin/lab.js scan --latest
node bin/lab.js scan --log .\artifacts\<run>\boot.err.log --explain
node bin/lab.js scan --list   # 浏览失败签名库
```

### 7. 清理

```powershell
node bin/lab.js clean --dry-run   # 先看有哪些残留临时目录和游离 lab 进程
node bin/lab.js clean             # 再删除
```

## DSH 桌面版插件（启动器）

仓库里还带了一个很小的 DSH 插件 `dsh-plugin-effect-lab-bridge`
（`bridge-plugin/`）。它装进 DSH 的 profile，但**实验舱本体不进 profile**：它会加一个
左侧栏入口（**实验舱**，烧瓶图标），点开是一个独立面板；同时也在 设置 → 插件 下提供
「实验舱桥接」分区。两处都有同一个「启动实验舱」按钮，点击后在外部启动实验舱自己的
Electron GUI——DSH 界面不会被替换，也不会被打断。宿主半区另外注册了面向 agent 的工具
`lab_verify_plugin`。插件自带样式表，按钮跟随实验舱的扁平配色（无边框浅蓝填充、悬停换背景），
而不是宿主默认的按钮外观。

DSH 桌面版自己管理 profile，所以 `dsh plugin add` 会拒绝它
（`profile "desktop" is managed exclusively by the Electron application`）。
安装方式是直接改 profile：

1. 完全退出 DSH 桌面版（含托盘）。
2. 在 `profiles/desktop/package.json` 的 `dependencies` 里加
   `"dsh-plugin-effect-lab-bridge": "file:<仓库路径>/bridge-plugin"`，
   并在 `dsh.profile.bundles` 里加 `"dsh-plugin-effect-lab-bridge"`。
3. 在 `profiles/desktop/cordis.patch.yml` 里把实验舱路径告诉插件：

   ```yaml
   - id: effect-lab-bridge
     config:
       labPath: '<实验舱仓库路径>'
   ```

4. 用 runtime 自带的 pnpm 安装，然后重新启动桌面版：

   ```powershell
   cd <profile>
   node "D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs" install --offline
   ```

要求与注意事项：

- `PATH` 里必须有真正的 `node.exe`，或者在同一段配置里设置 `nodePath`。插件不会拿
  Electron 可执行文件当 Node 用。
- `file:` 依赖是被**拷贝**进 `node_modules` 的，所以改完 `bridge-plugin/` 后必须重跑
  一次 `pnpm install --offline`，否则 profile 加载的还是旧副本。
- `POST /dsh-lab-bridge/launch` 只接受 loopback，并校验注入到渲染层的每宿主 nonce；
  它固定执行 `bin/lab.js gui`，不接受任何调用方参数。
- 更多细节：[bridge-plugin/README.md](bridge-plugin/README.md)、
  [docs/TASK-BRIDGE-LAUNCHER.md](docs/TASK-BRIDGE-LAUNCHER.md)、
  [docs/BRIDGE-PLUGIN-RESULTS.md](docs/BRIDGE-PLUGIN-RESULTS.md)。

## 命令速查

| 命令 | 作用 |
|---|---|
| `lab gui` | 桌面启动器窗口（`--install-shortcut` 同时在桌面创建快捷方式） |
| `lab doctor` | 自检：runtime、Node、临时 home、浏览器、真实 home 保护 |
| `lab verify` | 完整的隔离插件验证：启动、探针、截图、清理、报告 |
| `lab capture` | 同一条流水线，偏重截图 |
| `lab shell` | Electron 壳保真：与网页基线做 DOM / token 与像素差异 |
| `lab matrix` | 按 JSON 列表跑插件组合并分类冲突 |
| `lab runtimes` | 列出本机已安装的官方 DSH 版本及支持状态 |
| `lab profile` | 管理持久 lab profile：`list` / `create` / `remove` / `remove-plugin` / `path` |
| `lab scan` | 用失败签名库扫描启动日志与控制台日志 |
| `lab clean` | 删除残留的 lab 临时目录与游离 lab 进程 |

所有命令都支持 `--json`；`verify`、`capture`、`shell`、`matrix` 还支持 `--no-html`。
完整选项见 `node bin/lab.js --help`。

## 报告与产物

每次运行会在 `artifacts/<run-id>/` 下写入：

- `report.html` —— 自包含（截图已内嵌），中文
- `report.md` / `report.json` —— 同样的检查项，Markdown 与机器可读两种形式
- `boot.out.log` / `boot.err.log`、`install.log`、`cleanup.json`
- `screenshots/`，以及 DOM、差异数据（如 `dom/dom.json`）

`report.html` 可以单独打开或分享，不依赖运行目录里的其他文件。

## 安全边界

- 从不启动真实的 `desktop` profile，从不读取凭据、sessions 或 settings。
- 从不修改官方安装目录 —— 对实验舱来说 `app.asar` 是只读的。
- 每次运行都使用 `dsh-lab-*` 临时 home，跑完删除；真实 profile 的结构文件在前后做哈希
  比对，必须保持不变。
- 这**不是**安全沙箱。恶意插件依然以你的用户权限运行，测试不可信插件前请先读
  [docs/SAFETY.md](docs/SAFETY.md)。

## 测试

```powershell
npm test
$env:DSH_LAB_E2E='1'; npm run test:e2e   # 会启动真实 runtime，需在普通终端运行
npm run ci
```

集成测试会在隔离 home 中启动官方 runtime、驱动无头 Edge，并断言清理结果与真实 home
的哈希不变。它必须运行在能派生子进程并结束它们的环境里：若沙箱禁止 `taskkill`，宿主
进程会继续存活，命令不会结束。

## 更多文档

- [docs/HANDOFF-20261005.md](docs/HANDOFF-20261005.md) —— 状态、代码地图、踩过的坑、检查清单
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —— 隔离模型与运行生命周期
- [docs/GUI.md](docs/GUI.md) —— 桌面启动器
- [docs/LAB-PROFILES.md](docs/LAB-PROFILES.md) —— 持久 profile
- [docs/ELECTRON-SHELL.md](docs/ELECTRON-SHELL.md) —— 壳保真模式
- [docs/FIXTURES.md](docs/FIXTURES.md) / [docs/MOCK-MODEL.md](docs/MOCK-MODEL.md) —— 夹具与回环 provider
- [docs/VERSION-POLICY.md](docs/VERSION-POLICY.md) —— 官方 DSH 升级后的适配流程

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
