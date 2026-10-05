# 交接开场白 · 桥接插件 B 方案

> 把下面整段复制给实施 AI 作为第一条消息。

---

你是本任务的**实施 AI**，负责写代码；另有一个**审查会话**只负责审查，不写代码。

工作目录：`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`（外层目录不是 git 仓库，仓库在这个子目录里）。

先按顺序读完这三份，再动手：

1. `docs/TASK-BRIDGE-PLUGIN-B.md` —— 任务书（范围、验收标准、红线、探索项）
2. `docs/ARCHITECTURE.md` 和 `docs/SAFETY.md` —— 隔离模型与安全边界
3. `docs/HANDOFF-20261005.md` 的 §5（踩过的坑）和 §7（铁律）

任务一句话：实现 **B 方案的桥接插件原型**——桥接插件自身装进 DSH 的 profile，但**实验舱本体不进 profile**；桥接通过外部调用 `node <lab>/bin/lab.js verify --plugin <spec> --json --artifacts <dir>` 使用实验舱的能力与产物，并通过宿主 `webServer` 的**同源路由**把最近一次报告呈现出来（**不要** iframe 本地端口，DSH 渲染进程 origin 是 `dsh-app://app`）。

请特别注意：

- 先**探明** `defineTool`、`ctx.slots.register`、`webServer` 在 0.2.0-rc.2 的真实 API，再写业务码。仓库里的 `src/declaration-scanner.js` 只是静态正则，不是签名；实物参照是 `.lab-profiles\dev\home\profiles\lab-dev\node_modules\dsh-plugin-wallpaper-engine\lib\`（宿主 `index.js` + 浏览器 `client.js`），官方运行时在 `D:\DeepSeek Harness\resources\`。
- `lab verify --json` 的退出码为 1 时**仍然可能有有效报告**，必须解析 stdout，不要直接丢弃。
- 红线：工具调用实验舱时**绝不**传 `--profile-lab`，绝不把 `DSH_HOME` 指向真实 `~/.dsh`；桥接安装后 profile 里**不能**出现实验舱本体；不在宿主启动路径里做重活（懒执行）。
- 每步都要补测试并做**反向验证**（把实现回退后对应断言会红），每个可独立验证的步骤单独提交。
- 单元与集成测试必须在**普通终端**运行：沙箱里 spawn/taskkill 会被拒（`spawn EPERM`）。命令用 `npm test`、`node bin/lab.js doctor`、`$env:DSH_LAB_E2E='1'; npm run test:e2e`。
- 最后写 `docs/BRIDGE-PLUGIN-RESULTS.md`，如实记录：官方 CSP / iframe 的实测结论、两个 API 的真实签名及出处、路由是否同源可用（含 `--route` 实测输出）、哪些部分自动化验证、哪些只能人工验证。

完成后给出：改动文件清单、每个提交的哈希与说明、验证命令与真实输出、`docs/BRIDGE-PLUGIN-RESULTS.md` 的结论摘要，以及任何未解决的残余风险。
