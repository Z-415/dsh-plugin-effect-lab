# 任务书 · 桥接插件改为「启动器」（方案 A）

> 面向：实施 AI（审查由另一个会话负责）
> 背景：B 方案的内嵌报告面板在真实桌面版里体验不可用（见 `docs/TASK-BRIDGE-UX-FIXES.md`）。
> 用户决定改用更简单、更稳的形态：**插件只是一个启动键**。

## 0. 目标（用户原话的意思）

把 DSH 插件做成**一个简单的启动按钮**：点击后在外部启动整个实验舱项目（它自己的 Electron GUI）。
看起来像装了一个 DSH 插件，实际上**项目本体仍独立在 DSH profile 之外**——profile 里只有这个很小的启动器插件。

## 1. 为什么这个方案更稳（不要再退回内嵌面板）

- 不再需要同源 iframe / 报告页 / CSP 规避，也就不会再有"整页导航把 DSH 界面顶掉、无返回按钮"这类问题。
- 实验舱本来就有独立 GUI（`node bin/lab.js gui`，等价于双击 `启动实验台.cmd`），直接拉起来即可。
- profile 里只留一个小插件；实验舱的读取/隔离/清理全部在它自己的进程里完成。

## 2. 要改成什么

### client 半区（UI 极简）

- 只放**一个按钮**：「启动实验舱」（可带一行状态文字，如"已启动/启动失败：原因"）。
- **删掉**：报告链接（`bridge-plugin/lib/client.js:77` 的 `<a href>`）、内嵌 iframe 预览、
  以及任何会用 `window.location` 做顶层跳转的东西。
- 点击按钮 → `POST /dsh-lab-bridge/launch`（见下）→ 按返回结果显示状态，**不离开 DSH 界面**。

### host 半区

- 新增 `POST /dsh-lab-bridge/launch`：等价于在实验舱仓库根目录执行
  `node bin/lab.js gui`，**分离进程**启动（见 §3 的坑）。
- 可以删掉报告相关路由（`/latest*`、`report.html` 占位页）与 `readLatestReport` 的接线；
  实验舱 GUI 自己会展示报告。
- `lab_verify_plugin` 工具可以保留（已测试、零 UI 成本，agent 仍可用），也可以一并去掉；
  **如果保留，测试与红线要求不变**。

## 3. 必须处理的实现细节（都是本机实测出来的坑）

1. **不要用 `process.execPath` 当 Node**：DSH 宿主进程里它是 `D:\DeepSeek Harness\DeepSeek Harness.exe`。
   要解析真正的 `node.exe`：优先插件配置 `nodePath`，否则从 `PATH` 找
   （本机在 `C:\Program Files\nodejs\node.exe`）；找不到就返回可读错误。
2. **必须剥掉 `ELECTRON_RUN_AS_NODE`**：DSH 宿主自身带着 `ELECTRON_RUN_AS_NODE=1` 启动。
   若把它传给子进程，Electron 会被当 Node 运行，**GUI 窗口不会出现**。
   实验舱自己的 `src/process-tree.js: childEnv()` 就是这么干的，插件 spawn 时也要照做。
3. **分离启动**：`spawn(node, ['bin/lab.js','gui'], { cwd: labPath, detached: true, stdio: 'ignore', env })`
   然后 `child.unref()`。否则窗口会随请求结束被回收，或把宿主拖住。
4. **cwd 必须是实验舱仓库根目录**：GUI 会在项目目录下构建/复用 `gui-runtime/`。
5. **重复点击**：实验舱 GUI **没有单实例锁**（已确认），连点会开多个窗口、还可能同时重建
   `gui-runtime`。插件侧要加节流/去重（例如记录最近启动时间 + 检查是否已有本插件拉起的进程），
   或明确在 UI 上提示"已在启动中"。
6. **配置沿用 `labPath`**：真实 profile 里已经配好 `- id: effect-lab-bridge` + `config.labPath`
   （`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`）。如果插件 id 不变就直接复用；
   换 id 就要同步改 profile 的 `cordis.patch.yml`。
7. **`file:` 依赖是拷贝**：改完 `bridge-plugin/` 源码后，必须重新在 profile 目录跑一次
   `node "D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs" install --offline`，
   否则真实 desktop profile 里还是旧副本。
8. **鉴权**：实测 `/dsh-lab-bridge/latest/*` **不带 cookie 也 200**，插件路由不在宿主 auth fence 之后。
   `POST /launch` 是状态变更接口，必须：只接受 loopback + 校验一个由 host 生成、client 拿到的 nonce/token；
   不能做成任何人 POST 一下就弹窗的接口。

## 4. 验收标准

1. 点面板里的按钮 → **实验舱 GUI 在外部打开**；DSH 界面保持不变（`window.location` 不变）。
2. UI 里**没有**任何报告链接、iframe、或会整页跳转的入口。
3. 连点/重复点击不会疯狂开窗（有节流或明确提示）。
4. 失败可读：缺 Node、`labPath` 不存在、启动异常，都要在面板上显示原因，而不是静默失败。
5. `POST /launch` 有 nonce/loopback 校验；无 token / 非 loopback 被拒（补测试）。
6. profile 里仍然只有小插件，**实验舱本体不在 profile**（回归断言保留）。
7. 单元 + 集成测试；每处断言做反向验证；测试在普通终端跑（沙箱 spawn EPERM）。
8. 在**真实桌面版**里人工确认一次：设置 → 插件 → 实验舱桥接 → 点按钮 → 外部窗口出现。

## 5. 红线（不要破坏）

- 实验舱本体不进 profile；插件**永不**传 `--profile-lab`、不把 `DSH_HOME` 指向真实 home。
- 不修改官方安装目录；不启动真实 `desktop` profile 做自动化测试。
- 不把启动做成"任意命令执行"接口（固定 `bin/lab.js gui`，不要接受用户传入的任意 argv）。
- 每步补测试、单独提交、报告用中文。

## 6. 现场信息

- 真实 profile 已装旧版桥接：`package.json` deps 26 / bundles 24；`cordis.patch.yml` 有
  `- id: effect-lab-bridge` + `config.labPath`。
- 宿主半区在真实桌面版可用：`GET http://127.0.0.1:19387/dsh-lab-bridge/latest.json` → 200。
- 回滚/安装快照：`D:\dsh-bridge-1005\`（`CHANGES.md`、`INSTALL-RESULT.txt`）。
- 启动脚本：`启动实验台.cmd`（cd 到项目目录 → `node bin\lab.js gui`）。
