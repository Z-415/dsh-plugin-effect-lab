# 任务书 · 桥接插件一键安装器（`lab bridge install`）

> 面向：实施 AI（审查由另一个会话负责）
> 基线：`main` @ `dee32fe`（已发布 0.2.0）
> 目标：把现在"手改两处配置 + 跑 pnpm"的安装过程，变成一条命令 / 双击一次。

## 0. 背景与目标

0.2.0 的 release 里同时带了**项目本体**与**桥接插件**，但安装是手动的：

1. 改 `~/.dsh/profiles/desktop/package.json`（`dependencies` + `dsh.profile.bundles`）；
2. 改同 profile 的 `cordis.patch.yml`（`- id: effect-lab-bridge` + `config.labPath`）；
3. 在该目录跑 runtime 的 pnpm `install --offline`；
4. 退出/重启 DSH 桌面版。

对手动步骤不熟悉的用户很容易漏掉 `labPath`（漏了插件能加载、但一按就报"未配置实验舱路径"），
或者忘了先退出桌面版（配置被 app 重写 / 文件被占用）。

**目标**：`node bin/lab.js bridge install` 一条命令完成上述 4 步，并且**可重复执行（幂等）、可回滚、
默认先备份**；再提供一个双击入口（`安装桥接插件.cmd`）给 release 用户。

## 1. 命令面

新增 `lab bridge <action>` 子命令（复用现有 CLI 解析风格）：

```powershell
lab bridge status    [--profile desktop] [--home <dir>] [--runtime <dsh.cmd>] [--json]
lab bridge install   [--profile desktop] [--lab-path <dir>] [--home <dir>] [--runtime <dsh.cmd>]
                     [--online] [--dry-run] [--force] [--json]
lab bridge uninstall [--profile desktop] [--home <dir>] [--json]
```

- 默认 `--profile desktop`（桥接插件是桌面版启动器）；`--profile web` 允许但应提示"web 版没有该插件需要的桌面能力"。
- `--home` **主要给测试用**（指向临时 `.dsh`），默认 `~/.dsh`。
- `--lab-path` 默认"当前仓库根目录"（即 `bin/lab.js` 所在仓库）。
- `--json` 输出结构化结果，供 GUI / 脚本使用。

## 2. `install` 必须做什么（按顺序）

1. **前置检查**
   - 定位 runtime（复用 `src/runtime-locator.js`，默认 `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`）；
   - 确认 `<home>/profiles/<profile>/package.json` 存在（不存在就明确报错，**不要**顺手创建）；
   - 确认 `<lab-path>/bridge-plugin/package.json` 存在，且 `name === 'dsh-plugin-effect-lab-bridge'`；
   - **检测 DSH 是否在运行**：查端口（桌面版固定 19387）+ 进程名 `DeepSeek Harness.exe`；
     在运行就**拒绝**并提示"请先完全退出 DSH 桌面版（含托盘）再装"。
2. **备份**（默认必做，`--force` 也不跳过）
   - 把该 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`
     复制到 `<profile>/.lab-bridge-backup/<timestamp>/`，并写 `BEFORE-HASHES.txt`（SHA-256）。
3. **改 `package.json`（幂等）**
   - `dependencies['dsh-plugin-effect-lab-bridge'] = 'file:<labPath>/bridge-plugin'`（**正斜杠**）；
     已存在则**更新路径**，不要重复键；
   - `dsh.profile.bundles` 里若已有同名项则不重复添加（复用 `src/profile-builder.js` 的 `appendBundles` 思路）。
4. **改 `cordis.patch.yml`（幂等，且不得破坏原有内容）**
   - 目标块：
     ```yaml
     - id: effect-lab-bridge
       config:
         labPath: <labPath>
     ```
   - 已存在同 `id` 的块 → **替换该块的 config**，不要追加第二个；
   - 不存在 → 追加到文件末尾；
   - ⚠️ **禁止整文件 YAML 解析后重写**：真实 profile 的 `cordis.patch.yml` 含自定义 `!!js`
     标签（`disabled: !!js process.platform !== 'win32'`），重写会丢语义/丢注释。用
     "定位块 + 文本替换/追加"的方式改。
5. **安装依赖**
   - 在 profile 目录跑 `node <runtime>/pnpm/bin/pnpm.mjs install --offline`（`--online` 才允许联网）；
   - 失败时**自动回滚**：用第 2 步的备份覆盖回 4 个文件，再跑一次 pnpm，然后报错退出。
6. **校验并报告**
   - `<profile>/node_modules/dsh-plugin-effect-lab-bridge/package.json` 存在；
   - `bundles` 含该名字；`cordis.patch.yml` 里 `effect-lab-bridge` 恰好 1 条；
   - 打印：改了什么、备份在哪、**下一步要重启 DSH**、以及 `bridge uninstall` 的用法。

## 3. `uninstall` 必须做什么

- 从 `dependencies` 与 `dsh.profile.bundles` 里移除该插件（复用 `removeBundles`），
  删掉 `cordis.patch.yml` 里的 `effect-lab-bridge` 块（只删这一块）；
- 跑一次 pnpm install；报告结果；**不动** `<lab-path>` 本体。
- 若检测到 DSH 在运行，同样拒绝并要求先退出。

## 4. `status` 必须报告

- profile 名与目录；插件是否在 `dependencies` / `bundles` / `node_modules`；
- `cordis.patch.yml` 里的 `labPath` 值与**该路径是否存在**；
- DSH 是否在运行（决定"能不能现在装/卸"）。

## 5. 安全红线（写死在实现里）

- 只改目标 profile 与它自己的 `.lab-bridge-backup/`；**永不**读写 `home` 下的
  `.credentials.yaml` / `sessions/` / `agents/` / `settings.yaml`。
- 不碰官方安装目录（`D:\DeepSeek Harness\...` 只读）。
- 幂等：重复 `install` 不得产生重复键/重复 bundle/重复 `cordis.patch.yml` 块。
- 幂等失败即回滚；`--dry-run` 必须**零写入**（打印将做的改动）。
- 拒绝在 DSH 运行时写入。
- 记住 0.2.0 的一个已知前提：pnpm 对 `file:` 依赖是**拷贝**，所以 `labPath` 必须显式写入——
  这也是本安装器存在的意义，别退回去依赖"自动探测"。

## 6. Release 集成

- 在仓库根加一个双击入口 **`安装桥接插件.cmd`**（与现有 `启动实验台.cmd` 风格一致）：
  ```bat
  @echo off
  setlocal
  cd /d "%~dp0"
  where node >nul 2>nul || (echo Node.js 22+ is required on PATH. & pause & exit /b 1)
  node bin\lab.js bridge install %*
  pause
  ```
- 下一个 release 的说明里，把"安装"从 6 步手改改成一句：解压 → 退出 DSH → 双击
  `安装桥接插件.cmd` → 重启 DSH。项目本体仍放在解压目录（与 profile 分离）。
- 同时更新 `docs/RELEASE-NOTES-v0.2.0.md` 里"已知问题：当前安装步骤是手动的"这条（0.3.0 起不再适用）。

## 7. 验收标准

1. **临时 home 上的集成测试**（不得碰真实 `~/.dsh`）：造一个含 `package.json` / `cordis.patch.yml`
   （**带 `!!js` 标签**）的假 profile → `bridge install --home <tmp>` → 断言：
   依赖/bundle/config 都写入、`node_modules` 里出现插件、`cordis.patch.yml` 的 `!!js` 标签**原样保留**。
2. **幂等**：再跑一次 `install` → 无重复键、无重复 bundle、`cordis.patch.yml` 里
   `effect-lab-bridge` 仍恰好 1 条；第二次的备份仍会生成（可追溯）。
3. **`--dry-run`**：不产生任何文件改动（改动前后整目录哈希一致）。
4. **拒绝路径**：DSH 在运行时 → 拒绝；profile 不存在 → 拒绝；
   `<lab-path>/bridge-plugin` 不存在 → 拒绝。各给可读原因与退出码。
5. **回滚**：注入 pnpm 失败（例如用不存在的 registry / 假 pnpm）→ 4 个文件被还原到备份内容。
6. **uninstall**：装完再卸 → 4 个结构文件的**语义与安装前一致**（依赖、bundles、config 行都回到原状）。
7. `lab bridge status --json` 在装前/装后/卸后三种状态都给出正确字段。
8. 单元 + 集成测试、反向验证（例如去掉幂等判断 → 重复 install 的断言变红）、单独提交。
9. 真机人工验收一次：在一台**未装过**桥接的机器（或删干净后的本机）上，从 release zip 解压 →
   双击 `安装桥接插件.cmd` → 重启 DSH → 设置 → 插件里出现「实验舱桥接」→ 点按钮能打开实验舱 GUI。

## 8. 可复用的现有代码

- `src/runtime-locator.js`（定位 runtime）、`src/config.js`（`REAL_HOME`）
- `src/profile-builder.js`（`appendBundles` / `removeBundles`）
- `src/plugin-install.js`（`removeProfilePlugins` 的移除思路）
- `src/cli.js`（新增 `bridge` 子命令；注意 `VALUE_FLAGS` / `BOOLEAN_FLAGS` 要加 `profile` / `lab-path` / `home` / `online` / `dry-run` / `force`）
- `src/net-utils.js`（`canConnect` 判端口）、`src/process-reaper.js`（按命令行查 DSH 进程）

## 9. 风险与取舍

- **移动目录**：装完后移动项目目录会让 `labPath` 失效。安装器应在 `status` 里显式报告
  "labPath 指向的目录不存在"，并让 `install` 可重复执行来更新路径（幂等已覆盖）。
- **profile 被 app 重写**：所以必须先退出桌面版；安装器拒绝运行中写入。
- **`cordis.patch.yml` 自定义标签**：只用文本级块替换，别整文件 YAML 往返。
- **web profile**：允许安装但提示能力差异（桌面启动器是为 desktop 准备的）。
