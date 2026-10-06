# 交接开场白 · profile 列表显示本机真实 DSH profile

> 把下面整段复制给实施 AI。

---

用户反馈：`lab profile list` 和 GUI 的 profile 抽屉里**看不到本机真实的 DSH profile**，只有实验舱自己的 `.lab-profiles/`。本机真实存在的是 `~/.dsh/profiles/` 下的 `desktop`、`web`、`dsh-tui`（同目录还有一个 `node_modules`，不是 profile）。请先读 `docs/TASK-PROFILE-LIST-REAL.md`，再动手。

根因已核实：

1. `src/lab-profile.js` 的 `listLabProfiles()` 只扫 `.lab-profiles/`（这是有意的安全设计），GUI 抽屉走的是同一个 `lab profile list --json`，所以两边都看不到真实的。
2. `src/profile-cloner.js` 的 `CLONE_KINDS = ['web','desktop']` + `assertCloneKind()` 把克隆来源硬编码成两个名字，所以 `dsh-tui` 连当克隆起点都不行。

要做的事：

- 新增只读的 `discoverRealProfiles(realHome)`，扫 `~/.dsh/profiles/*`，**只接受含 `package.json` 的目录**（滤掉 `node_modules`），返回 name / dir / plugins 数 / bundles 数 / node_modules 是否存在 / mtimeMs / `source: 'real'`。
- `lab profile list` 分两组输出（lab profile 可管理 / 本机 DSH profile 只读）；`--json` 增加 `realProfiles`，**保留现有 `profiles` 字段不变**。
- 对真实 profile 名的破坏性操作要**明确拒绝**：`lab profile remove desktop` / `remove-plugin desktop ...` 返回可读错误（"这是本机 DSH profile，实验舱不会修改它；请改用 --clone-profile"），并且绝不能落到删除/写入 `~/.dsh` 任何路径的分支。
- 把 `CLONE_KINDS` / `assertCloneKind` 放宽成动态：任何 `~/.dsh/profiles/<name>` 且含 `package.json` 的目录都能用（名字要拒绝 `..`、绝对路径、含分隔符）；保留 `clone-real-profile-unchanged` / `clone-no-credentials` / `real-home-unchanged` 三个断言。
- GUI 抽屉分两组，标题写明"实验舱 profile（可管理）"和"本机 DSH profile（只读）"；真实行**只给** `以此为起点克隆` / `查看插件` / `打开目录`，不给删除/卸载，并且在动作分发处做结构性拒绝（不是藏按钮）。

红线：真实 profile 只读——列出和读结构文件可以，写入/删除/卸载一律禁止；不读真实凭据、sessions、settings、`node_modules` 内容。每项补测试并做反向验证（例如去掉"必须含 package.json"的过滤后，列表里应冒出 `node_modules` 并让断言变红）、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。完成后给出改动文件、提交哈希、验证命令与真实输出。
