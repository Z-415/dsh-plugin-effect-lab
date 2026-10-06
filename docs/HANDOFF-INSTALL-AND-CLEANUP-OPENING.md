# 交接开场白 · 安装诊断 + 退出清理（合并）

> 把下面整段复制给实施 AI。两份原任务书已合并为 `docs/TASK-INSTALL-AND-CLEANUP-FIXES.md`。

---

用户连着踩到两个故障，请按 `docs/TASK-INSTALL-AND-CLEANUP-FIXES.md` 一次修完（它合并了原来的安装诊断与清理残留两份任务书，含完整证据、验收与代码位置）。

**故障 A：安装失败看不出原因。** 用户在 GUI 用 npm 来源输入 `https://github.com/mini-yifan/dsh-orb-cordis`，报 `shell-run: plugin install failed (exit 1)`，没有任何有用信息。根因有四个：① 仓库名 ≠ npm 包名——`dsh-orb-cordis` 在 npm 上 404，真正发布的包是 **`dsh-orb@0.1.3`**（确实是标准 DSH 插件）；② 那个 GitHub 仓库是 **monorepo 源码**（`private: true` + `packages/*`，没有 `main`/`dsh.bundle.patch`），不能直接安装；③ 本机网络下 `codeload.github.com` 拉 tarball `ECONNRESET`，重试后失败且日志为空（疑似挂到超时）；④ lab 侧 `plugin-install` 只记 `exit 1`，真实 `ERR_PNPM_FETCH_404` 只在日志里，`errorCode` 为空。要修：安装失败 detail 带 pnpm 关键行 + 稳定错误码（`LAB-INSTALL-NOTFOUND` / `LAB-INSTALL-NETWORK` / `LAB-INSTALL-UNKNOWN`）；npm 404 且输入像 GitHub 时预检仓库 `package.json`，识别 monorepo 并给出真实包名建议（不静默替换）；GUI 粘贴 GitHub URL 自动切来源；GitHub 下载失败给 npm 替代建议并保证明确失败出口。

**故障 B：一次性运行退出时清理失败。** 用户改试 `npm:dsh-orb`（安装成功、壳界面正常），退出时报 `cleanup-no-residue: failed: isolated-root-removed`。根因我已复现：`src/home-manager.js` 的 `disposeIsolatedHome()` 只有 6 次 × 400ms ≈ **2.4 秒**、且重试之间不回收进程；`--keep-open` 手动关窗后 Electron 进程树仍在异步释放句柄，2.4 秒不够就判失败（实测 `removed=false attempts=6 elapsedMs=2432 EBUSY`，解锁后立刻能删）。要修：指数退避 + 总预算 ≥ 20–30 秒，**每次重试之间**用 `process-reaper` 回收引用该 root 的 `DeepSeek Harness.exe` / `msedge.exe` / shell `--user-data-dir`，删除前等壳进程树消失；失败时把 EBUSY 路径与占用进程写进 detail 与 `cleanup.json`。**不要**放宽 `isolated-root-removed` 来让运行变绿。

两条链路都要改 `src/electron-shell/shell-runner.js`，所以一起做。建议顺序：A 的错误上浮 → B 的清理可靠性 → A 的名称解析/monorepo 检测 → GUI 来源识别 → GitHub 下载失败提示 → 文档。

验收（完整版见任务书）：`npm:dsh-orb-cordis` 失败但 detail 含 `ERR_PNPM_FETCH_404`、errorCode=`LAB-INSTALL-NOTFOUND`；`npm:dsh-orb --online` **安装成功并回显 `dsh-orb@0.1.3`**；合成锁占用 7–10 秒时 `disposeIsolatedHome` 仍 `removed=true`（反向验证：退回 6×400ms 就变红）；`lab shell --plugin npm:dsh-orb --keep-open` 手动关窗后 `cleanup-no-residue` 通过、`lab clean --dry-run` 为 0。每个问题单独提交、每处补测试 + 反向验证、测试在普通终端跑（沙箱 spawn EPERM）。
