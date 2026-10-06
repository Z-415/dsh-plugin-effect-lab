# 交接开场白 · 克隆 profile 里壳窗口看不到夹具会话

> 把下面整段复制给实施 AI。

---

安装诊断与清理两项已修好并推送（`6aa4a57`）。现在还剩**唯一一个红项**：e2e 45 项里 `tests/integration/clone-profile.test.js` 的"`--clone-to` 持久化并复用"最后一步失败——`lab shell --profile-lab clone-web --show` 打开时夹具会话没展开：

```
[失败] shell-fixture-session:  workspace=true, session=false, mount=false
[失败] shell-fixture-thinking: reasoningFound=false
[失败] shell-fixture-code:     codeFound=false
```

请先读 `docs/TASK-CLONE-SHELL-FIXTURE.md`（含已核实事实、待查项与验收），再动手。

已知范围（我实测过，不用重复）：

- `desktop-clone` / `dev` / 全新一次性 profile 的壳窗口**都 ok=True 全绿**；只有克隆出来的 profile 失败。
- 克隆**会**裁剪 bundle（`--clone-plugins none` → deps=1 / bundles=2），所以不是"bundle 指向未装依赖"。
- 但克隆**原样复制**真实 profile 的 `cordis.patch.yml`：实测 `web-clone` 的补丁行 = 真实 web 的 7 行 + seeder 1 行 = 8 行，包含未安装插件的行（`plugin-store` / `dsh-session-manager` / `llm-pi-ai` / `ui-settings-general` 等）。
- 夹具本身正常：`fixture-workspace` 通过、事件确实 seed 了；失败在壳窗口没选中/展开夹具会话。
- 仓库里旧的 `web-clone`（带 20 个真实插件）失败是另一回事：`LAB-CLIENT-001`（某插件注册 `list slot "conversation.chat.turnTail"` 缺 `options.id`）+ `dsh-vscode-bridge failed to import` —— 那是**真实 web profile 自身不兼容**，别和夹具问题混在一起。

先取证再改：① 失败时壳窗口停在什么状态（onboarding？workspace 空？会话行存在但点不中？）——把 DOM 状态写进报告；② 对照 `--clone-plugins none` 克隆 vs 全新最小 profile，以及"把克隆的 cordis.patch.yml 清成只留 seeder 行"看夹具是否恢复。

首选修法：`--clone-plugins none` / `--clone-exclude X` 时同步裁剪 `cordis.patch.yml` 里对应被排除插件的行（或加 `--clone-patch none|same`）；同时让壳窗口的夹具自动打开更健壮，并在失败时把 workspace 列表/onboarding 标志写进报告。验收：那条 e2e 变绿；`lab shell --profile-lab clone-web` 的 `shell-fixture-session` / thinking / code 全过；全量克隆若因真实插件不兼容而红，要明确归因而不是报成夹具失败。每项补测试 + 反向验证、单独提交、普通终端跑测试（沙箱 spawn EPERM）。
