# 交接文档 · GUI 界面打磨（2026-10-05 续）

> 面向：接手继续开发的下一个 AI / 新会话
> 项目：`C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab`
> 范围：本轮只改**桌面 GUI**（`lab gui` / 桌面快捷方式）；CLI、隔离验证、
> 报告、失败签名等行为都没动。
> 起点提交：`e8fd77f`　本文件记录的终点提交：`e1cf0f1`
> 总交接先读 `docs/HANDOFF-20261005.md`（尤其 §0 / §3 / §6 / §9），本文件是它的
> GUI 专题补充。

## 0. 三十秒接手

```powershell
cd 'C:\Users\35259\Desktop\新建文件夹 (2)\dsh-plugin-effect-lab'
npm test                                     # 单元 203/203，约 1.3 秒
$env:DSH_LAB_E2E='1'; node --test tests/integration/gui-page.test.js   # GUI 2/2，约 6 秒
node bin/lab.js gui                          # 打开 GUI 自己看
```

真启动类命令必须能派生并 `taskkill` 子进程；受限沙箱里 `taskkill` 会被拒，
命令会挂住——不是项目问题，换普通终端即可。`npm run test:e2e` 全量是 17/17、
约 145 秒。

## 1. 本轮做了什么（7 件事）

| # | 主题 | 提交 | 做了什么 |
|---|---|---|---|
| 1 | 平面化两列布局 | `6467165` | 按钮从 flex 换行改成等宽等高的两列动作网格；左侧插件主流程 + 右侧检查 / 清理；`runtimes` 移到检查区；新增设计/几何探针与 820×560 最小窗口用例 |
| 2 | 快捷方式不再显示旧界面 | `c98fb9e` | 新增 `src/gui/app-sync.cjs`，启动器每次启动把 `src/gui` 的界面文件同步进 `gui-runtime` 缓存；缓存改为逐文件增量刷新（新增文件不再触发 346MB 全量重建，开窗时也不会 EPERM） |
| 3 | 白色顶栏 + 中文菜单 + 白底日志 | `abcac1c` | 系统标题栏颜色跟随 Windows 强调色、应用改不了，所以改成自绘白色标题栏（`titleBarStyle: 'hidden'` + `titleBarOverlay`，系统仍画最小化/最大化/关闭）；页面内实现中文菜单（文件/编辑/查看/窗口/帮助），动作走 `lab:menu` IPC；`menu.cjs` 的应用菜单只留快捷键并隐藏原生菜单栏；日志区从深色改成白底深字 |
| 4 | 日志区不再挤压上方 | `dc31f6d` | 日志区 `flex: 1 1 auto` → `flex: 1 1 0`，只吃剩余空间、长输出在区内滚动；新增 `LONG_LOG` 探针（旧写法实测控件区 399px→27px） |
| 5 | 按钮去边框 | `9a6978d` | 按钮全部 `border: 1px solid transparent`，靠填充表达状态，hover 只换背景色不画描边 |
| 6 | 插件区重排 + 配色 | `d86e4b5` | 两个「在壳窗口打开」并到第一行，其余动作跟随，「验证这个插件」整行放最后；普通按钮统一浅蓝 `#f2f6ff`，四个特殊按钮单独配色 |
| 7 | 跨版本矩阵标签单行 | `ada4937` | 该按钮加 `.span2` 整行铺开，长标签不再折行；`LAYOUT_AND_BANNER` 加 `multiline` 断言 |

## 2. 现在的界面规则（改之前先读，别改回去）

- **窗口**：`titleBarStyle: 'hidden'` + `titleBarOverlay: { color: '#ffffff' }`。
  系统标题栏是 Windows 画的、颜色跟随「强调色」设置，应用无法覆盖——不要再退回
  `titleBarStyle: 'default'`，否则顶栏又会有颜色。标题栏右侧留了 150px 给系统按钮。
- **菜单**：可见菜单在页面里（`.menu-btn` / `.menu-pop` / `[data-action]`），点击经
  `preload.js` 的 `labGui.menu(action)` → `main.js` 的 `lab:menu` 处理。
  `menu.cjs` 的中文应用菜单只为保留快捷键（Ctrl+C/V/R、Ctrl+Shift+I、缩放），
  用 `window.setMenuBarVisibility(false)` 隐藏原生菜单栏。
- **日志区**：必须保持 `flex: 1 1 0`（不是 `1 1 auto`），最小高度 200px，
  否则日志一长就会把上方控件区压扁。
- **按钮**：无边框填充式。普通按钮浅蓝 `#f2f6ff` + 强调色文字，hover `#e2ebff`；
  只有四个特殊按钮单独配色：
  - `验证这个插件` → 实心蓝 `#2563eb` / 白字（`.primary`）
  - `在壳窗口打开（自己关）` → 深一档浅蓝 `#dbeafe` / 加粗（`.strong`）
  - `卸载这个插件`、`清理残留临时目录` → 浅红 `#fdf1f0` / 红字（`.danger`）
  不要再给 `button` 加 `border-color`，也不要动这四个按钮的类。
- **长标签**：半格放不下就用 `.span2` 整行铺开（跨版本矩阵）。回归断言：
  `LAYOUT_AND_BANNER` 的 `multiline`、`DESIGN` 的等宽等高。
- **测试契约**：所有按钮 id、预设按钮的 `data-args`（`|` 分隔）、菜单项的
  `[data-action]` 都被 `tests/integration/gui-page.test.js` 依赖，改名/删掉会红。
- **同步机制**：`src/gui` 是唯一真源；`app-sync.cjs` 在每次启动时把它同步进
  `gui-runtime/gui-<版本>/resources/app/`。改 `index.html` 重开窗口即可生效；
  改 `main.js` / `preload.js` 必须**完全关掉窗口再启动**（运行中的主进程不会热更新）。

## 3. 本轮涉及的文件

| 文件 | 作用 |
|---|---|
| `src/gui/index.html` | GUI 页面本体：内联 CSS + 页面脚本（布局、配色、菜单交互都在这里） |
| `src/gui/main.js` | Electron 主进程：窗口、白色标题栏、中文应用菜单、`lab:menu` IPC、启动同步 |
| `src/gui/preload.js` | 暴露 `window.labGui`（`run/menu/stop/profiles/openReport/openArtifacts/info/on*`） |
| `src/gui/menu.cjs` | 中文应用菜单模板（只提供角色与快捷键，不显示） |
| `src/gui/app-sync.cjs` | 界面文件清单 `APP_FILES` + 启动同步实现（`main.js` 与 `runtime.js` 共用） |
| `src/gui/runtime.js` | 构建/刷新 `gui-runtime` 缓存（`GUI_APP_FILES` 直接取自 `app-sync.cjs`） |
| `tests/integration/gui-page.test.js` | GUI 页面回归：按钮派发、布局几何、配色、菜单、长日志、最小窗口 |
| `tests/unit/gui-menu.test.js` | 中文菜单模板：标签中文、角色齐全、关于项回调 |
| `tests/unit/gui-app-sync.test.js` | 启动同步：只复制变化的文件、跳过缺失、失败只记日志 |
| `tests/unit/gui-runtime.test.js` | 缓存增量刷新：缺文件也能补回且不重拷运行时 |
| `docs/GUI.md` | GUI 使用说明（布局、标题栏与菜单、按钮命令表） |

## 4. 怎么验证

```powershell
npm test                                                  # 203/203
$env:DSH_LAB_E2E='1'; npm run test:e2e                     # 17/17，约 145 秒
node bin/lab.js gui                                        # 手工看
node bin/lab.js clean --dry-run                            # 跑完应 0 残留
```

只想验证 GUI 改动时跑 `node --test tests/integration/gui-page.test.js`（2 条，
约 6 秒）就够了；它用 headless Edge 加载页面、点一遍所有按钮，并断言：

- `DESIGN`：动作网格每行等宽等高、文字不溢出、控件不重叠、不越出所在行、无横向滚动；
- `THEME`：页面 / 卡片 / 日志区 / 标题栏都是浅色，日志文字对比度 ≥ 7:1；
- `MENUS`：中文菜单标签与每一项的 `labGui.menu` 动作；
- `BUTTONS`：按钮无边框 + 四套填充色；
- `LONG_LOG`：灌 600 行后控件区高度不变、日志内部滚动；
- `LAYOUT_AND_BANNER`：`更多` 默认折叠、打开后布局仍成立、里面的按钮文字单行；
- `MIN_LAYOUT`：820×560 最小窗口下日志仍有 ≥120px。

截图核对放在 `artifacts/gui-shot-review/`（headless Edge 渲染的 PNG，含最终
顶栏、菜单展开、按钮配色等），这些是 gitignored 的临时证据，可随时删。

## 5. 提交清单（`e8fd77f..e1cf0f1`）

```text
e1cf0f1 Record the matrix label fix in the handoff
ada4937 Keep the cross-version matrix label on one line
2d8d4a9 Record the plugin layout and colours in the handoff
d86e4b5 Reorder the plugin actions and recolour the buttons
2e2c403 Record the borderless buttons in the handoff
9a6978d Make the buttons borderless with a hover fill
ec9318b Record the log-height fix in the handoff
dc31f6d Keep a long log from squeezing the controls
21cf937 Record the white title bar and menu in the handoff
abcac1c Draw a white title bar with a Chinese in-page menu
8a90e4b Record the GUI shortcut sync fix in the handoff
c98fb9e Sync the GUI app from src/gui when the launcher starts
459553d Refresh the handoff for the GUI polish
6467165 Flatten the GUI into a grid-aligned two-column layout
```

## 6. 遗留 / 可能的下一次

1. **区域外框还在**：插件 / 检查 / 清理 / 日志四块仍有 1px 浅灰框。用户提过
   「边框太多」，但当时只要求改按钮；如果还要更干净，可以把 `.group` 的边框去掉，
   改成纯留白分区（改一处 CSS + 更新 `DESIGN`/`THEME` 探针）。
2. **没做**：跟随系统深色模式（现在强制 light）、窗口大小/位置的记忆、托盘图标、
   页面内菜单的键盘导航（Alt 快捷键）。
3. **改动时记得**：新增或改名的按钮 / 菜单项要同步 `gui-page.test.js` 的断言；
   改完 `src/gui` 后跑一次 `node bin/lab.js gui --no-open` 或直接重开窗口（启动同步
   会自动刷新缓存），然后确认 `clean --dry-run` 为 0。
