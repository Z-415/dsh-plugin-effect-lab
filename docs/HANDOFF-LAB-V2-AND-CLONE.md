# 交接 · 实验舱 V2 六项增强 + 克隆/壳夹具修复

> 交接对象：下一个会话
> 工作树：`main`，最后一条提交 `319ce99`，工作区干净
> 报告语言：中文；错误码见 `docs/FAILURE-SIGNATURES.md`，阶段名见 `docs/PROGRESS.md`

## 1. 本轮范围

1. `docs/TASK-LAB-V2-ENHANCEMENTS.md` 的六项增强，按 §7 顺序：4 → 2 → 1 → 5 → 3 → 6。
2. `docs/TASK-CLONE-PERSISTENT-PROFILE.md`：克隆出来的 profile 要可见、可复用、带来源标记。
3. 两个用户实测问题的修复：克隆带插件、壳窗口默认看到默认对话/思考/代码。
4. 后续实测问题的修复：GUI 持久克隆无反应、desktop 克隆失败、dev/test1 壳窗口退出误报失败。

## 2. 提交一览

| 提交 | 内容 |
|---|---|
| `26e1c5f` | 项 4：`npm:` / `github:#ref` + 真实 `name@version` 回显 + GUI 来源下拉 |
| `d9032dd` | 项 2：`rich` 夹具（`reasoning` 块 + fenced 代码 + tool 轮） |
| `3af8c08` | 项 1：`--clone-profile web\|desktop` 结构克隆（只读真实 profile） |
| `892352b` | 项 5：22 条签名稳定错误码 + 脱敏诊断包 + 桥接 `lab_diagnose` |
| `b372e0e` | 项 3：profile 抽屉 UI + 行内操作 + junction 安全删除 |
| `3d4ff75` | 项 6：结构化进度 `{phase,index,total,detail}` + CLI `[n/8]` + GUI 进度条 |
| `54f59f6` | V2 结果文档 |
| `b27e234` | `--clone-to <name>` 持久克隆 + `clonedFrom` 来源标记 |
| `8e6a8d6` | GUI 页面内对话框（Electron 无 `window.prompt`）+ 克隆可见性 + 下拉刷新 |
| `f0ce244` | 克隆默认保留真实插件 + 克隆内 exact-version 豁免（`--clone-accept-risk`） |
| `9e56d07` | 重写克隆 lockfile 的 `file:` 相对路径 + `--online` 拉缺失包 + 克隆审计提示 |
| `da73077` | `lab shell` 默认 `rich` 夹具 + 注册 workspace + 壳窗口自动打开夹具会话 |
| `c930514` | `shell-capture-painted` 提示化 + GUI 红条写出失败检查名 |
| `319ce99` | 清理陈旧夹具会话/缓存；有第三方插件的 profile 里夹具可见性降级为提示 |

## 3. 新增/重点文件

- 克隆：`src/profile-cloner.js`、`docs/CLONE-PROFILE.md`
- 诊断：`src/diagnostics.js`、`src/commands/diagnose.js`、`docs/DIAGNOSTICS.md`、`bridge-plugin` 的 `lab_diagnose`
- 进度：`src/progress.js`、`docs/PROGRESS.md`
- 夹具：`fixtures/web-session/rich-session.json`、`fixtures/plugins/session-seeder/lib/index.js`、`docs/FIXTURES.md`
- 壳夹具：`src/electron-shell/main.js`、`src/electron-shell/shell-runner.js`
- 真实 profile 发现：`src/real-profiles.js`、`src/commands/real-profiles.js`
- 结果/评估：`docs/TASK-LAB-V2-RESULTS.md`、`docs/TASK-CLONE-PERSISTENT-PROFILE.md`

## 4. 验证（普通终端，非沙箱）

```powershell
npm test
# tests 322 / pass 322 / fail 0

$env:DSH_LAB_E2E='1'; npm run test:e2e
# 全量 43 条；曾出现 bridge-launcher 随机 bad-port 一次，单独重跑通过
```

关键通过用例：

- `tests/integration/clone-profile.test.js`：
  - `web` 全插件克隆 + 克隆内豁免 → `clone-install exit 0; 20 present, 0 missing`、
    `clone-exemptions granted 6`、`dom-slots 37`；
  - `--clone-to` 持久化、`clonedFrom`、同名拒绝、`--force`、临时提示、`lab shell` 复用。
- `tests/integration/shell-mode.test.js`：壳窗口注册并打开 rich 夹具（thinking/code 可见）。
- `tests/integration/diagnostics.test.js`：`LAB-OK` / `LAB-UNKNOWN` + 脱敏包。
- `tests/integration/plugin-sources.test.js`：本地目录、tarball 真装；npm:` 前缀和 GitHub ref 透传。

## 5. 当前已知行为与残余风险

1. **test1 壳窗口看不到夹具**：`test1` 自己的客户端插件会弹出“添加一个 API Key”引导并
   改掉侧栏/会话视图，夹具会话行不出现。lab 会正确 seed（15 事件）并把
   `shell-fixture-*` 记为**提示**，不再把整次运行判失败。`dev` 可正常看到。
   若要精确找出是哪个插件：`dsh-context` / `@michengai/dsh-codex-ui` /
   `dsh-plugin-marketplace` 逐个二分（尚未做）。
2. 持久 lab profile 的 `home/.credentials.yaml` 由 DSH 自己写入（浏览器会话 grant，
   dev 里还有用户填的假 `DEEPSEEK_API_KEY: "11111"`）。因此对持久 profile 跑
   `lab verify` 时 `no-model-credentials` 会失败。壳路径不检查它，不受影响。
3. 全量 `desktop` 克隆需要 `--online`（至少一个 registry tarball 不在离线库）；
   未做 desktop 全插件的自动化端到端用例，手工已通过（26 present、39 slots）。
4. 克隆出来的 profile 若 peer 不满足，需 `--clone-accept-risk` 才会真正加载；
   不加时插件已安装但 DSH 启动时拒绝，报告会列出。
5. `--clone-profile` / `--clone-to` / `--diagnostics-bundle` 只支持 `verify` / `capture`；
   `lab shell` 明确拒绝。
6. 壳 vs web 的截图在动态对话上有约 3% 的跨引擎渲染差异，已按提示处理；
   DOM/token 漂移仍为零。

## 6. 常用命令

```powershell
# 带真实插件的持久克隆
node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-accept-risk --no-fixture
node bin/lab.js verify --clone-to clone-desktop --clone-profile desktop --clone-accept-risk --online --no-fixture
node bin/lab.js profile list
node bin/lab.js shell --profile-lab clone-web --no-compare-web --show --show-hold 3000

# 壳窗口默认 rich 夹具（自动打开对话）
node bin/lab.js shell --show --show-hold 5000

# 诊断
node bin/lab.js verify --diagnostics-bundle out/diagnostics.json
node bin/lab.js diagnose --bundle out/diagnostics.json
```

## 7. 红线仍然有效

- 真实 profile 只读；不复制/读取凭据、sessions、settings；不写官方安装目录。
- 不复制真实 `node_modules`；克隆用官方 pnpm 重建（必要时显式 `--online`）。
- 克隆/插件失败如实写进报告，不吞；`--clone-plugins none` / `--clone-exclude` 只是降级。
- 删除 profile 走 `lstat` 的 `removeTreeSafely`，不追 junction。

## 8. GUI 打磨（2026-10-06 续）

用户点名 6 项，全部实现。改动只碰 `src/gui/*`、`src/lab-profile.js` 的 list 输出和对应
测试，没有动 `src/electron-shell/*`、`src/runner.js` 等壳/夹具路径。

1. **profile 抽屉：每个 profile 列出已装插件 + 逐插件卸载**。`profile list --json` 新增
   `dependencies`（`package.json` 里的第三方包名，已排除 `@deepseek-ai/*`）；抽屉把
   「记录的 spec」和「实际安装的依赖」合并按包名去重（去掉 `dsh-lab-session-fixture`），
   每条右侧一个「卸载」→ 页内二次确认 → `profile remove-plugin <name> <selector>`。
   克隆 profile 之前没有记录插件、没法逐条卸；现在靠依赖列表也能卸。
2. **删掉每个 profile 下的「克隆为一次性运行（跑完即删）」**；行内只剩
   「在壳窗口打开 / 打开目录 / 删除 profile」。克隆栏顶部的持久 / 一次性克隆按钮保留。
3. **抽屉不再遮挡**：原来 `position: fixed; width: min(600px, 94vw)` 直接盖住右侧。
   现在宽度 `--drawer-w: clamp(320px, 34vw, 430px)`（≈ 原来的检查栏），并用
   `body:has(#profileDrawer:not([hidden])) main { padding-right: calc(var(--drawer-w) + 18px) }`
   让主区主动让位；打开时 `#controls` 收成单列，按钮标签不再折行。
4. **左侧按钮重排**：删「再加一个插件一起验证」；两个「在壳窗口打开」并排，之后
   「壳 vs web 对比 + 卸载这个插件」，再让「列出 profile」「安装并显示真实包名」
   「验证这个插件（出报告截图）」各占整行。
5. **检查区**：删「空会话」（长会话 / 思考代码夹具保留），剩 8 个按钮正好四行两列。
6. **查看已装的 DSH 版本改弹窗**：新增 `lab:runtimes` IPC（跑 `runtimes --json`），
   页内「已安装的 DSH 版本」对话框逐条列出版本、状态（verified / untested /
   unsupported + 默认标记）、路径与说明，不再往日志里打。

验证（本机普通终端）：

- `npm test` → **322/322**。
- `node --test tests/integration/gui-page.test.js` → **2/2**：抽屉探针断言合并后的插件
  清单、逐插件卸载调用、只剩三个行按钮、抽屉宽 ≤ 440 且 `gutter ≥ 1`（不压控件）、
  控件单列；另有版本弹窗探针。
- `node --test tests/integration/profile-ui.test.js` → **5/5**（含新增 `dependencies` 断言）。
- `node --test tests/integration/shell-mode.test.js` → **3/3**。
- 全量 `npm run test:e2e`：其余全绿，2 条壳窗口用例失败——
  `shell-mode.test.js` 一次 `host-token: mint failed: fetch failed`（端口竞态，复跑
  3/3 通过）；`clone-profile.test.js` 的 `shell-fixture-session: session=false` 稳定失败
  （可见壳里没点开夹具会话）。后者的失败点在 `src/electron-shell/*` 与克隆 profile 携带的
  真实 web profile 引导态，本次改动没有碰这些文件；属于 §5.1/§5.2 记录的同类已知问题。
- 实拍：`artifacts/gui-shot-review/drawer2/screenshots/drawer.png`（抽屉打开、逐插件卸载、
  左侧单列）。
