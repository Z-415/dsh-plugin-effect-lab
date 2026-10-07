# DSH Plugin Effect Lab 0.3.0

隔离验证 DeepSeek Harness（DSH）插件效果与相互影响的实验舱，外加把它接进 DSH 桌面版的
启动器插件。**0.3.0 的重点是把安装变成一条命令。**

## 这个包里有什么

- **项目本体**（实验舱）：CLI + 桌面 GUI。
- **桥接插件**（`bridge-plugin/`）：一个很小的 DSH 插件，装进 DSH 的 **profile** 后，
  在 设置 → 插件 与左侧栏各出现一个入口，点「启动实验舱」在外部打开实验舱自己的窗口。

两者是**分开的两处**：插件进 profile，项目本体解压到你选的固定目录；插件通过
配置里的 `labPath` 找到本体。DSH profile 里**不会**出现实验舱源码。

## 运行要求

- Windows（实验舱通过 CDP 驱动 Edge、用 `taskkill` 回收进程）。
- Node.js >= 22 且在 `PATH` 里（或给插件配置 `nodePath`）。
- 已安装官方 DeepSeek Harness 桌面版。
- 无需安装任何依赖（不下载 Playwright/Puppeteer；插件复用 DSH 自带 Electron）。

## 安装（0.3.0 起三步）

1. **解压到一个固定目录**，例如 `D:\dsh-plugin-effect-lab\`（装好后**不要移动**；
   路径含空格/中文也可以）。
2. **完全退出 DSH 桌面版**（含托盘）。
3. **运行安装器**，然后重启 DSH：

   ```powershell
   cd /d D:\dsh-plugin-effect-lab
   node bin\lab.js bridge install
   ```

   或者直接双击 **`安装桥接插件.cmd`**。

安装器会：检测 runtime 与目标 profile → 备份该 profile 的 4 个结构文件 →
幂等写入依赖、`dsh.profile.bundles` 与 `cordis.patch.yml` 的 `labPath` →
用 runtime 自带的 pnpm `install --offline` 安装 → 失败自动回滚。

装完后打开 **设置 → 插件**，确认出现「实验舱桥接」；点 **启动实验舱** 即可。

### 其它命令

```powershell
node bin/lab.js bridge status            # 装了什么、labPath 指向哪、DSH 是否在运行
node bin/lab.js bridge install --dry-run # 只打印将做的改动，不写任何文件
node bin/lab.js bridge uninstall         # 反向卸载（不动项目本体）
```

双击 `卸载桥接插件.cmd` 等价于 `bridge uninstall`。

### 注意事项

- **必须先退出 DSH 桌面版**：桌面版自己管理 profile，运行中写入会被它覆盖/占用；
  安装器检测到 19387 端口或 `DeepSeek Harness.exe` 会直接拒绝。
- **装完后移动项目目录**会让 `labPath` 失效；在新位置重跑一次
  `bridge install` 即可更新（安装是幂等的）。
- 安装器只改目标 profile 与它自己的 `.lab-bridge-backup/`；不读写
  `.credentials.yaml` / `sessions` / `agents` / `settings.yaml`，也不碰官方安装目录。

## 0.3.0 相对 0.2.0 的变化

- 新增 `lab bridge install | uninstall | status` 与两个双击 `.cmd`；
  安装从"手改两处配置 + 跑 pnpm"变成一条命令（带备份、幂等、`--dry-run`、失败回滚）。
- `bridge install` 默认 `--lab-path` 为仓库根目录；安装失败会带正确标签。

0.2.0 的内容（克隆真实 profile、`npm:`/`github:` 安装方式、稳定错误码与诊断包、
更可靠的清理、`rich` 思考/代码夹具、结构化进度、启动器插件）仍然适用，详见
`docs/RELEASE-NOTES-v0.2.0.md`。

## 已知问题

- 满负载跑整套 e2e 时，`rich` 夹具的渲染文本探针可能偶发 `codeFound=false`
  （夹具数据本身正确，单独复跑即通过）。详见仓库 `docs/KNOWN-ISSUES.md`。

MIT License.
