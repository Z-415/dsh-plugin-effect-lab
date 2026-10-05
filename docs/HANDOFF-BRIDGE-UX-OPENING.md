# 交接开场白 · 桥接面板 UX 修复

> 把下面整段复制给实施 AI。

---

桥接插件的宿主半区已经在真实官方桌面版里验证可用了（`GET /dsh-lab-bridge/latest.json` → 200），但用户在真实桌面版里实测发现**面板不可用**，请修。先读 `docs/TASK-BRIDGE-UX-FIXES.md`，再动手。

两个问题：

1. **点「打开报告页面」会整页导航，把 DSH 界面整个替换成报告页，且没有返回入口** —— 根因在 `bridge-plugin/lib/client.js:77`：那是普通同源 `<a href>`，做的是顶层导航；桌面壳没有浏览器后退按钮，报告页（`bridge-plugin/lib/routes.js:75-83`）也没有返回控件。注意 shell 的 `setWindowOpenHandler` 只放行 `http:`/`https:` 给系统浏览器，所以 `target="_blank"` 指向 `dsh-app://` 会被拒——但这不是改成整页导航的理由。首选做法是**根本不导航**；若要在外部浏览器打开，用 host 路由返回的真实 loopback URL（别硬编码 19387）。
2. **面板只能看报告，不能操作**，与用户预期差距大。请在面板内做成闭环：输入插件规格（本地路径/tarball/npm spec）→ 开始验证 → 看到进行中状态 → 结束看到摘要 + 内嵌报告。这需要 host 半区新增控制路由触发 `runLabVerify`。

安全红线：实测 `/dsh-lab-bridge/latest/*` **不带 cookie 也返回 200**，不在宿主 auth fence 之后。新增控制面必须自带 token 校验并只接受 loopback，不能做成无鉴权的本地 RCE 入口。其余红线：实验舱不进 profile、工具/控制面永不传 `--profile-lab`、不设 `DSH_HOME` 指向真实 home、不改官方安装目录。

要求：每处补测试并做反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。完成后在**真实桌面版**里人工确认一次完整闭环（profile 已装好：`package.json` deps 26/bundles 24，`cordis.patch.yml` 有 `effect-lab-bridge` + `labPath`），并给出改动文件、提交哈希、验证命令与真实输出。
