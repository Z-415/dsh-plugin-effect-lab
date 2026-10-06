# 交接开场白 · 让克隆出来的 profile 看得见、能复用

> 把下面整段复制给实施 AI。

---

用户澄清了第 1 项"复制 profile"的真实需求：**复制完要能看到、能复用这个克隆**，而不是跑完就没了。请先读 `docs/TASK-CLONE-PERSISTENT-PROFILE.md`（它取代了方向不对的 `TASK-PROFILE-LIST-REAL.md`），再动手。

实测结论（我已验证，不用重查）：`node bin/lab.js verify --profile-lab clone-demo --clone-profile web --clone-plugins none --no-fixture` 是**可以**落成持久 profile 的——`cleanup-home: kept lab profile "clone-demo"`，而且 `lab profile list` 里真的会多出 `clone-demo`（原因在 `src/runner.js:159`）。缺的是三件事：

1. **没文档**：`docs/CLONE-PROFILE.md` 完全没写"配 `--profile-lab` 可持久化"，README 也没有。请在文档里写清"一次性（临时，跑完即删）"与"持久（`--profile-lab <name>`）"两种用法。
2. **GUI 没入口**：抽屉里只有「克隆为一次性运行」。请加「克隆为持久 profile」（填名字 → 跑克隆），并把现有那个标成"跑完即删"。
3. **没有来源标记**：克隆出来的 `lab-profile.json` 只有 `{name, createdAt, plugins}`，列表显示 `clone-demo: no plugins recorded`，看不出它是从 web 克隆的。请记录 `clonedFrom: {kind, at, sourceHash, copiedFiles, excluded}`，并在 `lab profile list` 与 GUI 行里显示。

另外加两个体验项：新增语法糖 `--clone-to <name>`（等价 `--profile-lab <name> --clone-profile <kind>`），目标已存在时默认拒绝、除非 `--force`；只用 `--clone-profile` 而没持久化时，运行结束打印"本次克隆是临时的，已删除；想保留请加 `--profile-lab`/`--clone-to`"。

如果 GUI 需要让用户选克隆来源，可以加一个只读的 `discoverRealProfiles()`（扫 `%USERPROFILE%\.dsh\profiles\*`，只接受含 `package.json` 的目录，滤掉 `node_modules`）——但真实 profile 始终是只读来源，不得提供删除/卸载。

验收：`--clone-to clone-web --clone-profile web --clone-plugins none --no-fixture` 后能在 `lab profile list` 看到 `cloned from web`，并能用 `lab shell --profile-lab clone-web` 复用；同名重跑被拒（除非 `--force`）；沿用既有 `clone-real-profile-unchanged` / `clone-no-credentials` / `real-home-unchanged` 断言。红线：真实 profile 只读、不复制 `node_modules`、不读凭据/sessions/settings；克隆起不来是预期，要如实列失败插件而不是吞掉。每项补测试 + 反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。
