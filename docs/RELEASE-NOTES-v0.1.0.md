# DSH 插件效果实验舱 0.1.0

隔离验证 DeepSeek Harness（DSH）插件效果与相互影响的实验舱。每次运行都在一次性的
`DSH_HOME` 里启动官方 runtime，不碰你真实的 `~/.dsh`。

## 运行要求

- Windows（通过 CDP 驱动 Edge，用 `taskkill` 回收进程树）
- Node.js >= 22（开发环境为 Node 24）
- 已安装官方 DeepSeek Harness 桌面版；默认 runtime 路径为
  `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，可用 `--runtime` 覆盖
- 无需安装任何依赖（不下载 Playwright/Puppeteer，不需要打包工具）

## 下载后怎么用

1. 下载并解压 `dsh-plugin-effect-lab-0.1.0.zip`
2. 在该目录打开终端
3. `node bin/lab.js doctor` —— 环境自检，应输出 PASS
4. `node bin/lab.js gui` —— 打开桌面启动器；也可以直接双击 `启动实验台.cmd`

## 主要能力

- 隔离验证单个插件：截图 + DOM / token / body 属性探针 + 清理 + 中文报告
- 桌面壳与网页的 DOM / token / 像素对比
- 多插件组合矩阵，冲突分类为 `coexist` / `manual-review` / `high-conflict`
- 持久 profile：装一次反复开，逐个追加插件并做全 profile 冲突审计
- 回环 mock 模型：无外网、无 API key 跑通真实流式工具回合
- 失败签名库与 `lab scan`；`lab clean` 清理残留临时目录与游离进程

## 注意

本工具**不是安全沙箱**，恶意插件仍以你的用户权限运行；测试第三方插件前请先读
`docs/SAFETY.md`。

完整说明见 `README.md`（英文）与 `README.zh-CN.md`（中文），以及 `docs/` 目录。

MIT License.
