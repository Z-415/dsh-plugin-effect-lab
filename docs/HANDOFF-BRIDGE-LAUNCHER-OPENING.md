# 交接开场白 · 桥接插件改为启动器

> 把下面整段复制给实施 AI。

---

桥接插件的内嵌报告面板在真实桌面版里体验不可用（点报告入口会整页导航顶掉 DSH 界面且无返回），用户决定改形态：**把 DSH 插件做成一个简单的启动键**——点击后在外部启动整个实验舱项目（它自己的 Electron GUI），看起来像装了插件，实际上项目本体仍独立于 DSH profile。请先读 `docs/TASK-BRIDGE-LAUNCHER.md`，再动手。

要做的事：client 半区只保留一个「启动实验舱」按钮，删掉报告链接（`bridge-plugin/lib/client.js:77` 的 `<a href>`）、内嵌 iframe 预览和任何顶层跳转；host 半区新增 `POST /dsh-lab-bridge/launch`，等价于在实验舱仓库根目录执行 `node bin/lab.js gui` 并分离启动；报告相关路由可以删掉。`lab_verify_plugin` 工具保留与否你定，保留就维持现有测试与红线。

必须处理的坑（本机实测）：

1. **不要用 `process.execPath` 当 Node**——DSH 宿主里它是 `DeepSeek Harness.exe`；要解析真正的 `node.exe`（配置 `nodePath`，否则从 PATH 找，本机 `C:\Program Files\nodejs\node.exe`）。
2. **必须剥掉 `ELECTRON_RUN_AS_NODE`**——宿主自身带着它启动，泄漏给子进程会让 Electron 当 Node 跑、**窗口不显示**（实验舱的 `src/process-tree.js: childEnv()` 就是这么处理的）。
3. **分离启动**：`spawn(node, ['bin/lab.js','gui'], { cwd: labPath, detached: true, stdio: 'ignore', env }); child.unref();`
4. **cwd 必须是实验舱仓库根目录**（GUI 会在那里构建/复用 `gui-runtime/`）。
5. **实验舱 GUI 没有单实例锁**，连点会开多个窗口，插件侧要节流/去重。
6. **`file:` 依赖是拷贝**——改完源码要在 profile 目录重跑 `node "D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs" install --offline` 才会同步。
7. **鉴权**：插件路由不在宿主 auth fence 之后（实测无 cookie 也 200）。`POST /launch` 必须只接受 loopback 并校验 host 生成的 nonce/token。

红线：不能做成任意命令执行（固定 `bin/lab.js gui`，不接受用户传 argv）；实验舱不进 profile；永不传 `--profile-lab`、不设 `DSH_HOME` 指向真实 home；不改官方安装目录。每处补测试并反向验证、单独提交、测试在普通终端跑（沙箱 spawn EPERM）。完成后在真实桌面版里人工确认一次（设置 → 插件 → 实验舱桥接 → 点按钮 → 外部窗口出现），并给出改动文件、提交哈希、验证命令与真实输出。
