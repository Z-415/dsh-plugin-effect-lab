# 任务书 · 实验舱 V2 六项增强（可行性评估 + 实施方案）

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main` 上的启动器版本（桥接插件已可用）
> 本文件是评估 + 实施计划；每项都标了"现状 / 方案 / 坑 / 验收"。

## 0. 结论速览

| # | 需求 | 可行性 | 优先级 | 关键成本 |
|---|---|---|---|---|
| 1 | 复制用户真实 profile 作为测试起点 | 高（但安全边界硬） | P1 | 复制策略 + 白名单 + 依赖重装 |
| 2 | 默认对话 / 思考过程 / 代码块夹具 | 高 | P0 | 探明 thinking 事件形状 |
| 3 | profile 列表做成真正的 UI | 高 | P1 | GUI + JSON 载荷扩展 |
| 4 | 更多安装方式 + 真实包名回显 | 高（**已部分实现**） | P0 | resolver/报告 + GUI 来源选择 |
| 5 | 错误码细化 + 让 DSH 诊断 | 高 | P1 | 签名库加稳定码 + 诊断包 + 桥接工具 |
| 6 | 进度条 / 小动画 | 高 | P1 | 进度协议升级 + GUI |

**注意：有四项已经部分存在，不要重复造**

- 项 4：`src/plugin-resolver.js` **已支持** `github:` 与 `https://github.com/...`（npm 是默认，另外支持本地目录与 tarball）。
- 项 3：`lab profile list --json` **已返回** `name` / `dir` / `plugins[]`（`spec`/`addedAt`/`name`）/ `createdAt` / `mtimeMs`。
- 项 2：`fixtures/plugins/session-seeder` **已经**用官方 session-persistence API 写入真实的
  `user/message` / `assistant/message` / `tool/call` / `tool/result` 事件（无模型调用）。
- 项 6：GUI 已有 `logbar`（状态点 + `#status` + `#hint`）与流式日志。

## 1. 项 1：复制用户机已有的 DSH profile

**目标**：让"测新插件"从一个接近用户真实环境的 profile 起步。

**现状**

- `--profile-lab` 已有持久 profile，但**从最小 profile 起步**，与用户真实环境差很远。
- `src/real-home-guard.js` 只对真实 profile 的**结构文件**做 SHA-256 前后对比。
- `docs/SAFETY.md` 明确：默认不复制凭据、sessions、settings。

**方案**

- 新增 `--clone-profile web|desktop`（或 `--seed-profile <dir>`）：把真实 profile 的**结构文件**
  复制进隔离 home —— `package.json`、`cordis.yml`、`cordis.patch.yml`、
  `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`patches/`。
- 复制后在该隔离 profile 里用官方 runtime 的 pnpm `install --offline` 重建 `node_modules`
  （**不要复制 `node_modules`**：真实 desktop 那份 296 MB，且跨机器布局不可靠）。
- 提供逃生阀：`--clone-plugins none`（只要配置不要插件）、`--clone-exclude <plugin>`（逐个剔除，
  用于"我怀疑是 X 插件把环境搞坏了"）。
- 报告里记录：克隆来源（web/desktop）、来源快照哈希、被排除的插件、装失败的插件。

**坑（重要）**

1. **安全红线**：绝不复制 `.credentials.yaml`、`settings.yaml`、`sessions/`、`agents/`。
   必须有硬断言：真实 home 结构哈希前后不变（复用 `real-home-guard`）+ 隔离 home 无凭据
   （复用 `scanForCredentials`）。
2. **`file:` 本地插件**：真实 profile 里有 `file:C:/Users/35259/.dsh/plugins/...` 这样的依赖。
   复制后它仍指向真实目录（只读引用）——要么明确接受，要么提供 `--clone-drop-local`；
   **不要**把真实 `~/.dsh/plugins` 复制进隔离环境再指着它。
3. **克隆 ≠ 一定能跑**：desktop 有 25 个第三方插件，可能 peer 不满足、tarball 坏了、需要联网。
   克隆出来的 profile 经常"启动就红"。这要当成**预期行为**：报告里明确列出失败插件，
   并提供 `--clone-plugins none` 降级。不要为了让它变绿而吞掉失败。
4. `cordis.patch.yml` 会被桌面版启动重写；克隆时只读快照，不要写回真实文件。

**验收**

- `lab verify --clone-profile web --no-fixture` 能启动；报告标出克隆来源与排除项。
- 真实 home 哈希前后一致；隔离 home 凭据扫描通过。
- `--clone-exclude <plugin>` 能真的把该插件从克隆结果里去掉。

## 2. 项 2：默认对话 / 思考过程 / 代码块

**目标**：插件的作用范围可能是思考过程、对话与对话里的代码块，夹具要覆盖到。

**现状**：`session-seeder` 已写入真实事件序列（`turn/start` → `step/start` → `user/message`
→ `assistant/message`（含 `content` 块与 `stream`）→ `tool/call` → `tool/result` →
`step/end` → `turn/end`）。现有变体：`default` / `empty` / `long`。

**方案**

- 新增 `rich` 夹具变体（或扩展现有变体）：一轮里同时包含
  **thinking 块** + **正常回答** + **fenced 代码块**（代码块只是 markdown 文本，零风险），
  再加一轮 tool call，保证 tool 渲染也还在。
- GUI 加一个「思考 / 代码夹具」按钮（等价 `lab verify --fixture-variant rich`）。

**坑**

- **必须先探明 0.2.0-rc.2 里 thinking 的真实表示**：是 `assistant/message.content` 里的
  `{ type: 'thinking' | 'reasoning' }` 块，还是独立的 `assistant/thinking` 事件？
  从官方 `@deepseek-ai/dsh-session` 的类型定义或已装插件的渲染代码核实。
  **写错类型前端根本不渲染，等于没做。** 这一条是项 2 的主要不确定性。
- 事件里的 `stream`（`text-chunks`）字段要不要给 thinking 也补一份，按官方形状照抄。

**验收**：打开夹具会话能看到 thinking 区域与代码块；报告里记录实际事件类型清单。

## 3. 项 3：profile 列表做成真正的 UI

**目标**：现在是"按钮 → 日志区刷一段文本"，太简陋。

**现状**：`lab profile list --json` 已经返回结构化数据（name / dir / plugins(spec,addedAt,name) /
createdAt / mtimeMs），GUI 的「列出 profile」只是把它打进日志。

**方案**

- GUI 里加一个 profile 抽屉/面板：每个 profile 一行，显示
  **名称、插件数、插件 spec 列表、最后使用时间**；行内按钮：
  「在壳窗口打开」「卸载插件」「删除 profile」「打开目录」「克隆为一次性运行」。
- 需要时给 `--json` 补几个字段：`nodeModulesExists`、`bundlesCount`、`lastRunAt`（可选）。
- 「卸载插件」复用现有 `lab profile remove-plugin`；「删除」复用 `profile remove`
  （内部必须继续走 junction 安全的 `removeTreeSafely`）。

**坑**

- 删除/卸载要处理"profile 正在被别的运行占用"的情况，给出可读错误而不是死循环。
- 不要在渲染进程里直接拼接路径做文件操作——走 lab CLI 的子命令，保持隔离规则一致。

**验收**：不敲命令行即可完成"列出 → 打开 → 卸载 → 删除"；每条都有对应测试。

## 4. 项 4：更多安装方式 + 真实包名回显

**目标**：作者对外宣称的插件名 ≠ 真实 package name 时，仍能装上并看清真正装了什么。

**现状（已部分实现）**：`plugin-resolver.js` 已支持 npm（默认）、本地目录、tarball、
`github:`、`https://github.com/...`。GUI 只有一个插件名输入框。

**缺口**

1. `npm:` 前缀不支持（`npm:foo` 会被当成包名 `npm:foo` 解析，装不上）。
2. **安装后没有回显"真实包名 @ 版本"** —— 这正是用户痛点。
3. GUI 没法显式选来源（只能靠用户自己写对格式）。

**方案**

- `--plugin` 接受 `npm:<spec>`、`github:<owner/repo#ref>`、`https://github.com/...`、本地路径、tarball。
- 安装完成后，从隔离 profile 的 `dependencies` + 已装 manifest 读回
  **resolved name @ version**，写进报告 `plugins[]`（形如
  `advertised spec → resolved dsh-plugin-x@1.2.3`）。
- GUI 加"来源"下拉（npm 名 / GitHub 仓库 / 本地路径 / tarball）+ 输入框 +
  「安装并显示真实包名」。

**坑**：GitHub 来源要 `--online`；`#ref`（分支/tag/commit）必须透传；不同来源同名插件要在报告里
区分 `source kind`，否则"卸错插件"。

**验收**：三种来源各一条集成用例；报告里能看到 spec → resolved 的映射。

## 5. 项 5：错误码细化 + 让 DSH 诊断

**目标**：错误能定位、能带着证据交给用户的 DSH 判断原因。

**现状**：22 条失败签名（boot / plugin / client / profile / env / runtime / crash 七类）、
`failureContext`（boot 末尾 + console/page 错误）、`lab scan --explain`、报告含 checks。

**方案**

1. 给每条签名分配**稳定错误码**（如 `LAB-BOOT-001`、`LAB-PLUGIN-004`），写进
   `signatureHits[]` 与 `report.json`；未命中给 `LAB-UNKNOWN` + 证据。
2. 新增 `--diagnostics-bundle <path>`：导出一份**脱敏**诊断包（report.json 摘要 + boot 末尾 +
   check 列表；明确不含凭据 / sessions / settings），方便用户直接贴给 DSH 或提 issue。
3. 桥接插件加一个 `lab_diagnose` 工具（或扩展 `lab_verify_plugin` 的返回），把**结构化诊断**
   （错误码 + 证据指针 + 失败检查）交给用户 DSH 的 agent 解释。
   **分工**：lab 负责产出证据，DSH 负责解释——不要把整坨日志塞进上下文。

**坑**：诊断包必须脱敏（不要带 token/cookie；路径按需打码）；错误码一旦发布就要稳定，
不要随文案改动。`lab scan --list` 也要显示错误码。

**验收**：人为注入 3 类失败，错误码稳定可复现；`lab scan --explain` 显示错误码；
诊断包能被 `lab_diagnose` 读取，agent 能据此给出原因。

## 6. 项 6：进度条 / 小动画

**目标**：等待时间长时不再像卡死。

**现状**：GUI 有 `logbar`（状态点 + status + hint）与流式日志；CLI 有 `[lab] ...` 行。

**方案**

- 把 `onProgress` 从纯字符串升级为结构化 `{ phase, index, total, detail }`，阶段固定为：
  定位 runtime → 快照 → 建隔离 home → 安装插件 → 启动宿主 → 探针/截图 → 清理 → 写报告。
- GUI 渲染真实进度条 + 当前阶段 + 已用时间；**无阶段进展时（例如 boot 等待）用不确定动画**，
  并显示"仍在等待宿主就绪 · 已用 42s"。
- CLI 保持纯文本，但加步骤序号与耗时前缀（`[3/8] boot … 12.4s`）。

**坑**

- **不要谎报进度**：boot / 安装耗时不可预测，用不确定动画而不是伪造百分比。
- `--keep-open` 时"运行中"要持续显示，不能因为等待用户关窗而显示成完成。
- 动画只在 GUI 渲染进程里做，不要影响 lab 主流程。

**验收**：跑一次 verify 能看到阶段推进与耗时；长等待有动画；CLI 输出带步骤序号。

## 7. 建议实施顺序

1. **项 4** —— 改动最小，直接解决"名字不对装不上/装错"的痛点。
2. **项 2** —— 夹具是插件作者的核心价值；先把 thinking 形状探明。
3. **项 1** —— 价值最高，但安全边界要一次做对。
4. **项 5** —— 错误码 + 诊断包 + 桥接诊断工具。
5. **项 3** —— profile UI（数据已就绪，纯前端为主）。
6. **项 6** —— 进度条/动画（最后做，避免前面几步反复改进度协议）。

## 8. 红线（每项都必须遵守）

- 项 1 绝不能读/复制凭据、sessions、settings；真实 home 哈希前后必须一致。
- 实验舱永远不启动真实 `desktop` profile、不修改官方安装目录。
- 每项都要：单元 + 集成测试、反向验证（回退实现断言会红）、单独提交、普通终端跑测试。
- 报告保持中文；新增的错误码与阶段名要写进文档。
