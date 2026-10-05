# dsh-plugin-effect-lab-bridge

一个极小的 DSH 桥接插件：插件本体装进 DSH profile，实验舱本体不进 profile。
桥接只在工具被调用时通过外部进程使用实验舱：

```text
node <lab>/bin/lab.js verify --plugin <spec> [--online|--offline] --json --artifacts <dir>
```

最近一次报告通过宿主 `webServer` 的同源路由呈现：

| 路由 | 内容 |
| --- | --- |
| `/dsh-lab-bridge/latest.json` | 最近一次运行的摘要 JSON |
| `/dsh-lab-bridge/latest/report.html` | 最近一次 `report.html`（无报告时是占位页） |
| `/dsh-lab-bridge/latest/report.json` | 最近一次 `report.json` |
| `/dsh-lab-bridge/latest/report.md` | 最近一次 `report.md` |

## 配置

实验舱路径按以下优先级解析：

1. 插件配置 `labPath`
2. 环境变量 `DSH_LAB_HOME`
3. 同仓布局自动探测：本包父目录下存在 `bin/lab.js`
4. 明确报错，提示如何配置

可选配置：`nodePath`（默认当前进程的 Node）、`timeoutMs`（默认 240000）、
`artifactsDir`（默认 `<os.tmpdir>/dsh-lab-bridge-artifacts`；也可用
`DSH_LAB_BRIDGE_ARTIFACTS`）。

## 安全红线

- 工具命令**从不**传 `--profile-lab`，也**从不**设置 `DSH_HOME`；实验舱保持自己的
  临时隔离 home。
- 实验舱不是依赖、不在 `files` 里，安装桥接后 profile 的 `node_modules` 里没有
  `dsh-plugin-effect-lab`（集成测试断言）。
- 启动路径不 spawn 任何进程；只有 `lab_verify_plugin` 被调用时才执行实验舱。

## 测试

```powershell
npm test                 # 单元（含 bridge-plugin/test/*）
$env:DSH_LAB_E2E='1'; npm run test:e2e
```
