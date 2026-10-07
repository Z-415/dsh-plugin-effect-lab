# DSH Plugin Effect Lab 0.2.0

隔离验证 DeepSeek Harness（DSH）插件效果与相互影响的实验舱，外加一个把它接进
DSH 桌面版的启动器插件。

## 这个包里有什么

- **项目本体**（实验舱）：CLI + 桌面 GUI，负责隔离验证插件、冲突矩阵、克隆真实
  profile、失败诊断等。
- **桥接插件**（`bridge-plugin/`）：一个很小的 DSH 插件。装进 DSH **profile** 之后，
  在 设置 → 插件 与左侧栏各出现一个入口，点「启动实验舱」在外部打开实验舱自己的
  Electron 窗口。

**两者是分开的两处**：插件进 profile，项目本体放在你自己选的目录（推荐一个固定、
不会被移动的位置）。插件通过配置里的 `labPath` 找到项目本体，DSH profile 里**不会**
出现实验舱的源码。

## 运行要求

- Windows（实验舱通过 CDP 驱动 Edge、用 `taskkill` 回收进程）。
- Node.js >= 22，并且在 `PATH` 里（或给插件配置 `nodePath`）。
- 已安装官方 DeepSeek Harness 桌面版（默认 runtime 路径
  `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`）。
- 无需安装任何依赖：不下载 Playwright/Puppeteer，插件复用 DSH 自带的 Electron。

## 安装（两处，先放本体，再装插件）

1. **把项目本体放到一个固定目录**，例如解压到 `D:\dsh-plugin-effect-lab\`
   （后面所有命令都以它为例；路径含空格/中文也可以，但**装好后不要再移动**）。

2. **完全退出 DSH 桌面版**（含托盘）。DSH 桌面版自己管理 profile，
   `dsh plugin add` 会拒绝它（`profile "desktop" is managed exclusively by the
   Electron application`），所以要手改 profile。

3. **把桥接插件加进 profile 的依赖与 bundles**
   （`%USERPROFILE%\.dsh\profiles\desktop\package.json`）：

   ```json
   "dependencies": {
     "dsh-plugin-effect-lab-bridge": "file:D:/dsh-plugin-effect-lab/bridge-plugin"
   },
   "dsh": { "profile": { "bundles": [ "...", "dsh-plugin-effect-lab-bridge" ] } }
   ```

4. **把项目路径告诉插件**（同一个 profile 的 `cordis.patch.yml` 末尾追加）：

   ```yaml
   - id: effect-lab-bridge
     config:
       labPath: D:\dsh-plugin-effect-lab
   ```

   这一步是必须的：pnpm 会把 `file:` 依赖**拷贝**进 `node_modules`，所以插件无法
   自己推断项目位置；`labPath` 是它与项目本体的唯一联系。

5. **用 runtime 自带的 pnpm 安装，然后启动 DSH**：

   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\desktop"
   node "D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs" install --offline
   ```

6. 打开 **设置 → 插件**，确认出现「实验舱桥接」；点 **启动实验舱**，
   实验舱自己的窗口应当出现（DSH 界面不受影响）。

> 卸载：把上面两处改动删掉（依赖 + bundles + `cordis.patch.yml` 那一段），
> 重跑一次 pnpm install 即可；项目本体目录可以直接删除。

> 0.3.0 起上述 3–5 步由一键安装器完成：先完全退出 DSH，再运行
> `node bin/lab.js bridge install`（或双击 `安装桥接插件.cmd`），重启 DSH 即可。
> 它会自动备份、幂等写入依赖/bundle/`cordis.patch.yml` 的 `labPath`，并用 runtime
> 的 pnpm `install --offline` 安装；失败自动回滚。`lab bridge uninstall` 反向卸载。

## 0.2.0 相对 0.1.0 的变化

- **接进 DSH**：新增启动器插件（设置页 + 侧栏入口，单一「启动实验舱」按钮）。
- **克隆真实 profile**：`lab verify --clone-profile web|desktop`；持久化用
  `--clone-to <name>`（出现在 `lab profile list`，带 `cloned from web` 标记），
  `--clone-exclude` / `--clone-plugins none` / `--clone-accept-risk` / `--force` 可选。
- **更多安装方式**：`npm:` 前缀、`github:` / GitHub URL（支持 `#ref`），并回显真实的
  `name@version`。
- **失败可诊断**：安装失败给出 pnpm 原始原因和稳定错误码
  （`LAB-INSTALL-NOTFOUND` / `-NETWORK` / `-UNKNOWN`）；GitHub 源码仓库若不可直接安装，
  会指出它发布到 npm 的真实包名。`--diagnostics-bundle` + `lab diagnose` 可导出脱敏证据。
- **清理更可靠**：一次性运行退出时不再因句柄未释放而残留（退避 + 回收持有进程）。
- **夹具更完整**：新增 `rich` 变体（思考过程 + 代码块 + tool 轮），壳窗口默认使用。
- **进度可见**：CLI 分 8 阶段带耗时，GUI 有真实进度条与长等待动画。

## 已知问题

- 满负载跑整套 e2e 时，`rich` 夹具的渲染文本探针可能偶发 `codeFound=false`
  （夹具数据本身正确，单独复跑即通过）。详见仓库 `docs/KNOWN-ISSUES.md`。
- 0.2.0 的安装步骤是手动的（改两处配置 + 跑 pnpm）；0.3.0 起不再适用，
  改用 `lab bridge install` / 双击 `安装桥接插件.cmd`（见上）。

MIT License.
