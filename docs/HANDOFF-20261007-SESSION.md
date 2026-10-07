# 交接文档 · 2026-10-07 会话（项目现状 / GitHub / 角色 / 本机配置）

> 面向：下一个接手的 AI 会话
> 项目：`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`
> 仓库 HEAD：`e76e8ee`（`release: 0.3.0`），`main == origin/main`
> 版本：lab `0.3.0`，桥接插件 `dsh-plugin-effect-lab-bridge` `0.3.0`

## 0. 三十秒接手

```powershell
cd 'C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab'
git log --oneline -5          # 确认在 e76e8ee 附近、工作树干净
npm test                      # 单元：基线 379/379（需在普通终端，沙箱内会 spawn EPERM）
node bin/lab.js doctor        # 环境自检，应 PASS
node bin/lab.js profile list  # 本机实验舱 profile（bridge-dev / dev / test1 / web-clone / desktop-clone）
```

**注意**：所有真启动类命令（`doctor` / `verify` / `shell` / `gui` / 集成测试）、`git push`、
`gh`、写 `~/.dsh`、写 `D:` 或 `%TEMP%` 在本 Codex 环境里都需要 `require_escalated`
（沙箱禁止派生子进程与 `taskkill`）。只读操作正常。

## 1. 项目现状

**它是什么**：隔离验证 DSH（DeepSeek Harness）插件效果与相互影响的实验舱（CLI + 桌面 GUI），
外加一个把它接进 DSH 桌面版的**桥接启动器插件**。

- **项目本体**放在仓库目录里；**桥接插件**装进 DSH 的 profile；两者靠插件配置里的
  `labPath` 关联，实验舱源码**不进** profile。
- 主要能力：隔离验证单个插件、壳 vs web 对比、冲突矩阵、克隆真实 profile、
  `npm:`/`github:` 安装来源与真实包名回显、稳定错误码 + 脱敏诊断包、结构化进度、
  `rich` 对话夹具（思考 + 代码块 + tool 轮）、一键安装器 `lab bridge install`。

**测试基线**（2026-10-07）：

- 单元 **379/379**。
- 集成 **45 项**；用户侧报了 45/45，我这边满负载跑出现过 **1 条 flake**
  （`fixture-variants.test.js` 的 rich 渲染探针 `codeFound=false`，单独复跑 3/3 通过）
  —— 见 `docs/KNOWN-ISSUES.md` §1，**已知、暂缓修复**。

**已发布的 Release**：`v0.1.0` / `v0.2.0` / `v0.3.0`（`v0.3.0` 为 Latest）。
每个 release 都附了用 `git archive` 打的源码 zip（里面同时含项目本体与 `bridge-plugin/`）。

## 2. GitHub 仓库与操作

- 仓库：**https://github.com/Z-415/dsh-plugin-effect-lab**
- Releases：https://github.com/Z-415/dsh-plugin-effect-lab/releases
- 远端：`origin = git@github.com:Z-415/dsh-plugin-effect-lab.git`（**SSH**；HTTPS 没有可用凭证）
- 仓库是 **public**；`LICENSE`（MIT，© 2026 Z-415）已加入。

### 2.1 本会话第一次发 Release 时做的配置（下次不用重做）

1. 用 winget 装了 GitHub CLI：`winget install --id GitHub.cli --exact`
   → `C:\Program Files\GitHub CLI\gh.exe`（**2.102.0**）。
2. 用户完成了 `gh auth login`：账号 **Z-415**，token 权限
   `gist, read:org, repo, workflow`（**注意：没有 `write:packages`**，
   所以发 GitHub Packages 需要先 `gh auth refresh -s write:packages`，而那条又要走 GitHub 网页）。
3. 本机 SSH key `~/.ssh/id_ed25519` 已被 GitHub 接受；`origin` 设为 SSH。
4. 仓库已建好并设为 public；补了 MIT `LICENSE`；`README.zh-CN.md` 与 GUI 按钮文档已写好。

### 2.2 发一个新 Release 的标准流程（本会话用过，可直接复用）

```powershell
cd 'C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab'
# 1) 版本 + 变更日志 + 发行说明
#    package.json / bridge-plugin/package.json 升版本；CHANGELOG.md 加一节；
#    docs/RELEASE-NOTES-vX.Y.Z.md 写正文
git add -A; git commit -m "release: X.Y.Z"
# 2) 打 tag 并推送
$env:GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20'
git tag -a vX.Y.Z -m "DSH Plugin Effect Lab X.Y.Z"
git push; git push origin vX.Y.Z
# 3) 打源码包并发布（幂等：先 npm/gh 预览由你自己确认）
$zip = Join-Path $env:TEMP 'dsh-plugin-effect-lab-X.Y.Z.zip'
git archive --format=zip -o $zip --prefix=dsh-plugin-effect-lab-X.Y.Z/ vX.Y.Z
& "C:\Program Files\GitHub CLI\gh.exe" release create vX.Y.Z $zip `
    --title "DSH Plugin Effect Lab X.Y.Z" --notes-file docs/RELEASE-NOTES-vX.Y.Z.md
```

**坑**：`git push` 偶尔报 `Connection closed by 198.18.0.15 port 22`（本机 TUN 代理干扰），
**直接重试即可**，本会话遇到过两次，重试都成功。

## 3. 角色说明（这一条最重要）

本会话的 AI 角色是**审查测试方 + 任务书作者 + 发布方**，**不亲自写代码**：

1. **用户提出需求 / 报 bug**；
2. **本角色**：先自己复现、定位根因（读代码 + 跑命令 + 线上探测），然后写两份文档——
   - 任务书 `docs/TASK-*.md`：现象 / 根因 / 修复要求 / **验收标准** / 红线 / 代码位置；
   - 交接开场白 `docs/HANDOFF-*-OPENING.md`：一段可直接粘贴给实施 AI 的话。
3. **实施 AI**：按任务书写代码，**每处补测试 + 反向验证 + 单独提交**，在普通终端跑测试；
4. **本角色复核**：**不采信它的报告**——自己跑单元/集成、读 diff、看提交、
   必要时线上探测（HTTP / 进程 / 文件哈希），核对它宣称的验收是否属实；
5. **本角色发布**：更新版本/CHANGELOG/发行说明 → 提交 → 打 tag → 推送 → `gh release create`。

**给下一位的两条惯例**：

- 任务书里要显式写"哪些是**已核实事实**、哪些是**待查项**"，并说明前一份任务书若理解错了要删掉重写
  （本会话发生过一次：把"克隆要可见"理解成了"列出真实 profile"，已纠正）。
- 复核时优先自己跑一遍关键链路，其次才看实施方的自述；发现 flake 要区分"本次引入"还是"既有"，
  并写进 `docs/KNOWN-ISSUES.md`。

## 4. 本机基础配置（可用 / 不可用）

### 4.1 系统与运行时

- Windows 11（22631），amd64；Node **24.18.0**（`C:\Program Files\nodejs\node.exe`）；npm **11.16.0**。
- 官方 DSH runtime：`D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（**0.2.0-rc.2，verified**）；
  其自带 pnpm：`D:\DeepSeek Harness\resources\runtime\pnpm\bin\pnpm.mjs`。
- Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（实验舱用 CDP 驱动它）。
- 真实 DSH home：`C:\Users\35259\.dsh`，profiles：`desktop`（官方桌面版，25+ 插件）、`web`、`dsh-tui`。

### 4.2 网络（**本会话最大的坑，务必先读**）

| 目标 | 状态 | 说明 |
|---|---|---|
| `registry.npmmirror.com` | ✅ 200 | npm 默认源就是它（只读镜像） |
| `registry.npmjs.org` | ✅ 200 | 官方 registry API 可直连，`npm publish` 可用 |
| `www.npmjs.com` | ❌ 403 | 响应头 `Cf-Mitigated: challenge` + `Server: cloudflare`，**Cloudflare 机器人挑战** |
| `docs.npmjs.com` | ✅ 200 | 官方文档站在 GitHub 文档基建上，通 |
| `github.com`（网页） | ❌ | 直连超时；走代理则被 GitHub 判机器人（"访问暂时受限"） |
| `git@github.com`（SSH） | ✅ | `git push` 可用（偶发 `198.18.0.15:22` 断开，重试即可） |

- 本机出现过 **TUN 代理**：网络适配器 `pokemon` / `Meta Tunnel`（mihomo/Clash.Meta 一类），
  开启时出口 IP 是 **209.9.200.33**（被 GitHub 标记，截图里的风控页就是它）。
  用户后来把它关掉了；关掉后 GitHub 直连反而超时。
- **npm 注册的现状**：官方已**取消 legacy 注册**（CLI 会明确报
  `Account creation via legacy auth is unavailable`），必须走网页；而 `www.npmjs.com` 被
  Cloudflare 挑战挡住 → **本机目前无法注册 npm 账号**。
  **可行替代**：让能打开官网的人建号 + 建一个 **Granular Access Token**，本机只配 token：
  `npm config set //registry.npmjs.org:_authToken=<TOKEN>`，之后 `npm publish` 全程只走 registry。
  **不依赖账号的办法**：解压 release zip 后本地 `npm install -g .`（`private: true` 只挡发布，
  不挡本地打包/安装）。

### 4.3 Codex 沙箱限制（影响每个命令）

- 沙箱内**禁止派生子进程**（`spawn EPERM`）与 `taskkill` → `npm test`、`npm run test:e2e`、
  `node bin/lab.js doctor|verify|shell|gui` 全部要 `require_escalated`。
- `git push` / `gh release`（网络）、写 `~/.dsh` / `D:` / `%TEMP%`（沙箱外路径）同样要 `require_escalated`。
- 只读（`Get-Content`、`rg`、`git status/log/show`）在沙箱内即可。

### 4.4 体积与产物（发布前必须注意）

- `gui-runtime/` ≈ **348 MB**（`lab gui` 首次会重建，gitignored）。
- `.lab-profiles/` ≈ **1.4 GB**（本机实验舱 profile，gitignored）。
- `artifacts/` ≈ **109 MB**（运行产物，gitignored）。
- ⇒ `git archive` 只打被跟踪文件，所以 release zip 是干净的；但 lab 包**没有 `files` 白名单**，
  一旦 `npm pack` / `npm publish` 会把上面这些全带上 —— **发 npm 前必须先加白名单**（见 §6）。

### 4.5 备份

- `D:\dsh-bridge-1005\`：首次把桥接插件装进真实 desktop profile 前的快照
  （profile 结构文件 + `BEFORE-HASHES.txt` + `CHANGES.md` + `INSTALL-RESULT.txt`，含回滚步骤）。

## 5. 真机安装状态（截至交接）

桥接插件**已装进真实 desktop profile**：

- `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 有
  `"dsh-plugin-effect-lab-bridge": "file:C:/Users/35259/Desktop/新建文件夹 (2)/dsh-plugin-effect-lab/bridge-plugin"`，
  且 `dsh.profile.bundles` 含同名项；
- `~/.dsh/profiles/desktop/cordis.patch.yml` 有 `- id: effect-lab-bridge` +
  `config.labPath` 指向本仓库。

管理方式（优先用它，不要手改）：

```powershell
node bin/lab.js bridge status
node bin/lab.js bridge install --dry-run
node bin/lab.js bridge uninstall
```

> 安装/卸载前**必须先完全退出 DSH 桌面版**（安装器会检测 19387 / `DeepSeek Harness.exe` 并拒绝）。
> 装完移动仓库目录会让 `labPath` 失效，在新位置重跑一次 `bridge install` 即可（幂等）。

本机实验舱 profile：`bridge-dev`、`dev`、`test1`、`web-clone`、`desktop-clone`
（后两个是从真实 profile 克隆的；`web-clone` 会如实报出真实 web profile 自带的
`LAB-CLIENT-001`（`conversation.chat.turnTail` 缺 `options.id`），属预期）。

## 6. 未完成 / 待办

1. **npm 分发（未完成，阻塞于建号）**：要发 npm 需要先做包装改造——
   两个包去掉 `private`、给 lab 加 `files` 白名单
   （`bin/ src/ fixtures/ docs/ README.md README.zh-CN.md LICENSE CHANGELOG.md bridge-plugin/`；
   `fixtures/` 是运行时必需，不能漏；`.lab-profiles/`、`gui-runtime/`、`artifacts/` 必须排除），
   并用 `npm pack --dry-run` 校验清单与体积。账号与 token 见 §4.2。
2. **`rich` 渲染探针 flake**（`docs/KNOWN-ISSUES.md` §1）：已知、暂缓；满负载时 45 项会偶发 1 红。
3. **一键安装器**已实现并有测试（`lab bridge install` + `安装桥接插件.cmd`），
   但尚未在"全新未装过的机器"上做过人工端到端验收。

## 7. 文档地图（哪些是权威）

- `README.md` / `README.zh-CN.md`：用途与用法（含 GUI 按钮说明、DSH 插件安装段）。
- `docs/KNOWN-ISSUES.md`：**已知问题与暂缓修复**（flake、旧 clone 需重建等）。
- `docs/HANDOFF-20261005.md`：项目总交接（能力、代码地图、踩过的坑、铁律）。
- `docs/HANDOFF-20261005-GUI-POLISH.md`：GUI 规则（哪些 CSS/IPC 不要改回去）。
- `docs/TASK-*.md` + `docs/HANDOFF-*-OPENING.md`：历史任务书与开场白（含已完成的安装诊断、
   清理、克隆、启动器、V2 六项增强、npm 相关）。
- `docs/RELEASE-NOTES-v*.md`：各版本发行说明。
- `docs/CLONE-PROFILE.md` / `docs/DIAGNOSTICS.md` / `docs/PROGRESS.md` / `docs/FIXTURES.md`：
   各功能的详细说明。
