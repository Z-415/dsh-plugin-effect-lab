# 任务书 · profile 列表要显示本机真实 DSH profile

> 面向：实施 AI（审查由另一个会话负责）
> 基线：V2 六项增强之后（`54f59f6`）

## 0. 现象（用户实测）

`lab profile list` 与 GUI 的 profile 抽屉里只有**实验舱自己的** profile（本机为
`bridge-dev` / `dev` / `test1`，位于 `.lab-profiles/`），**看不到本机真实的 DSH profile**。

本机真实存在于 `~/.dsh/profiles/` 下的是：`desktop`、`web`、`dsh-tui`
（同目录还有一个 `node_modules`，它不是 profile）。

## 1. 现状与根因（已核实）

- `src/lab-profile.js` 的 `listLabProfiles()` 只扫 `.lab-profiles/`，从不看真实 `~/.dsh`
  —— 这是**有意的安全设计**，不是疏漏。
- GUI 抽屉走 `lab:profiles` → `lab profile list --json`，所以同样只看到 lab profile。
- `src/profile-cloner.js` 的 `CLONE_KINDS = ['web', 'desktop']` + `assertCloneKind()`
  把克隆来源**硬编码成两个名字**，因此 `dsh-tui` 这类真实 profile 连当起点都不行。

⇒ 缺的是两件事：**看得到**真实 profile，以及**能拿它当克隆起点**。

## 2. 目标

1. 列表里能看到本机真实 DSH profile（只读）。
2. 能以任意真实 profile 为起点克隆（复用已有 `--clone-profile` 管线）。
3. 真实 profile 永远是**只读来源**：实验舱不得对它写入、删除或卸载任何东西。

## 3. 方案

### 3.1 发现真实 profile（新增，只读）

- 新增 `discoverRealProfiles(realHome)`：扫 `~/.dsh/profiles/*`，**只接受"目录且含
  `package.json`"** 的条目（本机的 `node_modules` 会被这条过滤掉）。
- 每条返回：`name`、`dir`、`dependenciesCount`、`bundlesCount`、`nodeModulesExists`、
  `mtimeMs`、`source: 'real'`。
- 只读：只读该目录的 `package.json` 与自己需要的结构文件；**不读**
  `.credentials.yaml` / `settings.yaml` / `sessions/` / `agents/` / 真实 `node_modules` 内容。

### 3.2 CLI

- `lab profile list` 输出**分两组**，并明确标注第二组只读：

  ```text
  lab profiles: 3 (<repo>\.lab-profiles)
  - bridge-dev: .\bridge-plugin
  - dev: dsh-plugin-wallpaper-engine@1.2.0, ...
  machine DSH profiles (read-only; use --clone-profile): 3 (%USERPROFILE%\.dsh\profiles)
  - desktop: 25 plugin(s), node_modules present
  - web: ... plugin(s)
  - dsh-tui: ... plugin(s)
  ```

- `--json` 增加 `realProfiles: [...]`，**保留现有 `profiles` 字段**（向后兼容，别改语义）。
- 对真实 profile 名的破坏性操作必须**明确拒绝**：`lab profile remove desktop` /
  `remove-plugin desktop ...` 要返回可读错误，例如
  "这是本机 DSH profile，实验舱不会修改它；请改用 --clone-profile"，
  并且**绝不能**走到删除 `~/.dsh` 下任何路径的分支。

### 3.3 放宽克隆来源

- `CLONE_KINDS` / `assertCloneKind` 改为**动态**：接受任何
  `~/.dsh/profiles/<name>` 且含 `package.json` 的目录；`web` / `desktop` 作为已知默认
  继续在 `--help` 里提示即可。
- 名称必须做路径安全校验：拒绝空名、`..`、绝对路径、含分隔符的名字。
- 保留现有安全断言与语义：`clone-real-profile-unchanged`（源哈希前后一致）、
  `clone-no-credentials`（隔离 home 无凭据）、`real-home-unchanged`。

### 3.4 GUI 抽屉

- 抽屉里分成两组，标题写清楚：
  **实验舱 profile（可管理）** 与 **本机 DSH profile（只读）**。
- 真实 profile 一行只给三个动作：`以此为起点克隆`、`查看插件`、`打开目录`。
- **不提供**删除 / 卸载；而且要在动作分发处做**结构性拒绝**（不是仅把按钮隐藏），
  防止将来有人把按钮加回来时误伤真实 profile。
- 「以此为起点克隆」走 `lab verify --clone-profile <name> ...`（可先弹一个选项：
  是否包含插件 / 是否排除某些插件），或至少落到一个带 `--clone-plugins none` 的安全默认。

## 4. 验收标准

1. `lab profile list` 能看到 `desktop` / `web` / `dsh-tui`，与 lab profile 明确分组；
   `lab profile list --json` 里出现 `realProfiles`，且 `profiles` 语义未变。
2. `lab verify --clone-profile dsh-tui --clone-plugins none --no-fixture` 能跑通；
   若该 profile 结构不完整，给出可读原因而不是崩。
3. `lab profile remove desktop` 被**明确拒绝**，且 `~/.dsh/profiles/desktop` 的结构哈希不变
   （写成断言）。
4. GUI 抽屉显示两组；真实 profile 行没有删除/卸载按钮；即使强行派发对应命令也被拒。
5. 列表与克隆前后，真实 profile 结构哈希不变；隔离 home 无凭据。
6. 单元 + 集成测试、反向验证。建议的反向验证：
   去掉"必须含 `package.json`"的过滤 → 列表里冒出 `node_modules` → 断言变红。

## 5. 红线

- 真实 profile **只读**：列出、读取结构文件允许；写入、删除、卸载一律禁止。
- 不读真实凭据 / sessions / settings / `node_modules` 内容。
- 沿用实验舱既有风格：每项补测试、反向验证、单独提交、普通终端跑测试、报告用中文。

## 6. 相关代码位置

- `src/lab-profile.js`：`listLabProfiles()`（只扫 `.lab-profiles/`）、`removeLabProfile()`
- `src/profile-cloner.js`：`CLONE_KINDS`、`assertCloneKind()`、`cloneSourceDir()`
- `src/gui/main.js`：`lab:profiles` handler（目前只返回 lab profile）
- `src/gui/index.html`：profile 抽屉渲染与行内动作
