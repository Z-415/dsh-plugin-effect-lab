# 任务书 · 安装失败要能诊断（实例：dsh-orb-cordis）

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main`（克隆持久化之后，10 个提交尚未推送）

## 0. 现象（用户实测）

在 GUI 里点「在壳窗口打开（自己关）」，来源选 **npm**，输入
`https://github.com/mini-yifan/dsh-orb-cordis` / `dsh-orb-cordis`，结果：

```text
失败：shell keep-open · npm:dsh-orb-cordis · 退出码 1 · 用时 9.2s ·
shell-run: shell-run 异常: plugin install failed (exit 1)
```

**壳窗口根本没起来，因为插件在安装阶段就失败了；而错误信息没有说出原因。**

## 1. 根因（四个独立问题，全部有证据）

### A. 仓库名 ≠ npm 包名（这是用户这次失败的直接原因）

- `dsh-orb-cordis` 在 npm 上**不存在**：`npm view dsh-orb-cordis` → `E404`；
  `@mini-yifan/dsh-orb-cordis` 同样 404。
- 真正发布到 npm 的名字是 **`dsh-orb`**，最新 **`0.1.3`**，而且它**确实是标准 DSH 插件**
  （`main` / `exports["./client"]` / `dsh.bundle.patch → cordis.patch.yml` /
  `dsh.client.inject = ["@deepseek-ai/dsh-client-ui-settings"]`）。
- lab 自己的日志里就有对照证据：`dsh plugin add dsh-orb` **成功**（`+ dsh-orb ^0.1.1`），
  `dsh plugin add dsh-orb-cordis` 失败（`ERR_PNPM_FETCH_404`）。

### B. GitHub 仓库不能直接安装（它是 monorepo 源码）

`mini-yifan/dsh-orb-cordis` 的根 `package.json`：
`private: true`、`packageManager: pnpm@11.7.0`、只有 `devDependencies`（tsdown/typescript）、
脚本是 `pnpm -r build` / `tsc -p packages/...`，源码在 `packages/*`；
**没有** `main` / `exports` / `dsh.bundle.patch`。

⇒ 直接按 GitHub 源码装进 DSH 拿不到可加载的插件，需要先 build。用户以为"GitHub 源码安装"
能绕过 npm，其实对这个仓库不成立。

### C. 本机网络下 GitHub tarball 下载不稳定

`dsh plugin add https://github.com/mini-yifan/dsh-orb-cordis` 的日志：

```text
[WARN] GET https://codeload.github.com/mini-yifan/dsh-orb-cordis/tar.gz/f540317d... error (23). Will retry...
[WARN] GET https://codeload.github.com/... error (ECONNRESET). Will retry in 1 minute. 1 retries left.
```

而且该次 `install.log` 在重试行之后是**空的**——怀疑一直挂到超时，没有明确失败。

### D. lab 侧：错误没有上浮（这是"看起来什么都没发生"的原因）

失败 run 的 `report.json`（`artifacts/20261006T143204Z-d78a14/`）里：

- `plugin-install` 检查的 detail **只有 `exit 1`**；
- 真实错误 `[ERR_PNPM_FETCH_404] GET .../dsh-orb-cordis: Not Found - 404` 只在
  `report.errors` / `failureContext.errors` / `install.log` 里；
- `report.errorCode` **为空**，`diagnostics.errorCodes` 也为空——错误码体系只覆盖 boot 日志签名，
  **没有覆盖安装阶段失败**；
- GUI 横幅显示的是 `shell-run: plugin install failed (exit 1)`，底层 pnpm 错误被截断在第一行之后。

## 2. 要修什么

### 2.1 安装失败必须带真实原因与稳定错误码

- `plugin-install` 检查的 detail 带上 pnpm 的关键行（优先 `ERR_PNPM_*` / `404` / `ECONNRESET` /
  `ETIMEDOUT`），不要只有 `exit 1`。
- 把安装失败纳入错误码体系：
  - `LAB-INSTALL-NOTFOUND`（`ERR_PNPM_FETCH_404`，包不存在）
  - `LAB-INSTALL-NETWORK`（`ECONNRESET` / 超时 / 重试耗尽）
  - `LAB-INSTALL-UNKNOWN`（其它）
- `report.errorCode` / `diagnostics.errorCodes` 对**未启动宿主的早期失败**也要有值。
- shell 路径的失败横幅/`shell-run` detail 要带底层原因（现在只取异常消息第一行）。
- 安装失败时给出可操作建议（见 2.2 / 2.4）。

### 2.2 处理"宣报名 ≠ 真实包名"

- npm 安装 404 时，如果用户输入**看起来像 GitHub**（`owner/repo`、仓库 URL），
  预检该仓库的根 `package.json`：
  - 若 `private: true` / 有 `workspaces` / 缺 `dsh.bundle.patch` →
    明确提示："这是源码仓库（monorepo），不能直接安装；请安装它发布到 npm 的包"；
  - 若能读出 `name` 且与输入不同 → 提示"真实包名可能是 `<name>`"。
- 能自动推断时，**建议命令**而不是替用户改（不静默替换用户输入的包名）。

### 2.3 GUI 来源自动识别

- 粘贴 `https://github.com/...` 时**自动把来源切到 GitHub**（或至少显著提示），
  不要静默当成 npm 名——本次 `npm:dsh-orb-cordis` 就是这么来的。
- 输入 `owner/repo` 形式时给出来源建议。

### 2.4 GitHub 下载失败要单独说明

- 把 `codeload` 的 `ECONNRESET` / 重试识别为"GitHub 下载失败"，并在知道真实 npm 包名时
  给出替代建议（本案例：`npm:dsh-orb`）。
- 确认失败不会一直挂到超时：现在那几次 `install.log` 只有重试行、没有结论，
  要保证有明确的失败出口与耗时。

## 3. 验收标准

1. `lab verify --plugin npm:dsh-orb-cordis --online --no-fixture`
   → 失败，但 `plugin-install` 的 detail 含 `ERR_PNPM_FETCH_404` 与 `dsh-orb-cordis`，
   且 `errorCode = LAB-INSTALL-NOTFOUND`。
2. `lab verify --plugin github:mini-yifan/dsh-orb-cordis --online`
   → 网络可用时能装；网络失败时 errorCode 为 `LAB-INSTALL-NETWORK`，并提示
   "该仓库是 monorepo 源码、真实 npm 包是 `dsh-orb`"。
3. `lab verify --plugin npm:dsh-orb --online` → **安装成功**并回显 `dsh-orb@0.1.3`（真实验证）。
4. GUI：粘贴 GitHub URL 会切换来源；失败横幅能看到真实原因（不再只有 `exit 1`）。
5. 单元 + 集成测试 + 反向验证。建议反向验证：去掉 `ERR_PNPM_*` 提取逻辑后，
   detail 退回 `exit 1`、对应断言变红。

## 4. 红线

- 不改变安装语义：npm/GitHub 仍需 `--online`，不静默替换用户输入的包名。
- 克隆/真实 profile 只读等既有红线不变。
- 每项补测试、反向验证、单独提交、普通终端跑测试、报告用中文。

## 5. 证据与复现

```text
失败（404）：artifacts/20261006T143204Z-d78a14/install.log
            [ERR_PNPM_FETCH_404] GET https://registry.npmmirror.com/dsh-orb-cordis: Not Found - 404
成功对照：  artifacts/20261006T135533Z-c81bbf/install.log
            + dsh-orb ^0.1.1   （43.6s，downloaded 1）
GitHub 失败：artifacts/20261006T140433Z-240c31/install.log
            codeload.github.com ... error (ECONNRESET)
真实 npm 包：dsh-orb@0.1.3（标准 DSH 插件）
仓库根 manifest：private: true + packages/*（monorepo，需要 build）
```

## 6. 相关代码位置

- `src/plugin-install.js`（`plugin-install` 检查与 install 结果处理）
- `src/report-writer.js` / `src/diagnostics.js`（错误码与 failureContext 组装）
- `src/plugin-resolver.js`（来源分类：npm / github / directory / tarball）
- `src/gui/index.html`（来源下拉、失败横幅、`pluginArgs` 拼装）
- `src/electron-shell/shell-runner.js`（`shell-run` 的异常 detail）
