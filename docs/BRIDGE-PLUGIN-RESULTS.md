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

## 4. 自动化验证 / 人工验证

已自动化验证：

- `node bin/lab.js doctor` → PASS（0.2.0-rc.2 verified）。
- `npm test` → **225** 通过（基线 203 + 桥接单测 22）：配置优先级、缺失报错、命令构造
  （默认 `--offline`、绝不含 `--profile-lab`）、`--json` 退出码 1 仍解析、非 JSON 输出、
  超时、报告摘要（失败项/关键词/报告路径）、路径穿越防护、无报告占位页。
- `$env:DSH_LAB_E2E='1'; npm run test:e2e` → **19** 通过（基线 17 + 桥接 2）：
  - `installing the bridge never puts the lab itself into the isolated profile`：断言
    profile `package.json` 有桥接、`node_modules` 有桥接、**没有** `dsh-plugin-effect-lab`，
    且桥接自身 `dependencies == {}`、不引用实验舱；
  - `lab verify installs the bridge and the same-origin report route answers 200`：真实起
    隔离 Host 并探测 `/dsh-lab-bridge/latest/report.html`。
- `node bin/lab.js verify --plugin .\bridge-plugin --offline` 系列：插件合同 0 blocker /
  0 warning，路由探测 200，工具名被声明扫描器识别，client 半区加载无 console/page error。
- `node bin/lab.js clean --dry-run` → `would remove 0 dir(s), would reap 0 of 0 lab process(es)`。

反向验证（把实现回退后断言变红）：

1. 配置改成 env 优先 → `labPath wins over DSH_LAB_HOME` 变红。
2. 退出码 1 丢弃 stdout → `a non-zero exit code still yields the report parsed from stdout` 变红。
3. 命令加入 `--profile-lab` → 红线断言变红。
4. 移除路径穿越防护 → `path traversal is rejected` 变红。
5. 把实验舱临时声明为桥接依赖 → `installing the bridge never puts the lab itself into the
   isolated profile` 变红。

只能人工验证 / 本轮未完成：

- **工具被 agent 真正调用**：需要真实 DSH 会话里让模型调用 `lab_verify_plugin`，本轮未做
  （自动化隔离 Host 不驱动模型工具调用）。
- **client 槽位视觉效果**：注册已被声明扫描器识别、client 加载无报错，但“打开设置页看到
  摘要 + 内嵌报告”的观感未做视觉验收。
- **持久 profile 的 `lab shell` 人工冒烟**：本轮尝试了
  `node bin/lab.js shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --show-hold 10000`
  以及无插件对照运行，都在 Electron 壳写回结果前失败：
  `TypeError: Cannot read properties of null (reading 'derivedInjections')`
  （`src/electron-shell/shell-runner.js:559`，`result` 为 null，即未生成 `shell-result.json`）。
  **不带桥接插件的对照运行同样失败**，且仓库自带 shell e2e（直接调用 `runShell`）全部通过，
  因此这是 `lab shell` CLI 路径的既有缺陷，与桥接插件无关；本轮未修改实验舱核心。
- **真实 `dsh-app://app` iframe 渲染**：只做了源码级结论，未在壳里实际渲染。

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
2. **超时只杀直接子进程**：`runLabVerify` 超时用 `child.kill()`，Windows 上实验舱的
   Electron/Edge 孙进程不保证随之退出；实验中应配合 `lab clean`。生产化需要进程树回收。
3. **`@deepseek-ai/cordis` peer 范围不被 validator 校验**：名称不匹配
   `^@deepseek-ai/dsh-`；实际运行时按 `~4.0.4` 声明。
4. **自动探测是“就近”语义**：同仓布局下桥接自动把父目录当实验舱；单独拷走
   `bridge-plugin` 会回落到显式配置错误，这是刻意行为。
5. **默认 artifacts 在 `os.tmpdir()`**：同机多次实验共用 `dsh-lab-bridge-artifacts`，
   “latest”按 mtime 取最新；并发多实例需显式 `DSH_LAB_BRIDGE_ARTIFACTS` 隔离。
6. **`lab shell` CLI 既有缺陷**见 §4，会挡住“持久 profile + 可见壳”的人工冒烟；
   不影响 `lab verify` 与 e2e shell 路径。
