# 交接开场白 · 清理失败（EBUSY）修复

> 把下面整段复制给实施 AI。

---

用户用 GUI 的「在壳窗口打开（自己关）」（`--keep-open`，一次性 profile）试 `npm:dsh-orb`：**安装成功、壳界面正常打开**，但退出时报
`cleanup-no-residue: failed: isolated-root-removed` ——一次性运行的隔离目录没删掉。请先读 `docs/TASK-CLEANUP-RESIDUE.md`，再动手。

根因已复现（我用"子进程把目录当 CWD"模拟瞬时占用）：

```text
removed=false attempts=6 elapsedMs=2432
error=EBUSY: resource busy or locked, rmdir ...
after child kill, manual rm ok=true     ← 锁一释放就能删
```

`src/home-manager.js` 的 `disposeIsolatedHome()` 只有 **6 次 × 400ms ≈ 2.4 秒**，且**重试之间不重新回收进程**。`--keep-open` 是手动关窗，Electron 进程树 + 宿主还在异步释放句柄；重插件（dsh-orb 有 1083 个文件）更慢，2.4 秒不够就判失败。残留本身是可恢复的（`lab clean` 能删，我已清掉用户那份）。

要做的：

1. `disposeIsolatedHome()` 改成指数退避 + 更大总预算（总时长 ≥ 20–30 秒）；**每次重试之间**用 `process-reaper` 按本次运行目录回收 `DeepSeek Harness.exe` / `msedge.exe` / shell 的 `--user-data-dir`；删除前等壳进程树真正消失。
2. 失败时把 EBUSY/EPERM 的**被锁路径 + 占用进程**记进 `cleanup.json` 与检查 detail，别只说 `isolated-root-removed`。
3. **不要**放宽 `isolated-root-removed` 的硬判据来让运行变绿；要修的是"删不掉"。持久 profile 仍然保留不删。

验收：合成锁占用 7–10 秒时仍能 `removed=true`（反向验证：退回 6×400ms 就变红）；`lab shell --plugin npm:dsh-orb --keep-open` 手动关窗后 `cleanup-no-residue` 通过、`lab clean --dry-run` 为 0。每项补测试 + 反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。
