# 任务书 · 桥接插件原型（B 方案）

> 面向：实施 AI（审查由另一个会话负责，审查方只审不改）
> 基线提交：`dc52f48`（tag `v0.1.0`）
> 项目：`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`
> 目标版本：官方 DSH 桌面版 `0.2.0-rc.2`（`lab runtimes` 显示 verified）

## 0. 一句话目标

做一个**极小的 DSH 桥接插件**：它自身装进 DSH 的 profile，但**实验舱本体不进 profile**；
桥接通过外部调用实验舱的 CLI（`lab verify --json`）使用它的能力与产物，并通过宿主
`webServer` 的**同源路由**把报告呈现出来。

本任务只做 **B 方案原型**，目的是回答"这条路可行不可行"，不是做完整产品。

## 1. 已确认的事实（不要重新论证，直接用）

1. **DSH 渲染进程 origin 是 `dsh-app://app`**，不是 loopback HTTP；壳里有 origin 检查
   （`src/electron-shell/main.js:200/434/466`，不符返回 403）。因此**不能**让插件面板
   直接 iframe 一个 `http://127.0.0.1:<port>` 的本地页面——那是跨 origin，且官方 app 的
   CSP 未知。正确做法是**在宿主的 `webServer` 上注册同源路由**（第三方插件
   `dsh-plugin-wallpaper-engine` 就是这么做的，已有实证）。
2. **插件合同**（仓库里的 `manifest-validator.js` / `declaration-scanner.js` 就是校验器）：
   `main` / `exports["."]` = 宿主半区；`dsh.bundle.patch` 指向 `cordis.patch.yml`
   （`- insert: [{id, name, config}]`）；可选 `exports["./client"]` + `dsh.client{inject,
   platform}` = 浏览器半区；`engines.dsh` 声明支持范围；`@deepseek-ai/dsh-*` 多为 optional peer。
3. **宿主半区最小可用样例**：`fixtures/plugins/session-seeder`（`export const name` +
   `export const inject`）已被官方 CLI 装进隔离 profile 并成功启动。
4. **实验舱的对外接口已就绪，无需改核心**：
   - `node bin/lab.js verify --plugin <spec> [--online] --json` → stdout 输出**完整
     report JSON**（`--json` 时进度行被抑制）。注意：**退出码 1 也可能是一份有效报告**
     （检查项没过），必须解析 stdout，不要因非 0 退出就丢弃。
   - `--artifacts <dir>` 指定产物目录（里面有 `report.html`、`screenshots/`）。
   - `--route /path` 可探测插件注册的 HTTP 路由（cookie 已处理）。
   - `--profile-lab <name>` 是持久 profile；**本任务的工具绝不能用它**（见 §4 红线）。
   - `lab shell --profile-lab <name> --plugin <spec> --offline --show --keep-open` 可用于人工冒烟。
5. **本仓库已导出库 API**（`src/index.js`：`runLab` / `runShell` / `locateRuntime` …），
   但跨进程桥接优先走 CLI，避免把实验舱代码 import 进 profile。

## 2. 范围

### 必须完成（B1）

新增**独立子包** `bridge-plugin/`（与实验舱同仓库，但必须是独立 npm 包，**不依赖实验舱**，
`dependencies` 与 `files` 里都不得出现实验舱源码）：

1. `bridge-plugin/package.json`：满足 §1.2 合同。参考骨架：
   `name: dsh-plugin-effect-lab-bridge`、`type: module`、`main`/`exports["."]`、
   `engines.dsh: ">=0.2.0-rc.1"`、`dsh.bundle.patch: "./cordis.patch.yml"`、
   `peerDependencies`（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-host-webserver`，按官方包实际
   名称与版本，webServer 可标 optional）、`dependencies: {}`。
2. `bridge-plugin/cordis.patch.yml`：一行 `insert`，注入 `webServer`。
3. 宿主半区 `bridge-plugin/lib/index.js`：
   - `export const name`、`export const inject = ['webServer']`（按官方实际 API 调整）；
   - **配置解析**：实验舱路径来源优先级 = 插件配置 `labPath` > 环境变量
     `DSH_LAB_HOME` > 明确报错（错误信息要告诉用户怎么配置）。Node 可执行文件同样可配；
   - **工具注册** `lab_verify_plugin`：参数 `{ plugin, online? }`，内部
     `spawn(node, [<lab>/bin/lab.js, 'verify', '--plugin', <spec>,
     ...(online ? ['--online'] : ['--offline']), '--json', '--artifacts', <稳定目录>])`，
     设硬超时（建议 ≤ 240s），解析 stdout JSON，返回**摘要**（ok、runId、失败检查项、
     关键词、report.html 路径）。**懒执行**：只在该工具被调用时跑，绝不在宿主启动时跑。
   - **同源路由**：`GET /dsh-lab-bridge/latest/report.html`（以及截图等静态资源），从
     artifacts 目录读取**最近一次**报告并返回；路由前缀不得与现有插件冲突。
4. 单元测试：配置解析（三种来源 + 缺失报错）、命令构造（online/offline、artifacts）、
   report JSON 解析（含退出码 1 的有效报告、非 JSON 输出、超时）。

### 应完成（B2，能做更好）

- client 半区：一个最小插槽展示"最近一次验证"的摘要与报告入口。
  **先确认官方 CSP 是否允许同源 iframe**；不确定时**优先用 DOM 渲染摘要 + 链接**，
  不要赌 iframe。

### 明确不做（防止范围蔓延）

不做 `lab serve` 常驻服务、不搬实验舱 GUI、不做实时日志流、不改实验舱核心行为、不把
实验舱发布到 npm、不实现 profile 管理 UI。

## 3. 交付物

1. `bridge-plugin/`（package.json + cordis.patch.yml + 宿主半区 + 测试；B2 含 client 半区）。
2. `docs/BRIDGE-PLUGIN-RESULTS.md`：**实测结论**，必须回答：
   - 官方 app 是否允许同源 iframe / 官方 CSP 的实际取值（怎么测的）；
   - `defineTool` 与 `ctx.slots.register` 在 0.2.0-rc.2 里的**真实签名**（从哪个文件核实的）；
   - 路由是否真的同源可用（用 `--route` 的实测输出）；
   - 本方案哪些部分自动化验证、哪些只能人工验证。
3. 提交（每个可独立验证的步骤一个提交）。

## 4. 硬性要求与红线

- **实验舱不能进 profile**：桥接被安装后，隔离 profile 的 `node_modules` 里必须有桥接包、
  **没有** `dsh-plugin-effect-lab`。
- **绝不让实验舱写真实 home**：工具调用实验舱时**不得**传 `--profile-lab`，也不得设置
  `DSH_HOME` 指向真实 `~/.dsh`；必须保持实验舱默认的临时隔离 home 行为。
- 不修改官方安装目录（`app.asar` 只读）、不启动真实 `desktop` profile、不读取凭据/sessions/settings。
- 不在宿主启动路径里做重活（`fiber pending` 是已知 fatal 签名），一律懒执行。
- 每处新增断言都要**反向验证**：把实现回退后对应测试会红。
- 单元与集成测试必须在**普通终端**运行（沙箱内 spawn/taskkill 会被拒，报 `spawn EPERM`）。
- 报告与提交信息用中文说明改了什么、修的是哪一项。

## 5. 验收标准（可执行）

1. `node bin/lab.js doctor` → PASS。
2. `node bin/lab.js verify --plugin .\bridge-plugin --offline` → 桥接能装进隔离 profile 并启动，
   检查项全绿（这一条同时就是插件合同的自检）。
3. 安装桥接后的隔离 profile：`node_modules` 有桥接包、无实验舱本体（把断言写进测试）。
4. `node bin/lab.js verify --plugin .\bridge-plugin --offline --route /dsh-lab-bridge/latest/report.html`
   → 路由探测通过（状态码符合预期）。
5. `npm test` 与 `$env:DSH_LAB_E2E='1'; npm run test:e2e` 全绿（在基线 203 / 17 之上只增不减）。
6. 人工冒烟（记录到 RESULTS）：用持久 profile 打开真实壳，确认工具可被调用、报告可见：
   `node bin/lab.js shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --keep-open`
   （工具本身能否被 agent 真正调用，属于人工验证范围，需如实记录做了/没做）。
7. `node bin/lab.js clean --dry-run` → 0 残留。

## 6. 探索项与风险（先探明再写代码）

1. **`defineTool` / `ctx.slots.register` 的真实 API**：仓库里的
   `src/declaration-scanner.js` 只是**静态正则**，不代表签名。去官方包里核实：
   - 官方 runtime 安装目录下的 `resources\app.asar`（只读，可解包/搜索）；
   - 已安装的第三方插件实物：
     `.lab-profiles\dev\home\profiles\lab-dev\node_modules\dsh-plugin-wallpaper-engine\lib\`
     （`index.js` 宿主半区、`client.js` 浏览器半区，是最好的参照）。
2. **CSP / iframe**：先实测官方 app 是否允许同源 iframe；不允许就走 DOM 渲染。
3. **路径发现与版本偏斜**：桥接↔实验舱的 JSON 契约要定版；实验舱升级后格式变化要有兼容或
   明确报错。
4. **本地控制面的安全**：如果后续（不在本任务内）加 HTTP 控制 API，必须只绑 127.0.0.1、
   带 token、拒绝非 loopback。
5. **平台约束不变**：Windows + 官方 DSH + Node ≥ 22。

## 7. 建议实现顺序

1. 先探明 `defineTool` / `slots.register` / `webServer` 的真实 API，写进 RESULTS（此步不写业务码）。
2. 搭 `bridge-plugin/` 的合同骨架，用 `lab verify --plugin .\bridge-plugin --offline` 把它跑绿。
3. 实现配置解析 + 命令构造 + 报告解析 + 单测（此步可脱离真实 DSH）。
4. 实现 `lab_verify_plugin` 工具（懒执行、超时、摘要）。
5. 实现同源报告路由，用 `--route` 验证。
6. （可选 B2）client 半区插槽；先测 CSP。
7. 人工冒烟 + 写 `docs/BRIDGE-PLUGIN-RESULTS.md`。

## 8. 审查方会怎么查

审查会话会独立复核：`git log`/diff 是否与报告一致、`lab verify` 与 `--route` 是否真跑过、
"实验舱不在 profile 里"是否被断言、反向验证是否成立、有无偷偷把实验舱塞进 dependencies、
有无触碰真实 `~/.dsh`。所以请把证据留在提交、测试和 RESULTS 里。
