# 交接文档 · 审查测试结果与待修复问题

> 面向：接手修复的下一个 AI / 新会话
> 日期：2026-10-05　机器：`C:\Users\35259`，Windows，Node 24.18.0 / npm 11.16.0
> 项目：`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`
> 基线提交：`21d89f8`（本次审查未改动任何文件，工作树干净）
> 本文件只记录"审查 + 实测"的结论与修复建议；审查方不负责改代码。
>
> 修复状态：**P1–P4 已全部修复**（提交 `e4b911d`…`f97e3a4`，共 7 个提交）。
> 修复后独立复核：单元 203/203、doctor PASS、集成 17/17、`stability` 连跑 5/5、
> `lab clean --dry-run` 0 残留。

## 0. 三十秒接手

```powershell
cd 'C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab'
npm test                                  # 单元：基线 194/194 通过
node bin/lab.js doctor                    # 基线 PASS
$env:DSH_LAB_E2E='1'; npm run test:e2e    # 集成：会间歇性红，见 P1
```

需要修复 4 件事，优先级从高到低：

1. **P1（P2 级）**：web DOM 探针在点击会话后不再等稳定，`slotCount` 采到过渡态，导致
   `stability` 集成用例间歇性红（实测约 2/5 复现），并可能污染壳模式的 `minSlots` 基线。
2. **P2（P3 级）**：浏览器 `--user-data-dir` 清理为"尽力而为 + 吞异常 + 不重试"，负载下会
   残留 `dsh-lab-browser-*` 目录；而 `no-new-lab-homes` 只是 advisory，所以"无残留"用例仍全绿。
3. **P3（P3 级）**：`lab capture --profile-lab <name>` 被静默忽略（help 写的是"same options as verify"）。
4. **P4（P3 级）**：安装失败时 `report.pluginValidation` 丢失；`plugin-precheck` 在 stage 为
   `install` 时会被判成通过，报告语义偏绕。

## 1. 前提与沙箱注意事项

- 所有会启动 runtime 的命令（`doctor` / `verify` / `capture` / `shell` / `gui` / 集成测试）
  **必须能派生子进程并 `taskkill`**。在受限沙箱里会出现 `spawn EPERM` 或挂住，这不是项目 bug；
  换普通终端或提权运行即可。本文件的实测数据都在沙箱外取得。
- 官方 runtime：`D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（0.2.0-rc.2，verified）。
- 继续遵守项目铁律：不碰真实 `~/.dsh`、不启动 `desktop` profile、不改官方 `app.asar`。
- 改动前先读 `docs/HANDOFF-20261005.md`（第 5 节"踩过的坑"和第 7 节"铁律"）、
  `docs/HANDOFF-20261005-GUI-POLISH.md`（GUI 相关规则）。每步补测试。

## 2. 本次审查实测基线

| 项目 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm test` | **194/194 通过** |
| 环境自检 | `node bin/lab.js doctor` | **PASS**（8 项全通过） |
| 集成测试（第 1 次） | `$env:DSH_LAB_E2E='1'; npm run test:e2e` | **15/16**，`stability.test.js` 报 `slot count drifted: 47, 47, 37` |
| 集成测试（第 2 次） | 同上 | **16/16 通过**（说明是 flake，不是必现） |
| 稳定性用例单独复跑 5 次 | `DSH_LAB_E2E=1 node --test --test-concurrency=1 tests/integration/stability.test.js` | 又失败 1 次 → 约 **2/5 复现** |
| 版本发现 | `node bin/lab.js runtimes` | `0.2.0-rc.2 [verified, default]` |
| 签名库 | `node bin/lab.js scan --list` | 22 条 |
| profile 列表 | `node bin/lab.js profile list` | `dev`（wallpaper + ui-tweaks）、`test1` |
| 残留清理 | `node bin/lab.js clean --dry-run` | 完整 e2e 两次后报出 **2–3 个 `dsh-lab-browser-*`**（见 P2） |

## 3. 问题清单

### P1（P2）web 探针在交互后不再等稳定 → stability 用例间歇性红

**现象**

```
✖ the same run repeated three times is stable and leaks nothing
  AssertionError: slot count drifted: 47, 47, 37
  actual: 2, expected: 1
```

同一个固定 fixture、同样的参数，三次运行采到的 `data-slot` 元素个数不同。`assertClean(report)`
是过的（`ui-ready` / `dom-slots` / `fixture-ui-clicked` 全通过），只有"三次计数必须相等"这条断言红。

**根因**

`src/browser-driver.js`：

- 第 194 行 `waitForStableUi()` 只在第 388 行、**点击之前**执行一次；
- 点击会话（第 420 行起）后只有固定 `await sleep(1800)`（第 432 行）；打开设置同理（第 451 行）；
- 之后第 464 行直接 `probeDom()`，其中第 305 行 `slotCount: document.querySelectorAll('[data-slot]').length`
  读的是**元素个数**，不保证 DOM 已进入终态。

机器一忙（整套 e2e 连续跑、Edge 进程多）时，第 464 行可能仍落在"点击后的过渡态"，
于是三次分别采到 47 / 47 / 37 这类不同值。

**影响面（不只是测试）**

- `src/electron-shell/shell-runner.js:316` 用 `minSlots: webProbe?.slotCount ?? 0` 把 web 基线的
  `slotCount` 当作壳探针的稳定门槛；web 基线偏高时会抬高壳的门槛，偏低时会放宽门槛。
- `src/electron-shell/shell-probe.js:176` 把 `counts.slots = { web, shell }` 写进壳 vs web 对比报告，
  因此报告里的计数可能是过渡值。slot 名称集合（`dom.slots`）的对比是稳的，计数不稳。

**修复建议**

1. 在点击 / 切会话 / 开设置等交互之后，**再调用一次 `waitForStableUi()`**，然后才 `probeDom()`；
   把结果（如 `settleAfter`）一并返回并写进报告，便于排查。
2. 可选：给浏览器侧的 `waitForStableUi` 增加 `minSlots` 门槛（壳侧 `src/electron-shell/main.js:347`
   已有同类实现可参考），或在稳定性用例里对 `slotCount` 设一个 >0 且可复现的下限。
3. 测试断言改为比较**去重后的 slot 名称集合** `report.browser.dom.slots`（已经是排序后的
   唯一集合），而不是原始元素个数；元素个数天然受渲染重复度影响，不适合做等值不变量。
   见 `tests/integration/stability.test.js:70`。
4. 如仍想保留计数断言，请同时断言三次探测都达到了稳定态，而不是只断言数值相等。

**修复后如何验证**

```powershell
$env:DSH_LAB_E2E='1'; node --test --test-concurrency=1 tests/integration/stability.test.js
# 连跑 5 次不应再出现 slot count drifted
$env:DSH_LAB_E2E='1'; npm run test:e2e
```

### P2（P3）浏览器临时目录清理失败被静默吞掉，残留不进"无残留"判定

**现象**

完整 e2e 跑两次后（含一次 flake），`node bin/lab.js clean --dry-run` 会列出 2–3 个
`C:\Users\35259\AppData\Local\Temp\dsh-lab-browser-*` 目录；单独跑一个浏览器用例又不会漏，
说明是负载/时序相关。`lab clean` 能回收，所以是可清理的残留，不是永久泄漏。

**根因**

`src/browser-driver.js`：

- 第 491–495 行（`openUi().close()`）与第 555–557 行（`evaluateOnce`）：`reapBrowserProcesses()`
  之后**立即** `fs.rmSync(userDataDir, ...)`，失败被 `catch {}` 吞掉，注释写的是
  "Windows may keep a lock for a moment; the temp prefix stays cleanable"。
- 进程刚被 reap、文件句柄尚未释放时，`rmSync` 会 EBUSY/EPERM，目录就留了下来。
- `src/cleanup.js:72-73` 把 `no-new-lab-homes` 放进 `advisory`，`ok` 只由
  `isolated-root-removed` 和 `ports-released` 决定；`tests/integration/stability.test.js:30`
  只断言 `report.cleanup.residue?.ok`，所以这类残留不会让任何用例变红。

**修复建议**

1. 抽一个 `removeDirWithRetry(dir, { attempts, delayMs })`：先 `await sleep(300)` 左右，
   再重试删除；仍失败时**不要静默**，把 `{ removed: false, error }` 返回上去并记进清理结果。
2. 视情况把 `no-new-lab-homes` 从 advisory 提升为：仅当本次提供了 `isolatedRoot` 时才计入
   `checks`（保留"并发运行会新建自己的 home"这个合理性，避免误报）。
3. 给稳定性/无残留用例加一条断言：本次运行产生的 `dsh-lab-browser-*` 目录也必须消失
   （可在 `runner.js` 里对 `residue.newHomes` 过滤 `browser` 前缀）。
4. 补一个单测：模拟 `rmSync` 前几次抛 EBUSY、之后成功，断言重试后目录被删除；
   再补一个始终失败的分支，断言返回 `removed: false` 而不是静默。

**修复后如何验证**

```powershell
$env:DSH_LAB_E2E='1'; npm run test:e2e
node bin/lab.js clean --dry-run     # 应显示 would remove 0 dir(s)
```

### P3（P3）`lab capture --profile-lab <name>` 被静默忽略

**现象**

`--profile-lab` 能解析（在 `VALUE_FLAGS` 里），但 capture 不会复用持久 profile；
help 里 capture 写的是 `same options as verify`，而 verify 支持 `--profile-lab`。

**根因**

`src/cli.js`：

- 第 146 行 `case 'capture'` 组装的 options **没有** `...persistentOptions`；
- 第 131–132 行 `case 'verify'` 把同一个 `persistentOptions` **spread 了两次**（无害但是重复代码）。

**修复建议**

1. capture 分支补上 `...persistentOptions`；顺手删掉 verify 分支里重复的那一次 spread。
2. 在 `tests/unit/cli-parse.test.js`（或同类单测）里加一条 capture 转发 `profileLab` 的用例，
   防止回归。

### P4（P3）安装失败时丢失校验结果；`plugin-precheck` 语义偏绕

**现象**

`plugin add` 失败时 `report.json` / `plugin-validation.json` 里的 `pluginValidation` 是 `null`，
即使 precheck 已经解析出 manifest 结果。另外 stage 为 `install` 时，
`plugin-precheck` 这条检查仍会被判成 pass。

**根因**

`src/runner.js`：

- 第 220 行在 stage 为 `install` 时直接 `throw`；
- 第 233 行 `report.pluginValidation = pluginPipeline.validation;` 在 throw 之后才执行，永远到不了；
- 第 202 行 `plugin-precheck` 的判据是 `pluginPipeline.stage !== 'precheck'`，所以 install
  失败时它显示通过，真正失败只在 `plugin-install` 体现。

**修复建议**

1. 在 `if (pluginPipeline.stage === 'install') throw` **之前**写入
   `report.pluginValidation = pluginPipeline.validation;`（precheck 分支第 209 行已有先例）。
2. 让 `plugin-precheck` 在 install 阶段明确表达"校验通过、失败在安装"，
   例如 detail 里带上 stage，避免读者误以为整条链路通过。
3. 补一个单测：安装命令非 0 退出时，报告里仍带 `pluginValidation`，且 `plugin-precheck`
   为通过、`plugin-install` 为失败。可参考 `tests/integration/failure-injection.test.js`。

## 4. 不要破坏的东西（回归红线）

- 隔离与清理：`home-manager.js` 的 `assertSafeHome` / `removeTreeSafely` 不能改成会跟随
  junction 的递归删除；`docs/HANDOFF-20261005.md` 第 5 节第 6 条记录过两次真实事故。
- 进程回收：`process-reaper.js` 按命令行唯一 `dsh-lab` 目录精确回收，`lab clean` 必须先回收
  进程再删目录（否则 EBUSY）。
- `process-tree.js` 的 `childEnv()` 必须继续剥离 `ELECTRON_RUN_AS_NODE`；`waitForExit()` 的
  timer 清理和 `releaseIpc()` 不要退回旧写法。
- GUI：若改动 `src/gui/*`，必须保留所有按钮 id、`data-args`、`.menu [data-action]`，
  以及 `tests/integration/gui-page.test.js` 里的配色/几何/长日志断言。改 `src/gui` 后
  桌面快捷方式靠 `src/gui/app-sync.cjs` 增量同步，需关掉窗口再启动。
- 不要把 `src/gui/index.html` 日志区改回 `flex: 1 1 auto`，不要给按钮加描边，
  不要把跨版本矩阵标签移出 `.span2`。

## 5. 修复验收清单

1. `npm test` → 全绿（基线 194，新增用例后应 ≥194）。
2. `node bin/lab.js doctor` → PASS。
3. `$env:DSH_LAB_E2E='1'; npm run test:e2e` → 16/16；`stability` 单独连跑 5 次不再 flake。
4. `node bin/lab.js clean --dry-run` → `would remove 0 dir(s)`，且没有游离 lab 进程。
5. `node bin/lab.js profile list` → 与修改前一致（`dev`、`test1`）。
6. 新增/修改的单测与集成用例能反向验证：把修复回退后对应断言会红。
7. 报告保持中文；每个改动单独提交，提交信息说明修的是 P1/P2/P3/P4 中的哪一条。

## 6. 参考文档

- `docs/HANDOFF-20261005.md`：总交接（能力、代码地图、踩过的坑、铁律）。
- `docs/HANDOFF-20261005-GUI-POLISH.md`：GUI 打磨规则与验证方法。
- `docs/ARCHITECTURE.md`、`docs/SAFETY.md`：隔离模型与安全边界。
- `docs/VERSION-POLICY.md`：官方 runtime 升级后的适配流程。
