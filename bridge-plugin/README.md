# dsh-plugin-effect-lab-bridge

一个极小的 DSH 启动器插件：插件本体装进 DSH profile，实验舱本体不进 profile。
面板里只有一个「启动实验舱」按钮，点击后由 host 在实验舱仓库根目录分离启动：

```text
node <lab>/bin/lab.js gui
```

外层是实验舱自己的 Electron GUI；DSH 界面保持不变。host 只提供
`POST /dsh-lab-bridge/launch`（loopback + 注入 nonce 校验，固定只启动这条命令，
不接受任何调用方 argv）。

## 配置

实验舱路径按以下优先级解析：

1. 插件配置 `labPath`
2. 环境变量 `DSH_LAB_HOME`
3. 同仓布局自动探测：本包父目录下存在 `bin/lab.js`
4. 明确报错，提示如何配置

可选配置：`nodePath`（真正的 node.exe；默认从 PATH 查找）、`timeoutMs`（默认 240000，
agent 工具用）、`artifactsDir`（默认 `<os.tmpdir>/dsh-lab-bridge-artifacts`）。

## 安全红线

- 启动与工具命令**从不**传 `--profile-lab`，也**从不**设置/继承真实 `DSH_HOME`；
  spawn 前剥离 `ELECTRON_RUN_AS_NODE`，实验舱保持自己的隔离 home。
- 实验舱不是依赖、不在 `files` 里，安装桥接后 profile 的 `node_modules` 里没有
  `dsh-plugin-effect-lab`（集成测试断言）。
- 启动路径不 spawn 任何进程；只有点击按钮或调用 `lab_verify_plugin` 时才执行实验舱。

## 测试

```powershell
npm test                 # 单元（含 bridge-plugin/test/*）
$env:DSH_LAB_E2E='1'; npm run test:e2e
```
