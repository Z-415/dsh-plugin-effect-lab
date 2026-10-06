# 任务书 · 克隆出来的 profile 要看得见、能复用

> 面向：实施 AI（审查由另一个会话负责）
> 基线：V2 六项增强 + `34f6c86`
> 说明：本文件取代已删除的 `TASK-PROFILE-LIST-REAL.md`（那份把需求理解成了"列出真实 DSH
> profile"，方向不对）。

## 0. 用户真正的需求（澄清后）

第 1 项"复制 profile"做完之后，用户**看不到复制出来的 profile**：
克隆默认落进一次性临时 home，跑完就删，列表里当然不会出现。
用户要的是——**复制一份用户机真实的 profile，当成一个可见、可复用的实验舱 profile**，
以后测新插件从这个"接近真实环境"的起点开始。

## 1. 实测结论：能力已经存在，只是三处不可见（已核实）

我实测跑了：

```powershell
node bin/lab.js verify --profile-lab clone-demo --clone-profile web --clone-plugins none --no-fixture
```

结果：

- `ok = True`，`cleanup-home: kept lab profile "clone-demo"`；
- 之后 `lab profile list` 里**真的多出了 `clone-demo`**。

原因在 `src/runner.js:159`：`iso = options.profileLab ? openLabProfileHome(...) : createIsolatedHome(...)`，
克隆用的是这个 `iso` 的 profile 目录。所以 **`--clone-profile` 一旦配上 `--profile-lab <name>`，
就会落成持久 profile** ——CLI 也没禁止这个组合。

所以真正缺的是三件事：

1. **没文档**：`docs/CLONE-PROFILE.md` 完全没提"配 `--profile-lab` 可持久化"，
   README 也没写，所以没人知道。
2. **GUI 没入口**：抽屉里只有「克隆为一次性运行」，没有"克隆成持久 profile"。
3. **克隆出来的条目没有来源标记**：`lab-profile.json` 只记 `{name, createdAt, plugins: []}`，
   列表里显示 `clone-demo: no plugins recorded`，看不出它是从 `web` 克隆来的。

## 2. 要做的改动

### 2.1 把持久化变成"显而易见"（CLI）

- **文档**：在 `docs/CLONE-PROFILE.md` 与 README 的克隆小节写清两种用法：
  一次性（临时，跑完即删）与持久（加 `--profile-lab <name>`，出现在 `lab profile list`）。
- **新增语法糖** `--clone-to <name>`：等价于 `--profile-lab <name> --clone-profile <kind>`，
  让用户不必知道这个组合。要求：
  - 目标 profile 已存在时**默认拒绝**并提示，除非显式 `--force`（避免误覆盖用户的持久 profile）；
  - `--clone-to` 与 `--profile-lab` 同时给且名字不一致时报错。
- **引导**：当用了 `--clone-profile` 但**没有**持久化时，运行结束打印一行可读提示，例如
  "本次克隆是临时的，已随隔离 home 删除；想保留请加 `--profile-lab <名字>`（或 `--clone-to <名字>`）"。
  现在用户只能靠翻文档猜。

### 2.2 记录克隆来源（可辨识）

- `.lab-profiles/<name>/lab-profile.json` 增加 `clonedFrom`：
  `{ kind: 'web'|'desktop'|<name>, at: <iso>, sourceHash: <前 12 位>, copiedFiles: n, excluded: [...] }`。
- `lab profile list`（文本与 `--json`）显示来源，例如：
  `- clone-web: cloned from web (5 file(s)), no plugins recorded`。
- GUI 抽屉里对应行也显示 `克隆自 web`，并可「在壳窗口打开」直接复用。

### 2.3 GUI 入口

- 真实 DSH profile 的行（或"新建 profile"区）增加 **「克隆为持久 profile」**：
  让用户填一个名字，然后跑 `lab verify --clone-to <name> --clone-profile <kind> [--clone-plugins none|all]`。
- 同时把现有的 **「克隆为一次性运行」** 标签写清楚是"跑完即删"，避免和持久克隆混淆。

### 2.4 顺带（可选，作为组件，不要当成独立需求）

GUI 要让用户**选**克隆来源，就需要知道本机有哪些真实 profile。可以加一个只读的
`discoverRealProfiles()`（扫 `%USERPROFILE%\.dsh\profiles\*`，**只接受含 `package.json`
的目录**，滤掉 `node_modules`），仅用于"克隆来源"下拉。
**注意**：这不等于要把真实 profile 当 lab profile 管理——它们始终是只读来源，
不得提供删除/卸载动作。

## 3. 验收标准

1. `node bin/lab.js verify --clone-to clone-web --clone-profile web --clone-plugins none --no-fixture`
   → 退出 0；`.lab-profiles/clone-web/` 存在；`lab profile list` 里能看到它并显示
   `cloned from web`。
2. `node bin/lab.js shell --profile-lab clone-web --show --show-hold 3000`
   → 能复用这个克隆（可正常启动/清理）。
3. 重复执行第 1 条（同名）**被拒绝**并提示用 `--force`；加 `--force` 才覆盖。
4. 不带持久化的克隆（只用 `--clone-profile`）跑完会打印"临时、已删除、如何保留"的提示。
5. 沿用既有安全断言：`clone-real-profile-unchanged`（源哈希前后一致）、
   `clone-no-credentials`（隔离 home 无凭据）、`real-home-unchanged`。
6. GUI 能从一个真实 profile 创建持久克隆，并在抽屉里看到它、能再打开。
7. 单元 + 集成测试、反向验证、单独提交。建议的反向验证：
   去掉"目标已存在则拒绝"的判断 → 同名覆盖用例变红。

## 4. 红线

- 真实 profile **只读**：克隆只复制结构文件，不写、不删、不改真实 `~/.dsh`。
- 不复制 `node_modules`；不读凭据 / sessions / settings。
- 克隆出来"起不来"是预期：`--clone-plugins none` / `--clone-exclude X` /
  `--clone-drop-local` 是降级手段，失败插件要如实列进报告，不许吞。
- 每项补测试、反向验证、单独提交、普通终端跑测试、报告用中文。

## 5. 相关代码位置

- `src/runner.js:159`（`profileLab ? openLabProfileHome : createIsolatedHome`）与 `:190`（克隆接线）
- `src/profile-cloner.js`（`CLONE_KINDS`、`assertCloneKind`、`cloneProfileInto`）
- `src/lab-profile.js`（`lab-profile.json` 读写、`listLabProfiles`）
- `src/cli.js`（`clone-profile` / `profile-lab` 参数；`--clone-to` 需新增）
- `src/gui/index.html` / `main.js`（抽屉行与「克隆为一次性运行」）
- `docs/CLONE-PROFILE.md`（目前完全没写持久化）
