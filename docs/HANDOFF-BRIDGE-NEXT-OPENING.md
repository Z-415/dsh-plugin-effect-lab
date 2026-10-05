# 交接开场白 · 桥接 B 方案收尾

> 把下面整段复制给实施 AI 作为下一条消息（同一个会话继续也行）。

---

审查结论：B1 已验证通过（`npm test` 225、桥接集成 2/2、`lab verify --plugin .\bridge-plugin --offline --route /dsh-lab-bridge/latest/report.html --json` 实测 ok=true / route 200、profile 里没有实验舱本体、`src/` 未被改动）。现在做收尾，按顺序执行 `docs/TASK-BRIDGE-PLUGIN-B-NEXT.md`：

1.（优先）修 `src/electron-shell/shell-runner.js` 的空值崩溃：第 477、559 行对 `result` 没有空值保护，导致 `shell-result.json` 缺失时抛 TypeError、盖掉本已正确的 `shell-result: missing` 检查。改成可选链，并**查清 `result` 为 null 的根因**（是 runner 提前超时杀进程，还是 `--show` 路径壳没写回），只加 `?.` 不算修完。
2. 给 boot 就绪加断言：`src/boot-supervisor.js:155` 算了 `listening`，但 `src/runner.js:279` 只断言 `port > 0`，导致"URL 有了但端口没监听"时级联成一堆 `fetch failed`。加 `boot-listening` 检查并 fail fast；同时让 `tests/integration/stability.test.js` 失败时保留临时根目录（现在第 95–96 行会删掉，无法诊断）。
3. 便宜就做：报告路由加 `nosniff` 并限定 MIME 白名单；超时改用进程树 kill；补一条"不带 cookie 访问 `/dsh-lab-bridge/latest/report.html`"的探测。
4. 第 1 步修好后完成 B2 的人工验证：`lab shell --profile-lab bridge-dev --plugin .\bridge-plugin --offline --show --show-hold 10000`，确认设置页分区、摘要刷新、内嵌报告预览，并把观察与截图路径写进 `docs/BRIDGE-PLUGIN-RESULTS.md`。

硬性要求：每个问题单独提交、每处补测试并做反向验证、测试在普通终端跑（沙箱 spawn EPERM）；不碰红线（桥接工具永不传 `--profile-lab`、不设 `DSH_HOME`、实验舱不进 profile、不改官方安装目录、不启真实 desktop profile）。完成后给出改动文件、提交哈希、验证命令与真实输出、残余风险。
