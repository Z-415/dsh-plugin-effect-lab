# 交接开场白 · 实验舱 V2 六项增强

> 把下面整段复制给实施 AI。

---

用户提了 6 项增强，评估与实施方案写在 `docs/TASK-LAB-V2-ENHANCEMENTS.md`，请先完整读它，再按 §7 的顺序做。要点：

1. **复制用户真实 profile 作为起点**（`--clone-profile web|desktop`）：只复制结构文件（package.json / cordis.yml / cordis.patch.yml / pnpm-workspace.yaml / pnpm-lock.yaml / patches/），不要复制 `node_modules`；绝不能复制 `.credentials.yaml`、`settings.yaml`、`sessions/`、`agents/`；要有"真实 home 哈希前后不变 + 隔离 home 无凭据"的硬断言；`file:` 本地插件与"克隆后起不来"要如实报告，并提供 `--clone-plugins none` / `--clone-exclude <plugin>` 降级。
2. **默认对话 / 思考 / 代码块夹具**：`session-seeder` 已经能写真实事件，新增 `rich` 变体加 thinking 块 + fenced 代码块。**先探明 0.2.0-rc.2 里 thinking 的真实表示**（是 content 里的 `{type:'thinking'|'reasoning'}` 块还是独立事件），写错类型前端不渲染。
3. **profile 列表 UI**：`lab profile list --json` 已有 name/dir/plugins/createdAt/mtimeMs，做成 GUI 里的列表 + 行内操作（打开/卸载/删除/打开目录），删除必须继续走 junction 安全的 `removeTreeSafely`。
4. **更多安装方式 + 真实包名回显**：`plugin-resolver` 已支持 `github:` 与 GitHub URL，缺的是 `npm:` 前缀、`#ref` 透传、以及安装后回显"真实 name@version"（作者宣称名 ≠ 真实包名的痛点）；GUI 加来源下拉。
5. **错误码 + 让 DSH 诊断**：给 22 条签名分配稳定错误码（`LAB-BOOT-001` 之类）并写进报告；新增脱敏的 `--diagnostics-bundle`；桥接插件加 `lab_diagnose` 工具，把结构化诊断交给用户的 DSH agent 解释（lab 出证据，DSH 出解释）。
6. **进度条 / 动画**：把 `onProgress` 升级成 `{phase,index,total,detail}`，GUI 渲染真实进度 + 长等待的不确定动画 + 已用时间；CLI 加 `[3/8]` 步骤前缀。**不要谎报百分比**。

硬性要求：每项都要单元 + 集成测试并做反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）；报告保持中文；错误码与阶段名要写进文档。完成后给出改动文件、每个提交的哈希、验证命令与真实输出、残余风险。
