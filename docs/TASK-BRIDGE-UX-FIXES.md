# 桥接面板问题清单与修复任务（真实桌面版实测）

> 面向：实施 AI（审查由另一个会话负责）
> 现场：桥接已装进真实 desktop profile 并在官方桌面版里验证过宿主半区（路由 200）
> 用户实测结论：**有入口，但不可用**——点进去只能看报告，且没有返回入口，直接卡住

## 0. 用户实测现象

1. 设置页里确实能看到「实验舱桥接」入口，但进去后**只有只读的报告视图，没有任何可操作项**。
2. 点「打开报告页面」后，**整个 DSH 窗口被替换成报告页**（见用户截图：标题「还没有实验舱报告」），
   没有返回/关闭按钮，**卡在该页面出不来**，只能关窗口重启。
3. 与用户预期差距大：预期是"在这个面板里能做事"，实际是"只能看一份还不存在的报告"。

## 1. 根因（已定位到代码，不需要重新排查）

1. **整页导航**：`bridge-plugin/lib/client.js:77`
   `React.createElement('a', { href: REPORT_URL }, '打开报告页面')` —— 这是普通同源 `<a href>`，
   点击做的是**顶层导航**，把 DSH 的单页应用整个替换成报告页。桌面壳没有浏览器后退按钮，
   SPA 状态也就丢了 → 用户无路可回。
2. **报告页/占位页自身没有任何返回控件**：`bridge-plugin/lib/routes.js:75-83`（`placeholderPage`）
   与 `:166-167`（`report.html` 空态）只输出文本，没有返回/关闭入口。
3. **为什么当初写成了直接导航**：桌面壳的 `setWindowOpenHandler` 只把 `http:`/`https:` 交给系统浏览器，
   其余一律 deny（见 `docs/BRIDGE-PLUGIN-RESULTS.md` §2 与用户记录 §0.10/§0.13）。
   所以 `target="_blank"` 指向 `dsh-app://app/...` 会被拒——但那**不是**改用整页导航的理由。
4. **面板没有任何操作能力**：client 半区只有"摘要 + 内嵌预览 + 报告链接"；
   `lab_verify_plugin` 只能由 agent 调用，UI 里没有触发验证的入口 → "只能看，不能做"。

## 2. 修复要求

### P1（必须）不能再整页导航

- 删掉 `client.js:77` 的普通 `<a href>`。
- 若仍要提供"在浏览器打开"：用 `http://127.0.0.1:<port>/dsh-lab-bridge/...` + `target="_blank"`
  （shell 放行 `http:` 给系统浏览器），**不要硬编码 19387**——让 host 路由在 JSON 里返回真实
  loopback URL（可从请求的 Host 头推导），client 用它。
- 报告/占位页要么不 navigate，要么自带返回；注意报告路由的 CSP 是 `script-src 'none'`，
  内联 `history.back()` 脚本会被自己挡掉——所以**首选"根本不导航"**。
- 断言：点击面板里任何控件后，`window.location` 都不应变成报告 URL（补一条 client 测试）。

### P2（用户预期的核心）面板要能操作

- 面板内提供：插件规格输入（本地路径 / tarball / npm spec）+ **开始验证**按钮 +
  运行状态/进度 + 取消。
- 结束后展示摘要 + 内嵌报告（现有 srcdoc 预览可复用）。
- 这需要 host 半区新增控制路由（如 `POST /dsh-lab-bridge/verify`），client 调它触发
  `runLabVerify`；状态用轮询或状态接口。
- **安全红线（重要）**：此前实测 `/dsh-lab-bridge/latest/*` **不带 cookie 也返回 200**，
  不在宿主 auth fence 之后。新增控制面必须自带 token 校验 + 只接受 loopback 请求，
  绝不能做成无鉴权的本地 RCE 入口。
- 验证一次要 1–3 分钟：UI 不能阻塞，必须有进行中状态。

### P3 空态与文案

- 空态应告诉用户"在哪里、怎么做"，并给出**可点击的操作**，而不是只写"完成后刷新本页"。

## 3. 验收标准

1. 面板内能完成一次完整验证：输入本地插件路径 → 开始 → 看到进行中状态 → 结束看到摘要 +
   内嵌报告，**全程不离开 DSH 界面**。
2. 点任何入口都不会整页替换 DSH UI；不存在"打开后无返回"的页面。
3. 控制路由有鉴权：无 token / 非 loopback 请求被拒。
4. 单元 + 集成测试，每处断言做反向验证；测试在普通终端跑（沙箱 spawn EPERM）。
5. 在**真实桌面版**里人工确认（profile 已装好，见 §5）。

## 4. 红线（不要破坏）

- 实验舱本体不进 profile；工具/控制面**永不**传 `--profile-lab`、不把 `DSH_HOME` 指向真实 home。
- 不修改官方安装目录；不启动真实 `desktop` profile 做自动化测试。
- 每步补测试、单独提交、报告用中文。

## 5. 现场信息（便于复现）

- 真实 desktop profile 已装：`package.json` deps 26 / bundles 24（含 `dsh-plugin-effect-lab-bridge`）；
  `cordis.patch.yml` 有 `- id: effect-lab-bridge` + `config.labPath`。
- 宿主半区已加载：`GET http://127.0.0.1:19387/dsh-lab-bridge/latest.json` → 200（空态 JSON）。
- 报告页：`/dsh-lab-bridge/latest/report.html`（当前是空态占位）。
- 复现步骤：设置 → 插件 → 实验舱桥接 → 点「打开报告页面」→ 整页变成报告页，无返回。
- 安装/回滚快照：`D:\dsh-bridge-1005\`（含 `CHANGES.md`、`INSTALL-RESULT.txt`）。

## 6. 相关代码位置

- `bridge-plugin/lib/client.js:27`（REPORT_URL）、`:76`（内嵌预览按钮）、`:77`（问题入口）
- `bridge-plugin/lib/routes.js:75-83`（占位页）、`:166-167`（report.html 空态）
- `bridge-plugin/lib/lab-cli.js`（`runLabVerify`，控制路由应复用它）
