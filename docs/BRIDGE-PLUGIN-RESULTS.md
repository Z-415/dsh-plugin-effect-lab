# 桥接插件原型（B 方案）实测结论

> 目标运行时：官方 DSH 桌面版 `0.2.0-rc.2`（`lab runtimes` / `doctor` 显示 verified）
> 原型位置：`bridge-plugin/`
> 结论：**B 方案可行**。桥接插件自身能装进隔离 profile 并启动；实验舱本体不在
> profile 里；宿主工具懒执行外部 `lab verify`；报告经宿主 `webServer` 同源路由返回。

## 1. 官方 API 的真实签名与出处

签名全部从随官方桌面版分发的实物代码核对，不使用仓库里的静态正则
（`src/declaration-scanner.js` 只做文本扫描，不代表签名）。

### 1.1 `defineTool` 与 `ctx.tools.register`

- `defineTool(options)`：`app.asar!/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`
  第 838–887 行。
  - `options` 至少 `{ name, description, parameters, output: { schema, render }, execute }`；
    可选 `timeoutMs`、`deferLoading`、`finalizeContent`、`projectContent`、`presentCall`、
    `presentResult`、`isConcurrencySafe`。
  - `parameters` 是隐式属性表 DSL（可写 `type`、`required: true`、`description`、`enum`、
    `items`、`properties`）；`output.schema` 是同一套 value schema DSL。
- `ctx.tools.register(definition)`：`.../dsh-tools/lib/types/index.js` 第 459–480 行。
  - 要求 `output` 是 `{ schema, render, presentationMeta? }`；返回精确注销的 disposer。
  - 服务名是 `tools`。官方样例 `.../dsh-tool-todo/lib/index.js` 第 3、95 行用
    `import { defineTool } from "@deepseek-ai/dsh-tools"` + `ctx.tools.register(defineTool({...}))`；
    同文件第 12 行 `inject = ["tools", ...]`。
- 桥接采用：`inject = ['webServer', 'tools']`，`tools.register(defineTool({...}))`。

### 1.2 `ctx.slots.register` 与 `ctx.slots.inject`

- `slots.register(options, component)`：`app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`
  第 163–243 行。第 2 个参数是槽位 React 组件；`options` 按槽位种类取 `key`（keyed）、
  `id`（list）、`order`、`label`、`priority`、`select`（chain）等；返回 disposer。
  槽位必须先被父级声明，否则抛 `slot "<name>" is not declared`。
- 浏览器半区服务名是 `slots`，能力门是 `ctx.slots.inject(slotKey, callback)`。
  实物参照 `.../dsh-plugin-wallpaper-engine/lib/client.js`：
  第 3513–3514 行 `ctx.slots.inject("sidebar.right.pane.tab", ...)`；
  第 3555 行 `ctx.slots.register({ name, key }, () => React.createElement(...))`；
  第 17706–17713 行 `ctx.slots.inject("settings.section", () => ctx.slots.register(
  { name: "settings.section", id, order, label }, ...))`。
- 浏览器半区合同：`window.__ModuleLoader__.load({ id, factory })`，factory 返回
  `{ apply, inject }`；`package.json` 里 `dsh.client.inject = ["@deepseek-ai/dsh-client-runtime"]`、
  `dsh.client.platform = "web"`，浏览器 `inject = ["slots"]`。
- 桥接采用：`settings.section` 槽位（`id: effect-lab-bridge`，`order: 600`）。

### 1.3 `webServer.register`

- `ctx.webServer.register(route)`：`app.asar!/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`
  第 177–184 行。`route = { kind: 'exact' | 'prefix', path, handler }`；重复
  `(kind, path)` 抛错；返回 disposer。路由匹配先 exact 全等，再 longest-prefix-wins
  （第 323–332 行）；handler 拥有完整 `(req, res)` 生命周期（第 227–245 行）。
- 实物参照：wallpaper-engine 第 2561 行读 `ctx.webServer`、第 2824 行起多处
  `webServer.register({ kind, path, handler })`，其 `inject = ['webServer']` 在第 2544 行。
- 桥接采用：`kind: 'prefix'`、`path: '/dsh-lab-bridge'`；`apply` 只注册处理器，
  真正读文件发生在请求到达时。

## 2. CSP / iframe 实测结论

来源：`app.asar!/lib/main.js`。

- 自定义 scheme（第 11019–11029 行）：`dsh-app` 具备 `standard: true, secure: true,
  supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true`。
- 主窗口 `webPreferences`（第 11099–11107 行）：`nodeIntegration: false,
  contextIsolation: true, sandbox: true, webSecurity: true`。
- `protocol.handle('dsh-app', ...)`（第 11542–11551 行）：`dsh-app://app/` 下 index/assets
  由打包前端直出，其余路径经 `forwardWebRequest` 转发到 loopback Host。
- `serveWebDocument` **没有**设置 `Content-Security-Policy`，也没有 `X-Frame-Options`；
  打包前端 `dsh-web-frontend/dist/index.html` 里也**没有** CSP meta。
- `forwardWebRequest`（第 7461–7475 行）：请求若带 `Origin` 且不是 `dsh-app://app`，
  直接 403。这就是不能让渲染进程直接 iframe loopback 本地端口的原因。
- `setWindowOpenHandler`（第 11109–11111 行）：只有 `http:`/`https:` 交给系统浏览器，
  其余一律 `deny`；所以指向 `dsh-app://app/...` 的 `target="_blank"` 在桌面壳里不会打开。

结论与取舍：

- **官方 app 未发现限制同源 iframe 的 CSP**；但本轮**没有**在真实 Electron 壳里实际渲染
  `dsh-app://app/...` 的 iframe，这一条仍属人工验证范围（见 §4）。
- loopback 是跨 origin 且被 origin fence 挡住，所以正确传输是宿主同源路由，桥接按此实现。
- 桥接给报告路由加了自己的 CSP：`default-src 'none'; style-src 'unsafe-inline';
  img-src 'self' data:; font-src 'self' data:; script-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'self'`。
- client 半区主入口刻意不赌 `dsh-app` iframe：用普通 DOM 渲染摘要，并把它自己 fetch 到的
  自足报告 HTML（截图是 data URI、无脚本）放进 `sandbox=""` 的 `srcdoc` iframe 做内嵌预览；
  同时保留 `/dsh-lab-bridge/latest/report.html` 这个同源页面入口。

## 3. 同源路由实测输出

命令（真实运行，退出码 0）：

```text
node bin/lab.js verify --plugin .\bridge-plugin --offline --route /dsh-lab-bridge/latest/report.html --json --artifacts artifacts/bridge-smoke
```

该次 JSON 报告里的路由条目（原样摘录）：

```json
{
  "name": "/dsh-lab-bridge/latest/report.html",
  "url": "http://127.0.0.1:2499/dsh-lab-bridge/latest/report.html",
  "status": 200,
  "classification": "ok",
  "expected": ["ok", "auth-fence", "redirect"],
  "pass": true,
  "durationMs": 18,
  "error": null
}
```

同一次报告的其它关键证据：

```json
{
  "plugin-postcheck": "pass: installed manifests are compatible",
  "routeCheck": "status 200 (ok)",
  "pluginFindings": [],
  "declaredToolNames": [{ "file": "lib/index.js", "name": "lab_verify_plugin" }],
  "declaredSlotKeys": ["settings.section"],
  "profilePackages": ["dsh-lab-session-fixture", "dsh-plugin-effect-lab-bridge"],
  "browser": { "consoleErrors": [], "pageErrors": [] }
}
```

`profilePackages` 里没有 `dsh-plugin-effect-lab`：实验舱本体没有进 profile。

另外补测了**不带 cookie** 的同源路由：`cookie:false` 访问
`/dsh-lab-bridge/latest/report.html` 实测 `status 200 (ok)`
（测试日志：`[bridge] no-cookie report.html -> status 200 (ok)`）。宿主 index 无 token 会
401，但插件路由不在宿主 auth fence 之后；在 loopback 上可被同机进程无 cookie 读取，
已列入残余风险。

## 4. 自动化验证 / 人工验证

已自动化验证：

- `node bin/lab.js doctor` → PASS（0.2.0-rc.2 verified）。
- `npm test` → **237** 通过（基线 203 + 桥接/实验舱修复单测 34）：桥接的配置优先级、
  缺失报错、命令构造（默认 `--offline`、绝不含 `--profile-lab`）、`--json` 退出码 1 仍解析、
  非 JSON、超时（进程树 kill）、报告摘要、路径穿越、无报告占位；shell-result 缺失的可读
  结论；`prepareArtifacts` 绝对化；boot-readiness；MIME/CSP/nosniff。
- `$env:DSH_LAB_E2E='1'; npm run test:e2e` → **23** 通过（基线 17 + 新增 6）：
  - 桥接进 profile / 实验舱不进 profile；
  - bridge 同源路由 200（含 no-cookie 200）；
  - 壳缺 `shell-result.json` 时可读失败；
  - 相对 `--artifacts` 根目录下壳仍能把结果写回 runner 读取的位置；
  - 发布 URL 但端口未监听时 `boot-listening` fail fast；
  - B2：设置页出现「实验舱桥接」，点击后显示种子 runId、出现「内嵌查看报告」按钮，
    点击后挂载 `iframe[title="实验舱报告"]` 且 srcdoc 含种子报告 HTML。
- `node bin/lab.js verify --plugin .\bridge-plugin --offline --route /dsh-lab-bridge/latest/report.html`
  （相对 `--artifacts artifacts/bridge-final`）→ `ok=true`、route 200、runDir 为绝对路径、
  profile 无实验舱、console/page error 0。
- `node bin/lab.js clean --dry-run` → `would remove 0 dir(s), would reap 0 of 0 lab process(es)`。

反向验证（把实现回退后断言变红）：

1. 配置改成 env 优先 → `labPath wins over DSH_LAB_HOME` 变红。
2. 退出码 1 丢弃 stdout → `a non-zero exit code still yields the report parsed from stdout` 变红。
3. 命令加入 `--profile-lab` → 红线断言变红。
4. 移除路径穿越防护 → `path traversal is rejected` 变红。
5. 把实验舱临时声明为桥接依赖 → `installing the bridge never puts the lab itself into the
   isolated profile` 变红。
6. 移除 `prepareArtifacts` 的 `path.resolve` → 相对 `--artifacts` 壳集成测试变红。
7. 移除 `result?.derivedInjections` 的 `?.` → 缺结果集成测试变红（report.shell 为 null）。
8. 强制 `boot-readiness` 的 `listeningPass=true` → boot-readiness 单测与 fail-fast 集成
   断言变红，并复现约 95s 的 `fetch failed` 级联。
9. 移除 SVG 的 CSP 分支 → svg 路由单测变红；移除 Windows `taskkill` 分支 → taskkill 单测变红。

### 4.1 `shell-result.json` 为 null 的根因与修复

**现象**：`lab shell --profile-lab ... --show` 报告 `shell-result: missing`，随后
`result.derivedInjections` 抛 TypeError，掩盖了本来正确的 missing 结论。

**排查**：壳子进程 exitCode=0、stderr 为空，但 `%TEMP%\dsh-lab-electron-44.0.0\artifacts\...`
下能看到每一次“失败”运行写出的 `shell-result.json` 和 `shell.png`。

**根因**：`--artifacts` 传相对路径时，`prepareArtifacts` 生成相对 `runDir`，
`shell-config.json` 里的 `resultFile`/`screenshotFile` 也是相对路径；壳子进程的 cwd 是复制出的
运行时目录（`%TEMP%\dsh-lab-electron-*`），于是它把结果写到了自己的 cwd 下，父进程在仓库
cwd 下读不到 → `result=null`。默认 artifacts（`<cwd>/artifacts`，绝对）或显式绝对
`--artifacts` 不受影响。

**修复**：`prepareArtifacts` 把 artifactsRoot 解析为绝对路径；`shell-runner` 对 result 加可选链，
`shell-run` 失败描述引用 `shell-result` 并带壳进程 exitCode/stderr；`report.shell` 增加
`childExitCode`。修复后原始命令
`node bin/lab.js shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --show-hold 10000`
实测 `ok=true`、壳结果写回、console/page error 0。

### 4.2 B2 实机与前端验证

- 真实可见壳：`lab shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --show-hold 10000`
  → `ok=true`，壳结果写回，`consoleErrors=[]`、`pageErrors=[]`，
  截图 `artifacts/20261005T135819Z-913e26/screenshots/shell.png`。
- 设置页分区：`lab verify --plugin .\bridge-plugin --offline --screenshot settings` 打开真实前端
  设置页，截图 `artifacts/b2-settings/20261005T140608Z-9e3783/screenshots/settings.png`
  中可见左侧导航项**「实验舱桥接」**；`settings-ui` 检查通过、console/page error 0。
- 摘要刷新 + 内嵌预览：集成测试 `tests/integration/bridge-client-settings.test.js` 在隔离 Host
  里预置一份报告，点击「实验舱桥接」后断言摘要显示该 runId、出现「内嵌查看报告」按钮，
  点击后挂载 `iframe[title="实验舱报告"]` 且 srcdoc 含预置报告 HTML。该测试随 e2e 全绿。

只能人工验证 / 本轮未完成：

- **工具被 agent 真正调用**：需要真实 DSH 会话里让模型调用 `lab_verify_plugin`，本轮未做
  （自动化隔离 Host 不驱动模型工具调用）；工具命令构造与报告解析有单测，路由与摘要/预览
  有集成测试。
- **真实 `dsh-app://app` iframe 渲染**：只做了源码级结论；client 用 srcdoc 预览规避了
  dsh-app iframe 这一未实测路径。
- **`--show --keep-open` 的人工交互**：可见壳已成功启动并截图，但“人手动点击”的完整
  keep-open 流程未在本轮由人操作；B2 的分区/摘要/预览已由 §4.2 的自动化测试覆盖。

## 5. 红线遵守情况

- 工具命令永不传 `--profile-lab`（单测断言），也不设置 `DSH_HOME`；实验舱保持默认临时
  隔离 home。
- `bridge-plugin/package.json` 的 `dependencies == {}`，`files` 不含实验舱源码；集成测试
  断言 profile `node_modules` 无实验舱。
- 宿主启动路径不做重活：`apply` 只注册路由与工具；配置解析、spawn、读文件全部推迟到
  工具调用或路由请求时。
- 未修改官方安装目录；未启动真实 `desktop` profile；真实 `~/.dsh` 结构文件哈希在每轮
  `lab verify` 前后一致（`real-home-unchanged`）。

## 6. 残余风险

1. **JSON 契约未带版本号**：桥接按 `runId/ok/checks/signatureHits/artifacts` 读取；实验舱
   升级若改字段名，工具会退化为“摘要缺项”。建议后续在 report 顶层加 `schemaVersion`。
2. **超时已改用进程树 kill**：`runLabVerify` 超时在 Windows 走 `taskkill /PID <pid> /T /F`，
   非 Windows 走 `SIGKILL`；若 taskkill 因权限/时序失败，仍应配合 `lab clean` 兜底。
3. **`@deepseek-ai/cordis` peer 范围不被 validator 校验**：名称不匹配
   `^@deepseek-ai/dsh-`；实际运行时按 `~4.0.4` 声明。
4. **自动探测是“就近”语义**：同仓布局下桥接自动把父目录当实验舱；单独拷走
   `bridge-plugin` 会回落到显式配置错误，这是刻意行为。
5. **默认 artifacts 在 `os.tmpdir()`**：同机多次实验共用 `dsh-lab-bridge-artifacts`，
   “latest”按 mtime 取最新；并发多实例需显式 `DSH_LAB_BRIDGE_ARTIFACTS` 隔离。
6. **插件路由无 cookie 实测 200**：`/dsh-lab-bridge/latest/*` 不在宿主 auth fence 之后，
   同机进程可无 cookie 读取报告；当前只绑 loopback，风险有限，但后续若加入 HTTP 控制面
   必须加 token 并拒绝非 loopback。
7. **boot-listening 已 fail fast**：宿主“打印 URL 但端口未监听”的既有 flake 根因未在官方
   宿主侧修复，现在只是更快、更清楚地失败，并保留 boot 日志末尾。
8. **相对 artifacts 的壳结果写错目录已修**：同类风险是任何以自定义 cwd spawn 的子进程
   若拿到相对路径都可能写到别处；`prepareArtifacts` 现在统一输出绝对路径。
