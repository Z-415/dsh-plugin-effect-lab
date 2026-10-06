# 任务书 · 安装诊断 + 退出清理（合并，一次完成）

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main` @ `ac8b1b6`
> 本文件合并并取代 `TASK-INSTALL-DIAGNOSIS.md` 与 `TASK-CLEANUP-RESIDUE.md`（两份已删除）。

## 0. 为什么合并

两个故障是同一位用户连着踩到的，而且**都要改 `src/electron-shell/shell-runner.js`**
（故障 A 改失败详情，故障 B 改收尾顺序），分开做会互相踩：

- 故障 A：插件**安装失败**时，报告与 GUI 都看不出原因（实例 `dsh-orb-cordis`）。
- 故障 B：插件**装好、界面也开了**，但一次性运行**退出时清理失败**（实例 `dsh-orb` + `--keep-open`）。

一次修完，两条链路（失败可诊断 / 成功可收尾）才算闭环。

---

# 故障 A · 安装失败要能诊断

## A0. 现象（用户实测）

GUI 里点「在壳窗口打开（自己关）」，来源选 **npm**，输入
`https://github.com/mini-yifan/dsh-orb-cordis` / `dsh-orb-cordis`：

```text
失败：shell keep-open · npm:dsh-orb-cordis · 退出码 1 · 用时 9.2s ·
shell-run: shell-run 异常: plugin install failed (exit 1)
```

壳窗口没起来（安装在更早的阶段就失败了），而错误信息**没有说出原因**。

## A1. 根因（四个独立问题，全部有证据）

### A1-a 仓库名 ≠ npm 包名（这次失败的直接原因）

- `dsh-orb-cordis` 在 npm 上**不存在**：`npm view dsh-orb-cordis` → `E404`；
  `@mini-yifan/dsh-orb-cordis` 同样 404。
- 真正发布的是 **`dsh-orb`**，最新 **`0.1.3`**，而且它**确实是标准 DSH 插件**
  （`main` / `exports["./client"]` / `dsh.bundle.patch → cordis.patch.yml` /
  `dsh.client.inject = ["@deepseek-ai/dsh-client-ui-settings"]`）。
- lab 自己的日志里就有对照：`dsh plugin add dsh-orb` **成功**（`+ dsh-orb ^0.1.1`），
  `dsh plugin add dsh-orb-cordis` 失败（`ERR_PNPM_FETCH_404`）。

### A1-b GitHub 仓库不能直接安装（它是 monorepo 源码）

`mini-yifan/dsh-orb-cordis` 的根 `package.json`：`private: true`、
`packageManager: pnpm@11.7.0`、只有 `devDependencies`（tsdown/typescript）、
脚本是 `pnpm -r build` / `tsc -p packages/...`，源码在 `packages/*`；
**没有** `main` / `exports` / `dsh.bundle.patch`。

⇒ 直接按 GitHub 源码装进 DSH 拿不到可加载的插件。

### A1-c 本机网络下 GitHub tarball 下载不稳

```text
[WARN] GET https://codeload.github.com/mini-yifan/dsh-orb-cordis/tar.gz/<sha> error (23). Will retry...
[WARN] GET https://codeload.github.com/... error (ECONNRESET). Will retry in 1 minute. 1 retries left.
```

该次 `install.log` 在重试行之后是**空的**——疑似一直挂到超时，没有明确失败出口。

### A1-d lab 侧：错误没有上浮（"看起来什么都没发生"的原因）

失败 run 的 `report.json`（`artifacts/20261006T143204Z-d78a14/`）里：

- `plugin-install` 检查 detail **只有 `exit 1`**；
- 真实错误 `[ERR_PNPM_FETCH_404] GET .../dsh-orb-cordis: Not Found - 404` 只在
  `report.errors` / `failureContext.errors` / `install.log`；
- `report.errorCode` **为空**，`diagnostics.errorCodes` 也为空——错误码体系只覆盖 boot 日志签名，
  **没覆盖安装阶段失败**；
- GUI 横幅显示 `shell-run: plugin install failed (exit 1)`，底层 pnpm 错误被截断。

## A2. 要修什么

### A2-1 安装失败带真实原因 + 稳定错误码

- `plugin-install` 检查 detail 带上 pnpm 关键行（优先 `ERR_PNPM_*` / `404` / `ECONNRESET` /
  `ETIMEDOUT`），不要只有 `exit 1`。
- 安装失败纳入错误码：`LAB-INSTALL-NOTFOUND`（`ERR_PNPM_FETCH_404`）、
  `LAB-INSTALL-NETWORK`（`ECONNRESET` / 超时 / 重试耗尽）、`LAB-INSTALL-UNKNOWN`。
- `report.errorCode` / `diagnostics.errorCodes` 对**未启动宿主的早期失败**也要有值。
- shell 路径的 `shell-run` detail / 失败横幅要带底层原因（不再只取异常第一行）。
- 失败时给出可操作建议（见 A2-2 / A2-4）。

### A2-2 处理"宣报名 ≠ 真实包名"

- npm 安装 404 且输入**看起来像 GitHub**（`owner/repo`、仓库 URL）时，预检该仓库根
  `package.json`：
  - `private: true` / 有 `workspaces` / 缺 `dsh.bundle.patch` → 明确提示
    "这是源码仓库（monorepo），不能直接安装；请安装它发布到 npm 的包"；
  - 若能读出 `name` 且与输入不同 → 提示"真实包名可能是 `<name>`"。
- **建议命令**，不静默替换用户输入的包名。

### A2-3 GUI 来源自动识别

- 粘贴 `https://github.com/...` 时**自动把来源切到 GitHub**（或显著提示），
  不要静默当成 npm 名——`npm:dsh-orb-cordis` 就是这么产生的。
- 输入 `owner/repo` 形式时给出来源建议。

### A2-4 GitHub 下载失败单独说明

- 把 `codeload` 的 `ECONNRESET` / 重试识别为"GitHub 下载失败"，并在知道真实 npm 包名时给出
  替代建议（本案例 `npm:dsh-orb`）。
- 保证失败有**明确出口与耗时**，不再挂到超时。

---

# 故障 B · 一次性运行退出时清理失败（EBUSY）

## B0. 现象（用户实测）

同一用户改试真正的包 `npm:dsh-orb`（一次性 profile，`--keep-open`）：

```text
失败：shell keep-open · npm:dsh-orb · 退出码 1 · 用时 82.5s ·
cleanup-no-residue: failed: isolated-root-removed
```

**安装成功、壳界面正常打开**，失败在退出阶段：一次性运行的隔离目录没删掉。

## B1. 根因（已复现）

`src/home-manager.js: disposeIsolatedHome()` 的删除预算只有
**`retries = 6`、`delayMs = 400`（≈ 2.4 秒）**，且**重试之间不重新回收进程**。

我用"子进程把该目录当作工作目录"模拟瞬时占用：

```text
removed=false attempts=6 elapsedMs=2432
error=Error: EBUSY: resource busy or locked, rmdir 'C:\Users\35259\AppData\L...'
after child kill, manual rm ok=true        ← 锁一释放就能删
```

真实场景：`--keep-open` 是**用户手动关窗**，Electron 进程树（renderer/GPU/crashpad）与 DSH 宿主
在关窗后**异步**释放句柄；重插件（`dsh-orb` 1083 个文件 + computer-use）更慢。
收尾顺序是 `stopTracked(shell)` → `reapProcessesByCommandLine(一次)` → `iso.dispose()`，
那次回收是**一次性**的，之后 2.4 秒内删不掉就放弃。

残留是**可恢复**的（`lab clean` 能删；用户那份已清理），所以是时机/句柄问题，不是永久泄漏。
另外失败信息只有 `failed: isolated-root-removed`：不说被锁路径、不说 EBUSY、不说占用进程。

## B2. 要修什么

### B2-1 让删除变可靠（核心）

- `disposeIsolatedHome()` 改成**指数退避 + 更大总预算**（总时长 ≥ 20–30 秒，
  间隔从 250ms 递增到 2s），不要固定 6 × 400ms。
- **每次重试之间重新回收进程**：对引用本次运行根目录的
  `DeepSeek Harness.exe` / `msedge.exe` 以及 shell 的 `--user-data-dir`，
  复用 `process-reaper` 按命令行回收。
- 删除前**等待壳进程树真正消失**（轮询到没有进程引用该 root），而不是只 reap 一次。

### B2-2 失败信息要可诊断

- `cleanup-no-residue` / `cleanup-home` 的 detail 带上：被锁路径、错误码（EBUSY/EPERM）、
  仍引用该 root 的进程（pid + name）；同时写进 `cleanup.json`。

### B2-3 保持硬保证

- **不要**放宽 `isolated-root-removed` 来让运行变绿；要修的是"删不掉"。
- 持久 profile（`--profile-lab` / `--clone-to`）仍然保留、不删。
- 继续用 junction 安全的 `removeTreeSafely`，不越 symlink 删除。

---

# 共用的红线

- 不改变安装语义：npm / GitHub 仍需 `--online`；**不静默替换**用户输入的包名。
- 不放宽残留判据（`isolated-root-removed` 必须硬判）。
- 不误杀与本次运行无关的进程（回收只按本次运行的唯一目录/命令行匹配）。
- 真实 profile / 克隆的只读红线不变。
- 每个问题单独提交；每处补测试并做反向验证；测试在普通终端跑（沙箱 spawn EPERM）；报告用中文。

# 建议顺序

1. **A2-1 错误上浮 + 错误码**（改动小，立刻让后续所有失败可诊断）。
2. **B2-1/B2-2 清理可靠性 + 诊断信息**（影响每一次一次性运行）。
3. **A2-2 名称解析 / monorepo 检测**（本案例的核心痛点）。
4. **A2-3 GUI 来源自动识别**。
5. **A2-4 GitHub 下载失败提示**。
6. 更新文档（`docs/FAILURE-SIGNATURES.md`、`docs/DIAGNOSTICS.md`、README 的 GUI 段）。

# 验收标准（一次跑完两组）

## A 组

1. `lab verify --plugin npm:dsh-orb-cordis --online --no-fixture`
   → 失败，但 `plugin-install` detail 含 `ERR_PNPM_FETCH_404` 与 `dsh-orb-cordis`，
   `errorCode = LAB-INSTALL-NOTFOUND`。
2. `lab verify --plugin github:mini-yifan/dsh-orb-cordis --online`
   → 网络可用时能装；网络失败时 `errorCode = LAB-INSTALL-NETWORK`，并提示
   "该仓库是 monorepo 源码、真实 npm 包是 `dsh-orb`"。
3. `lab verify --plugin npm:dsh-orb --online --no-fixture`
   → **安装成功**并回显 `dsh-orb@0.1.3`。
4. GUI：粘贴 GitHub URL 会自动切换来源；失败横幅能看到真实原因（不再只有 `exit 1`）。

## B 组

5. **合成锁用例**：子进程把待删目录当 CWD 占用 7–10 秒，
   新 `disposeIsolatedHome` 仍 `removed=true`。
   反向验证：退回 6 × 400ms → 该用例变红。
6. `lab shell --plugin npm:dsh-orb --no-compare-web --keep-open`
   → 手动关窗后运行以 `cleanup-no-residue` 通过结束；
   `lab clean --dry-run` → 0 残留。
7. 人为长期锁死时，检查 detail 里能看到 EBUSY 路径与占用进程。

## 通用

8. 单元 + 集成测试全绿；每处反向验证（回退实现 → 对应断言变红 → 恢复后全绿）。
9. 结束后 `lab clean --dry-run` 为 0，且没有游离 lab 进程。

# 证据与代码位置

```text
A 失败（404）：artifacts/20261006T143204Z-d78a14/install.log
              [ERR_PNPM_FETCH_404] GET https://registry.npmmirror.com/dsh-orb-cordis: Not Found - 404
A 成功对照：  artifacts/20261006T135533Z-c81bbf/install.log   （+ dsh-orb ^0.1.1）
A GitHub 失败：artifacts/20261006T140433Z-240c31/install.log  （codeload ECONNRESET）
A 真实 npm 包：dsh-orb@0.1.3；仓库根 manifest 是 monorepo（private + packages/*）
B 用户残留：  %TEMP%\dsh-lab-ylzCtP（home/、tmp/、shell-config.json；无 electron-userdata）
B 合成锁：    removed=false attempts=6 elapsedMs=2432 EBUSY；解锁后 manual rm ok=true
```

- 故障 A：`src/plugin-install.js`、`src/report-writer.js`、`src/diagnostics.js`、
  `src/plugin-resolver.js`、`src/gui/index.html`、`src/electron-shell/shell-runner.js`
- 故障 B：`src/home-manager.js`、`src/process-reaper.js`、
  `src/electron-shell/shell-runner.js`、`src/runner.js`、`src/cleanup.js`
