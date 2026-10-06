# 实验舱 V2 六项增强 · 实施结果

> 任务书：`docs/TASK-LAB-V2-ENHANCEMENTS.md`
> 实施顺序：§7 的 4 → 2 → 1 → 5 → 3 → 6
> 报告语言：中文；错误码见 `docs/FAILURE-SIGNATURES.md`，阶段名见 `docs/PROGRESS.md`。

## 提交一览

| 项 | 提交 | 说明 |
|---|---|---|
| 4 | `26e1c5f` | `npm:` / `github:#ref` 安装方式 + 真实 `name@version` 回显 |
| 2 | `d9032dd` | `rich` 夹具：`reasoning` 块 + fenced 代码块 + tool 轮 |
| 1 | `3af8c08` | `--clone-profile web\|desktop` 真实 profile 结构克隆 |
| 5 | `892352b` | 稳定错误码 + 脱敏诊断包 + 桥接 `lab_diagnose` |
| 3 | `b372e0e` | profile 抽屉 UI + 行内操作 + junction 安全删除 |
| 6 | `3d4ff75` | 结构化进度协议 + CLI 步骤前缀 + GUI 进度条 |

## 项 4：更多安装方式 + 真实包名回显

- `plugin-resolver.js` 识别 `npm:<spec>` 并只把 `<spec>` 交给 pnpm；
  `github:` 与 GitHub URL 的 `#ref` 原样透传。
- 安装后从隔离 profile 的 `dependencies` + `node_modules/<name>/package.json`
  读回真实包名/版本；`report.plugins[]` 增加
  `advertisedSpec` / `resolvedName` / `resolvedVersion` / `resolvedSpec` / `source`。
  CLI 与 `report.md`（**插件来源与真实包名**）都会打印
  `spec -> name@version`。
- GUI 左侧新增「来源」下拉（npm / GitHub / 本地目录 / tarball）与
  **安装并显示真实包名** 按钮。

真实验证：

```text
$ node --test tests/integration/plugin-sources.test.js      # DSH_LAB_E2E=1
✔ a local directory source installs and reports the real name@version
✔ a tarball source installs and reports the real name@version
✔ npm: is stripped before pnpm sees the spec
✔ a GitHub ref reaches pnpm unchanged
```

反向验证：临时去掉 `npm:` 剥离逻辑后
`tests/unit/plugin-resolver.test.js` 2 条变红
（`actual: 'npm:dsh-plugin-x'`），恢复后 14 条全绿。

## 项 2：默认对话 / 思考 / 代码块夹具

已从 0.2.0-rc.2 的官方类型确认 thinking 的真实表示：

- 内容块：`{ type: 'reasoning', text }`（`ContentBlockMap` 的 `reasoning`），
  **不是** `thinking` 块，也**没有** `assistant/thinking` 独立事件；
- 流记录：`{ type: 'reasoning-chunks', time0, index, dt, texts }`。

`rich` 变体（`fixtures/web-session/rich-session.json`）一轮含 reasoning + 回答 +
fenced 代码块，第二轮含 tool call/result。`report.fixture` 记录
`contentBlockTypes` / `reasoningBlocks` / `codeFences` / `streamTypes` /
`textProbe`；GUI 增加 **思考 / 代码夹具** 按钮。

真实验证：

```text
$ node --test --test-name-pattern="rich fixture" tests/integration/fixture-variants.test.js
✔ the rich fixture renders a reasoning block and a fenced code block
```

反向验证：把 `reasoningBlock` 改成 `{ type: 'thinking' }` 后，
`fixture-reasoning-block` 失败（`saw: thinking, text, tool-call`），
且渲染端 `reasoningFound=false`——证明写错类型前端不渲染。恢复后 3 条全绿。

## 项 1：复制用户真实 profile

- 新增 `src/profile-cloner.js`：
  - 只读/只复制 `package.json`、`cordis.yml`、`cordis.patch.yml`、
    `pnpm-workspace.yaml`、`pnpm-lock.yaml` 与 `patches/**`（只复制普通文件，
    跳过 symlink/junction）；
  - **从不**读 `node_modules` / `sessions` / `agents` / `.credentials.yaml` /
    `settings.yaml`；克隆结果里出现这些条目会 abort；
  - 来源结构文件 SHA-256 前后一致（`clone-real-profile-unchanged`），
    隔离 home 做 `scanForCredentials`（`clone-no-credentials`）；
  - `node_modules` 用官方 runtime 的
    `dsh plugin --profile <name> install --offline --no-frozen-lockfile` 重建，
    不复制真实 node_modules；
  - `--clone-plugins none` / `--clone-exclude <plugin>` / `--clone-drop-local` 降级；
    `file:` / `link:` 默认只读引用并列入报告，`--clone-drop-local` 才移除；
  - 安装失败/被 DSH 兼容性门禁拒绝会如实写进 `clone.install`
    （`code` / `missing` / `rejected` / `incompatible`）。
- `--clone-profile` 只支持 `lab verify` / `lab capture`；`lab shell` 明确拒绝。

真实验证：

```text
$ node bin/lab.js verify --clone-profile web --clone-plugins none --no-fixture
[通过] clone-source: cloned real web profile structure: 5 file(s), 0 patch(es)
[通过] clone-real-profile-unchanged: 5 structural file(s) hashed; source hash 2D5846D10F08... unchanged
[通过] clone-no-credentials: cloned home has no credential file or inline API key
[通过] clone-install: pnpm install --offline exit 0; 0 package(s) present
[通过] real-home-unchanged: all structural hashes unchanged
DSH 插件效果实验舱: 通过

$ node bin/lab.js verify --clone-profile web --no-fixture          # 全部 web 插件
[失败] clone-install: exit 1; 20 present, 0 missing; DSH rejected 6 incompatible plugin(s)
```

全量 web 克隆真实复现了任务书预期的"克隆经常红"：pnpm 11.5s 装完，
DSH 安装后兼容性门禁拒绝了 6 个不满足 peer 的插件（`dsh-better-sidebar@0.19.1`
等）。报告如实列出，未吞掉失败。

反向验证：临时禁用 `--clone-exclude` 过滤后
`planClone` / 克隆 package.json 2 条单测变红；恢复后全绿。

## 项 5：错误码 + 让 DSH 诊断

- 22 条签名各分配稳定错误码（`LAB-BOOT-001..003`、`LAB-PLUGIN-001..007`、
  `LAB-CLIENT-001..003`、`LAB-PROFILE-001..003`、`LAB-ENV-001..003`、
  `LAB-RUNTIME-001..002`、`LAB-CRASH-001`）；`scanLogs()` 的
  `signatureHits[].code`、`report.errorCode`、`report.diagnostics`、
  `lab scan --list/--explain` 全部带码。
- 未命中的**失败**给 `LAB-UNKNOWN` + 证据（失败检查 + 有界 bootTail）；
  成功的 run 给 `LAB-OK` + 空 `errorCodes`。
- `--diagnostics-bundle <file>` 写脱敏包：只有 report 派生的结构化摘要、
  失败检查、有界 boot 末尾；token/API key/Bearer/cookie 与 home/temp 绝对路径
  均被打码，`exclusions` 明确声明不含凭据/sessions/settings。
- 新增 `lab diagnose --report|--bundle|--log|--latest [--json]`；
  桥接插件新增 `lab_diagnose` 工具（spawn `lab diagnose ... --json`，
  返回 `primaryCode` / `errorCodes` / `signatures` / `failedChecks` / `bootTail`）。
  分工：lab 出证据，DSH agent 解释。

真实验证：

```text
$ node bin/lab.js verify --plugin ./fixtures/plugins/does-not-exist \
    --diagnostics-bundle artifacts/diag-manual/unknown.json
$ node bin/lab.js diagnose --bundle artifacts/diag-manual/unknown.json
实验舱诊断: 未通过 (run 20261006T074415Z-aa30ee)
错误码: LAB-UNKNOWN (没有命中已知签名，附证据)
失败检查:
- run: Error: unsupported plugin source: ./fixtures/plugins/does-not-exist
```

反向验证：临时让 `redactText` 原样返回后，
`tests/unit/diagnostics.test.js` 的 redaction 与 bundle 2 条变红；恢复后全绿。

## 项 3：profile 列表 UI

- `lab profile list --json` 新增 `nodeModulesExists` / `dependenciesCount` /
  `bundlesCount` / `lastRunAt`。
- `removeLabProfile` 改用 `lstat` 的 `removeTreeSafely`，并返回可读的
  "profile 正在被占用" 错误（CLI 退出码 1）。
- GUI 新增右侧 profile 抽屉：每个 profile 一行（名称、插件数、node_modules、
  spec 列表、最后运行时间）+ 行内按钮
  **在壳窗口打开 / 克隆为一次性运行 / 卸载插件 / 打开目录 / 删除 profile**。
  所有操作都走 lab CLI；「打开目录」由主进程执行 `profile path <name>` 再打开，
  渲染进程不拼路径。

真实验证：

```text
✔ lab profile list --json carries the GUI fields
✔ lab profile remove is junction-safe and prints removed
✔ lab profile remove reports a missing profile without failing
✔ every GUI button dispatches a lab command without a renderer error
✔ GUI layout stays usable at the minimum window size
```

反向验证：临时把 `nodeModulesExists` 写死为 `false` 后，
`listLabProfiles reports ...` 变红；恢复后全绿。

## 项 6：进度条 / 动画

- `onProgress` 升级为结构化 `{ phase, index, total, label, detail }`；
  `createProgressReporter` 补上 `elapsedMs` / `phaseMs`。
- 固定 8 阶段（`docs/PROGRESS.md`）：
  定位 runtime / 快照 / 建隔离 home / 安装插件 / 启动宿主 / 探针截图 / 清理 / 写报告。
- CLI 输出 `[n/8] 阶段 · 详情 · 阶段耗时`；`DSH_LAB_GUI=1` 时额外输出
  `\x1eLABPROG\x1e{json}` 机器行。
- GUI 渲染：完成阶段决定填充比例；当前阶段用不确定 shimmer 动画；
  `已用 Xs` 每秒更新；`--keep-open` 等用户关窗期间保持"运行中"，
  `onDone` 才置 100% / 绿或红。动画只在渲染进程，不影响 lab 主流程。

真实验证：

```text
$ node --test tests/integration/progress.test.js          # DSH_LAB_E2E=1
✔ runLab reports the eight phases in order with structure and timing
✔ the GUI-structured CLI stream carries machine and human progress lines
```

反向验证：临时停发机器行后，"GUI-structured CLI stream" 变红
（`expected a machine progress line`）；恢复后全绿。

## 总体验证

```text
$ npm test
ℹ tests 306
ℹ pass 306
ℹ fail 0

$ $env:DSH_LAB_E2E='1'; npm run test:e2e
ℹ tests 40
ℹ pass 40
ℹ fail 0
ℹ duration_ms 263954.9823
```

## 残余风险

1. `npm:` / `github:` 的真实**成功联网安装**未在测试里固定执行（网络不可控）；
   集成测试证明前缀剥离、`#ref` 透传，并用本地目录与 tarball 跑通真实安装。
2. 真实 `desktop` profile 的 25+ 插件未做一次完整 clone + boot；web 全量 clone
   已验证会因 peer 不兼容被 DSH 门禁拒绝（这是预期行为，报告如实记录）。
3. 项 3 的「克隆为一次性运行」是重新安装该 profile 记录的 spec，而不是复制
   lab profile 的 node_modules；远程 spec 需要联网。
4. 诊断脱敏是模式匹配 + 只从 report 派生；极不常见的凭据格式理论上可能漏网，
   但原始日志与真实 `~/.dsh` 凭据不在诊断包的数据源里。
5. `removeLabProfile` 的"被占用"依赖操作系统错误（EBUSY/EPERM），没有额外锁文件。
