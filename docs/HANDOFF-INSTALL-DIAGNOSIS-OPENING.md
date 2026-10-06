# 交接开场白 · 安装失败诊断（dsh-orb-cordis 实例）

> 把下面整段复制给实施 AI。

---

用户在 GUI 里用「在壳窗口打开」试 `https://github.com/mini-yifan/dsh-orb-cordis`（来源选了 npm），失败信息只有
`shell-run: plugin install failed (exit 1)`，看不出原因。请先读 `docs/TASK-INSTALL-DIAGNOSIS.md`（含完整证据与验收），再动手。

根因（四个独立问题，都已核实）：

1. **仓库名 ≠ npm 包名**：`dsh-orb-cordis` 在 npm 上 404；真正发布的包是 **`dsh-orb`**（最新 `0.1.3`，且确实是标准 DSH 插件）。lab 日志里有对照：`dsh plugin add dsh-orb` 成功、`add dsh-orb-cordis` 报 `ERR_PNPM_FETCH_404`。
2. **GitHub 仓库是 monorepo 源码**（`private: true` + `packages/*` + 需要 `pnpm build`），直接按源码安装拿不到可加载的插件。
3. **本机网络下 GitHub tarball 下载不稳**：`codeload.github.com ... ECONNRESET`，重试后失败，且 `install.log` 之后是空的（疑似挂到超时）。
4. **lab 侧错误没上浮**：失败报告里 `plugin-install` 的 detail 只有 `exit 1`；真实 `[ERR_PNPM_FETCH_404] ... dsh-orb-cordis` 只在 `report.errors`/`install.log`；`errorCode` 为空（错误码只覆盖 boot 签名，没覆盖安装失败）；GUI 横幅只取异常第一行。

要做的：

- `plugin-install` 检查带上 pnpm 关键错误行（`ERR_PNPM_*` / 404 / `ECONNRESET` / 超时），不再只有 `exit 1`；安装失败纳入错误码：`LAB-INSTALL-NOTFOUND` / `LAB-INSTALL-NETWORK` / `LAB-INSTALL-UNKNOWN`；早期失败也要写进 `errorCode` 与 `diagnostics.errorCodes`。
- npm 404 且输入像 GitHub（`owner/repo` 或 URL）时，预检该仓库根 `package.json`：是 `private`/有 `workspaces`/缺 `dsh.bundle.patch` 就明确说"这是源码仓库，不能直接安装；它发布的 npm 包是 X"。
- GUI：粘贴 `https://github.com/...` 时自动把来源切到 GitHub（或显著提示），别静默当 npm 名。
- GitHub 下载失败单独识别并给出 npm 替代建议（本案例 `npm:dsh-orb`），并保证失败有明确出口而不是挂到超时。

验收：`npm:dsh-orb-cordis` 失败但 detail 含 `ERR_PNPM_FETCH_404` 且 errorCode=`LAB-INSTALL-NOTFOUND`；`npm:dsh-orb --online` **安装成功**并回显 `dsh-orb@0.1.3`；`github:` 路径失败时 errorCode=`LAB-INSTALL-NETWORK` 且提示 monorepo/真实包名。每项补测试 + 反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。
