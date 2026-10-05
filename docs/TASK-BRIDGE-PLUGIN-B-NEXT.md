# 下一步指令 · 桥接 B 方案收尾（审查后）

> 面向：继续做 B 方案的实施 AI；审查由另一个会话负责
> 起点：`main` @ `59e47d9`（B 方案 3 个提交已完成）
> 审查结论：**B1 已验证通过；B2 未验证**，且被实验舱两个既有缺陷挡住

## 0. 审查方已经独立确认的事实（不用重做）

- `npm test` 225/225；桥接集成 2/2 通过。
- `lab verify --plugin .\bridge-plugin --offline --route /dsh-lab-bridge/latest/report.html --json`
  真实运行通过：`ok=true`、route `200`、console/page error 0、桥接 findings 0。
- profile 包列表里**没有** `dsh-plugin-effect-lab`（实验舱本体确实没进 profile）。
- `git diff dc52f48 HEAD -- src/` 为空：实验舱核心未被桥接提交改动。
- 因此剩下的工作不是"重做桥接"，而是**修掉两个既有缺陷 + 完成 B2 的人工验证**。

## 1.（P2，优先）修 `shell-runner.js` 的空值崩溃——这是拦路虎

**现象**：`lab shell --profile-lab ... --show`（带/不带桥接插件都一样）在 Electron 壳写回结果前
抛 `TypeError: Cannot read properties of null (reading 'derivedInjections')`。

**根因**：`src/electron-shell/shell-runner.js`

- 第 337 行：`shell-result.json` 不存在时 `result` 为 `null`；
- 第 340 行：`shell-result` 检查已经**正确**判了 `missing`；
- 第 477 行 `if (result.derivedInjections)` 与第 559 行
  `derivedInjections: result.derivedInjections ?? null` **没有空值保护**，于是后抛的 TypeError
  盖掉了本来清楚的 `shell-result: missing`。

**要做**：

1. 两处改成可选链（`result?.derivedInjections`），让失败信息回到 `shell-result` 检查上；
   让 `shell-run` 的失败描述引用 `shell-result`，不再是一个看不懂的 TypeError。
2. **继续查清 `result` 为 null 的根因**（这一步不能省）：是 runner 在壳写回
   `shell-result.json` 之前就超时/杀进程，还是 `--show` 路径下壳根本没写回？
   看 `shellTimeoutMs` 与壳进程等待逻辑、以及壳主进程写 `shell-result.json` 的时机。
   只加空值保护只会让失败"变干净"，`--show` 仍然是坏的。
3. 测试：用不含 `shell-result.json` 的 runDir 触发该路径，断言不抛异常、
   `shell-result` 检查为 `missing`；做反向验证。
4. 把根因结论写进 `docs/BRIDGE-PLUGIN-RESULTS.md`。

## 2.（P2）给 boot 就绪加断言——另一个既有 flake

**现象**：宿主打印了就绪 URL，但端口从未可连接 → 级联成
`token-mint: mint failed: fetch failed` + 所有 route `status 0` + 0 个 DOM slot。
审查期间复现 2 次（完整集成 1 次、stability 单独跑 1/2），随后两次 `lab verify` 又都通过。
注意：**这些失败都发生在不装任何插件的用例里，与桥接无关。**

**根因**：`src/boot-supervisor.js:155` 算了 `listening` 并返回（第 161 行），
但 `src/runner.js:279` 只断言 `port > 0`，**没有 `boot-listening` 检查**。

**要做**：

1. runner 增加 `boot-listening` 检查（`boot.listening === true`）；为 false 时 **fail fast**，
   并让 `failureContext` 带上 boot 日志末尾。把 `listening` 写进 `report.boot`。
2. `tests/integration/stability.test.js` 失败时会删掉临时根目录（第 95–96 行的 `finally`），
   导致失败无法诊断——改成本次失败时**保留**该 root（或把 `boot.out.log`/`boot.err.log`
   复制到稳定位置），并在失败信息里打印路径。
3. 测试：单测覆盖 `listening=false` 时该检查为 fail；反向验证。

## 3.（P3，便宜就做）桥接加固

1. 报告路由只给 `text/html` 加了 CSP；`.svg` 会以 `image/svg+xml` 无 CSP 返回。
   建议加 `X-Content-Type-Options: nosniff`，并把可服务的 MIME 限定白名单
   （或对所有 `text/*` 与 `image/svg+xml` 都加 CSP）。
2. `runLabVerify` 超时只 `kill()` 直接子进程，Windows 孙进程不保证退出；
   建议改用 `taskkill /T /F`（或复用实验舱的进程树 kill 逻辑）。
3. 补一条探测：**不带 cookie** 访问 `/dsh-lab-bridge/latest/report.html`。
   宿主 index 无 token 会 401，但插件路由的鉴权姿态未知；把实测结果写进 RESULTS。

## 4.（B2 的人工验证）在第 1 步修好之后做

```powershell
node bin/lab.js shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --show-hold 10000
node bin/lab.js shell --profile-lab bridge-plain --show --show-hold 10000   # 无插件对照
```

确认并记录：

- 设置页是否出现「实验舱桥接」分区；
- 调用 `lab_verify_plugin` 后摘要是否刷新（runId / 通过项数）；
- 内嵌报告预览是否显示，或如实记录为什么不能显示；
- 若 `settings.section` 槽位在真实壳里不出现，给出 `ctx.slots.inject` 的排查结论。

## 5. 更新文档

- `docs/BRIDGE-PLUGIN-RESULTS.md`：把"只能人工验证 / 本轮未完成"改写成实测结论；
  补上 shell-result 根因、boot-listening 结论、桥接路由无 cookie 的实测结果。
- 若 shell-result 为 null 的根因是新的问题，单独记一条。

## 6. 硬性要求

- 每个问题单独提交；每处补测试并做**反向验证**；测试在**普通终端**跑（沙箱 spawn EPERM）。
- 不碰红线：桥接工具永不传 `--profile-lab`、不设 `DSH_HOME`、实验舱不进 profile、
  不修改官方安装目录、不启动真实 `desktop` profile。
- 完成后给出改动文件、每个提交的哈希、验证命令与真实输出、残余风险。

## 7. 审查方会复核什么

- 两处空值保护是否真的让 `lab shell --show` 给出**可读的**结论（哪怕仍是失败）；
- `shell-result` 为 null 的根因是否查明，而不是停留在加 `?.`；
- `boot-listening` 是否真的 fail fast，而不是继续级联；
- stability 失败时是否还能拿到日志；
- B2 的人工结论是否有截图/观察记录，而不是"应该可以"。
