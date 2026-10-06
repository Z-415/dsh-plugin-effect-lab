# 任务书 · 克隆 profile 里壳窗口看不到夹具会话

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main` @ `6aa4a57`（安装诊断 + 清理修复已推送）

## 0. 现象

全量 e2e 目前 **45 项 44 通过**，唯一红项是 `tests/integration/clone-profile.test.js` 里
"`--clone-to` 持久化并复用"的**最后一步**：

```text
$ lab shell --profile-lab clone-web --no-compare-web --show --show-hold 3000
[失败] shell-fixture-session:  workspace=true, session=false, mount=false
[失败] shell-fixture-thinking: reasoningFound=false (926 chars)
[失败] shell-fixture-code:     codeFound=false
```

该用例**前面的断言全部通过**（`persistent`、`clonedFrom`、同名拒绝、`--force`、
一次性提示、`clone-real-profile-unchanged` / `clone-no-credentials` / `real-home-unchanged`），
清理相关检查（`cleanup-*`）也全部通过。失败点只在"**克隆出来的 profile 里，壳窗口没有打开夹具会话**"。

我实测对照（普通终端）：

| profile | 壳窗口结果 |
|---|---|
| `desktop-clone`（26 插件） | **ok=True 全绿** |
| `dev` | **ok=True 全绿** |
| 全新一次性（无 profile） | **ok=True 全绿** |
| 克隆出来的 profile（e2e 的 `clone-web`，`--clone-plugins none`） | ❌ `shell-fixture-session` / thinking / code |
| 仓库里旧的 `web-clone`（带 20 个真实插件） | ❌ 但原因是 `LAB-CLIENT-001`（见下），**不是同一件事** |

⚠️ `web-clone` 那个失败是**真实 web profile 自身的问题**：某插件注册
`list slot "conversation.chat.turnTail"` 却没给 `options.id`，被 0.2.0-rc.2 拒绝；
`boot.err` 里还有 `dsh-vscode-bridge failed to import`。这属于克隆"如实反映真实环境"，
**不要**把它和"夹具打不开"混为一谈。

## 1. 已核实的事实（缩小范围，别猜）

1. **克隆会裁剪 bundle**：`--clone-plugins none` 实测 `dependencies=1`、`bundles=2`
   （只保留 `@deepseek-ai/dsh-base` + `dsh-web-app`）。所以不是"bundle 指向未安装依赖"。
2. **但克隆原样复制 `cordis.patch.yml`**：实测 `web-clone` 的补丁顶层行 = 真实 web 的 7 行
   + 夹具 seeder 1 行 = **8 行**，包含 `plugin-store` / `dsh-session-manager` /
   `dsh-super-injector` / `dsh-obsidian-inbox` / `dsh-obsidian-agent-wiki` / `obsidian` /
   `llm-pi-ai` / `ui-settings-general`。
   ⇒ 用 `--clone-plugins none` / `--clone-exclude` 时，补丁里仍留着**未安装插件**的行。
3. **夹具本身没问题**：`fixture-workspace` 检查通过、事件确实被 seed（seeder 走官方
   session-persistence API）；失败在壳窗口**没有选中/展开夹具会话**（`session=false`、`mount=false`）。

## 2. 待查清（先取证，再改）

1. **克隆 profile 的壳窗口停在什么状态？** onboarding/英雄页？workspace 列表为空？
   还是有会话行但点不中？需要的证据：失败时的 DOM 快照（workspace 列表内容、
   `data-slot` 名称、body 文案）写进报告，别只写 `session=false`。
2. **是否由未安装插件的补丁行（dangling patch rows）造成？** 对照实验：
   - `--clone-plugins none` 的克隆 vs 一个全新最小 profile（两者都 seed 夹具，但前者带 dangling rows）；
   - 把克隆的 `cordis.patch.yml` 清成只留 seeder 那一行，看夹具是否恢复。
3. **是否与真实 profile 的某些补丁行改变 UI 初始状态有关**（`llm-pi-ai` / `ui-settings-general` 等）。

## 3. 修复方向（按取证结果选）

- **首选**：克隆时同步裁剪补丁行。`--clone-plugins none` / `--clone-exclude X` 时，
  把 `cordis.patch.yml` 里对应被排除插件的行一并去掉；或提供显式开关
  `--clone-patch none|same`，默认与被安装的插件保持一致。
- **加固**：让壳窗口的夹具自动打开更健壮——没找到会话行时，先显式选择夹具 workspace 再点；
  仍失败则把 §2.1 的 DOM 状态写进报告。
- **诊断**：`shell-fixture-session` 失败时附上 workspace 列表 / onboarding 文案 / 当前选中项。
- **区分两类失败**：报告里要能标出"因为真实插件不兼容（如 `LAB-CLIENT-001`）"还是"夹具打不开"，
  不要都归成一个笼统的失败。

## 4. 验收标准

1. e2e `clone-profile.test.js` 的 `--clone-to ... 复用` 那条**变绿**（不再挂在已知失败上）。
2. `lab shell --profile-lab clone-web --no-compare-web --show --show-hold 3000`
   → `shell-fixture-session` 通过，`shell-fixture-thinking` / `shell-fixture-code` 通过。
3. **两种克隆都验证**：`--clone-plugins none` 与全量克隆。全量克隆若因真实插件不兼容而红，
   要明确归因（`LAB-CLIENT-*` 等），而不是报成夹具失败。
4. 失败时报告带 DOM 诊断信息（workspace 列表 / onboarding 标志 / 当前选中项）。
5. 单元 + 集成测试、反向验证（例如去掉补丁行裁剪 → dangling-row 用例变红）、单独提交。

## 5. 红线

- 不掩盖"真实 profile 自身不兼容"：要区分"夹具打不开"与"插件报错"。
- 克隆仍只读真实 profile；不复制 `node_modules` / 凭据 / sessions / settings。
- 不改夹具的事件形状（`reasoning` + `reasoning-chunks` 已经实证正确）。
- 每项补测试、反向验证、单独提交、普通终端跑测试、报告用中文。

## 6. 证据

```text
e2e：tests/integration/clone-profile.test.js:181（execFileSync 的 lab shell 步骤）
     [失败] shell-fixture-session:  workspace=true, session=false, mount=false
     [失败] shell-fixture-thinking: reasoningFound=false (926 chars)
     [失败] shell-fixture-code:     codeFound=false
     其余（含 cleanup-*）全通过
实测：desktop-clone / dev / oneshot → ok=True；web-clone（带插件）→ LAB-CLIENT-001
克隆裁剪：clone-none-check deps=1 bundles=2；web-clone patch rows=8 vs 真实 web=7
```

## 7. 相关代码位置

- `src/profile-cloner.js`（复制哪些文件；是否裁剪 bundles / patch）
- `src/electron-shell/shell-runner.js`（壳里的夹具 workspace/session 选择、`shell-fixture-*` 检查）
- `src/fixture-manager.js` 与 `fixtures/plugins/session-seeder/lib/index.js`（seed 事件、workspace 注册）
- `tests/integration/clone-profile.test.js`（复现用例）
