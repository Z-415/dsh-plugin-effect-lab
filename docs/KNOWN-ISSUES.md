# 已知问题 / 暂缓修复

> 目的：把"已经知道、但暂时决定不修"的问题固定记录在一处，避免下一任接手重复排查或误判。
> 每条写清：现象、证据、根因、触发条件、临时规避、建议修法、什么时候该修。

## 1. rich 夹具的渲染探针在满负载下偶发 `codeFound=false`（暂缓）

**现象**：全量 `npm run test:e2e` 偶发 1 条红：

```text
✖ tests/integration/fixture-variants.test.js:46
  the rich fixture renders a reasoning block and a fenced code block
  "detail": "codeFound=false", "informational": false
```

**证据（2026-10-07 复核）**：

- 完整 e2e 跑出 1 条红，就是这条；随后单独复跑
  `tests/integration/fixture-variants.test.js` → **3/3 全过**（empty / long / rich 各约 11s）。
- 同一轮复核里 `clone-profile.test.js` 4/4、单元 360/360 都通过。

**根因**：rich 变体的渲染探针是**一次性读取**，没有有界轮询：

```js
// src/runner.js:684-693  fixturesAfter.fixtureText
const text = document.body ? document.body.textContent : '';
reasoningFound: text.includes(<reasoning 前 60 字>),
codeFound:     text.includes(<code 第一行>),
```

它作为 `probesAfter` 在交互后立刻执行；机器一忙，代码块还没挂载就被采成 `codeFound=false`。
而 `fixture-code-rendered`（`src/runner.js:742-743`）在 profile 不含第三方插件时是**硬检查**，
于是整条用例判红。

**触发条件**：整套 e2e 连续跑（满负载）时才出现；单独跑该文件稳定通过。

**临时规避**：单独复跑 `tests/integration/fixture-variants.test.js` 即转绿。不影响产品功能——
夹具数据本身一直是对的（`fixture.codeFences` / `contentBlockTypes` 等断言先过，红的只是 UI 文本探针）。

**建议修法**（等它真的碍事再修）：

- 把 rich 文本探针改成**有界轮询**（最多等 5–10 秒直到 `codeFound` 为真），与
  `waitForStableUi` 同一类做法；
- 或把 `fixture-thinking-rendered` / `fixture-code-rendered` 降级为提示，把证据写进报告；
- 反向验证：去掉轮询后该用例应重新变红。

## 2. 修复前创建的 clone 仍带旧 manifest 名（需一次性重建）

`1850f66` 之后新建的 clone 会写 `dsh-profile-<目录名>`；但**修复前**创建的持久 clone
（本机 `web-clone` / `desktop-clone`）里仍是 `dsh-profile-web` / `dsh-profile-desktop`，
不会自动更新。要让它们获得修复，需要重新克隆（`--force` 覆盖重建）：

```powershell
node bin/lab.js verify --clone-to web-clone --clone-profile web --force --clone-accept-risk --online --no-fixture
```

这不是待修 bug，而是升级到 `1850f66` 后的一次性动作；记在这里免得下次又被
"壳窗口看不到夹具会话"绊住。

## 3. 其它既有残余风险（不在此重复展开）

- 真实 desktop profile 的完整 clone+boot 未做自动化端到端；
- `npm:` / `github:` 的**成功联网安装**未固定进测试；
- 诊断脱敏是模式匹配 + 只从 report 派生；
- `removeLabProfile` 的"被占用"判断依赖 OS 错误码。

详见 `docs/TASK-LAB-V2-RESULTS.md` 与 `docs/HANDOFF-LAB-V2-AND-CLONE.md` 的"残余风险"节。
