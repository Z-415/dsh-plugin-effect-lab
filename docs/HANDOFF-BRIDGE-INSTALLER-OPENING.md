# 交接开场白 · 桥接插件一键安装器

> 把下面整段复制给实施 AI。

---

0.2.0 的 release 里已经同时带了项目本体和桥接插件，但安装还是手动的（改 `package.json` 的 dependencies+bundles、改 `cordis.patch.yml` 的 `labPath`、跑 pnpm、重启 DSH）。请把它做成一条命令 + 一个双击入口，任务书在 `docs/TASK-BRIDGE-INSTALLER.md`，请先完整读它。

要做的事：

- 新增 `lab bridge install | uninstall | status`（默认 `--profile desktop`，支持 `--home` / `--lab-path` / `--runtime` / `--online` / `--dry-run` / `--force` / `--json`）。
- `install`：前置检查（runtime 可定位、profile 的 package.json 存在、`<lab>/bridge-plugin/package.json` 存在且 name 正确）→ **检测 DSH 是否在运行（19387 / `DeepSeek Harness.exe`），在运行就拒绝** → 备份 4 个结构文件到 `<profile>/.lab-bridge-backup/<ts>/` + BEFORE-HASHES → 幂等地写 `dependencies`（`file:<labPath>/bridge-plugin`，正斜杠）与 `dsh.profile.bundles` → 幂等地改 `cordis.patch.yml`（`- id: effect-lab-bridge` + `config.labPath`，已有同 id 块就替换、不追加）→ 跑 runtime pnpm `install --offline` → 失败自动回滚 → 打印改动、备份位置和"请重启 DSH"。
- `uninstall`：移除依赖/bundle/config 块 + 跑一次 pnpm；`status`：报告插件是否已装、`labPath` 值与其是否存在、DSH 是否在运行。
- 根目录加双击入口 `安装桥接插件.cmd`（风格同现有 `启动实验台.cmd`）。

三条最容易踩的硬约束：

1. **`cordis.patch.yml` 禁止整文件 YAML 往返**——真实 profile 里有 `!!js` 自定义标签（`disabled: !!js process.platform !== 'win32'`），重写会毁掉它。只能用"定位 `- id: effect-lab-bridge` 块 + 文本替换/追加"。
2. **幂等**：重复 install 不能出现重复键 / 重复 bundle / 重复 config 块；`--dry-run` 必须零写入。
3. **测试绝不能碰真实 `~/.dsh`**：`--home` 指向临时目录，造一个带 `!!js` 标签的假 profile 来跑 install → 再 install（幂等）→ dry-run（零改动）→ 注入 pnpm 失败（验证回滚）→ uninstall（文件语义回到原状）。真实红线：不读写 profile 之外的 `.credentials.yaml`/`sessions`/`agents`/`settings.yaml`，不碰官方安装目录。

验收（完整版见任务书 §7）：临时 home 上的 install/幂等/dry-run/拒绝路径/回滚/uninstall 各有用例；`lab bridge status --json` 三种状态字段正确；单元 + 集成测试 + 反向验证（例如去掉幂等判断 → 重复 install 断言变红）；最后在真机上从 release zip 解压 → 双击 `安装桥接插件.cmd` → 重启 DSH → 设置里出现「实验舱桥接」→ 点按钮能打开实验舱 GUI。每条单独提交、普通终端跑测试（沙箱 spawn EPERM）、报告用中文。
