# 任务书 · 一次性运行退出时清理失败（EBUSY）

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main`（安装诊断任务书之后）

## 0. 现象（用户实测）

在 GUI 里用「在壳窗口打开（自己关）」（= `--keep-open`，一次性 profile）试 `npm:dsh-orb`：

```text
失败：shell keep-open · npm:dsh-orb · 退出码 1 · 用时 82.5s ·
cleanup-no-residue: failed: isolated-root-removed
```

**安装成功、壳界面也正常打开了**，失败在退出阶段：一次性运行的隔离目录没被删掉，
于是 `cleanup-no-residue` / `isolated-root-removed` 判红。

## 1. 根因（已复现，非猜测）

`src/home-manager.js: disposeIsolatedHome()` 的删除预算只有
**`retries = 6`、`delayMs = 400`（合计约 2.4 秒）**，而且**每次重试之间不会重新回收进程**。

我用"子进程把该目录当作工作目录"模拟瞬时占用，实测：

```text
removed=false attempts=6 elapsedMs=2432
error=Error: EBUSY: resource busy or locked, rmdir 'C:\Users\35259\AppData\L...'
after child kill, manual rm ok=true        ← 锁一释放就能删
```

对应到真实场景：

- `--keep-open` 是**用户手动关窗**，Electron 进程树（renderer / GPU / crashpad）与 DSH 宿主
  在关窗后**异步**释放句柄；重插件（`dsh-orb` 有 1083 个文件 + computer-use）更慢；
- shell-runner 的收尾顺序是 `stopTracked(shell)` → `reapProcessesByCommandLine(一次)` →
  `iso.dispose()`，那次回收是**一次性**的，之后 2.4 秒内删不掉就放弃；
- 现在的残留目录是**可恢复的**：`lab clean` 能删掉（我已清理该用户残留），
  所以这是"时机/句柄"问题，不是永久泄漏。

另外，失败信息没有任何细节：只有 `failed: isolated-root-removed`，
既不说哪个路径被锁、也不说错误码（EBUSY/EPERM）、也不说还有谁引用这个目录。

## 2. 要修什么

### 2.1 让删除变可靠（核心）

- `disposeIsolatedHome()` 改成**指数退避 + 更大总预算**（例如总时长 ≥ 20–30 秒，
  单次间隔从 250ms 递增到 2s），不要固定 6 × 400ms。
- **每次重试之间重新回收进程**：对本次运行根目录引用者
  （`DeepSeek Harness.exe`、`msedge.exe`，以及 shell 的 `--user-data-dir`）
  调用 `process-reaper` 的按命令行回收；必要时先杀再删。
- 删除前**等待壳进程树真正消失**（轮询直到没有进程引用该 root），而不是只做一次 reap。
- 具体删不掉时，把**最后一个错误**（EBUSY/EPERM）+ **被锁路径**记进
  `cleanup.json` 与检查 detail，方便定位。

### 2.2 失败信息要可诊断

- `cleanup-no-residue` / `cleanup-home` 的 detail 带上：
  被锁的路径、错误码、仍然引用该 root 的进程（pid + name）。
- 不要只报 `failed: isolated-root-removed`。

### 2.3 保持硬保证

- **不要**为了"让运行变绿"而放松 `isolated-root-removed`——残留就是要判失败。
  要修的是"该删不掉"，不是"删不掉也算过"。
- `lab clean` 仍是兜底路径，行为不变（先回收进程再删目录）。

## 3. 验收标准

1. **合成锁用例**：子进程把待删目录当 CWD 占用 ~7–10 秒，新的 `disposeIsolatedHome`
   仍能 `removed=true`（靠退避 + 回收）。反向验证：把预算改回 6 × 400ms → 该用例变红。
2. **真实重插件路径**：`node bin/lab.js shell --plugin npm:dsh-orb --no-compare-web --keep-open`
   → 手动关窗后，运行以 `cleanup-no-residue` 通过结束；
   `node bin/lab.js clean --dry-run` → 0 残留。
3. **确实锁死时**：人为长期占用 → 检查 detail 里能看到 EBUSY 路径与占用进程，而不是一句
   `isolated-root-removed`。
4. 单元 + 集成测试、反向验证、单独提交。
5. 既有行为不变：持久 profile（`--profile-lab` / `--clone-to`）仍保留、不删。

## 4. 红线

- 不放宽 `isolated-root-removed` 的硬判据。
- 不越过 junction/symlink 删除（继续用 `removeTreeSafely`）。
- 不误杀与本次运行无关的进程（回收按本次运行的唯一目录/命令行匹配）。
- 每项补测试、反向验证、单独提交、普通终端跑测试、报告用中文。

## 5. 证据

```text
用户残留：%TEMP%\dsh-lab-ylzCtP（含 home/、tmp/、shell-config.json；无 electron-userdata）
          lab clean --dry-run → would remove 1 dir；lab clean → removed 1
合成锁：  removed=false attempts=6 elapsedMs=2432 EBUSY；解锁后 manual rm ok=true
实现位置：src/home-manager.js: disposeIsolatedHome（retries=6, delayMs=400）
          src/electron-shell/shell-runner.js:731+（stopTracked → reap 一次 → iso.dispose）
```

## 6. 相关代码位置

- `src/home-manager.js`（`disposeIsolatedHome` 的重试预算）
- `src/process-reaper.js`（按命令行回收，已有能力，需要在删除重试里复用）
- `src/electron-shell/shell-runner.js`（finally 里的 stop → reap → dispose 顺序）
- `src/runner.js`（verify/capture 的同类收尾）
- `src/cleanup.js`（`verifyNoResidue` 的 `isolated-root-removed`）
