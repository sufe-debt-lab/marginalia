# 本地开发指南

## 环境要求

| 工具     | 版本                                    | 说明                                                                          |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Node.js  | ≥ 22.19                                 | `@earendil-works/pi-coding-agent@0.75.5` 的最低要求；dev/test 使用系统 Node。 |
| pnpm     | 9.15.4                                  | 见根 `package.json` 的 `packageManager`。                                     |
| Electron | 39（已在 desktop devDependencies 锁定） | pi 生态 / undici 要求 ≥ 39（Node 22.19+）。                                   |

仓库是 pnpm workspace + ESM（`"type": "module"`）。

## 安装

```bash
pnpm install
```

## Node 与原生依赖 ABI

`better-sqlite3` 是原生模块，必须和加载它的运行时 ABI 一致：

- dev/test：pi-server 由系统 `node` 启动，加载系统 Node ABI 的 `better-sqlite3`。
- packaged：pi-server 由 Electron `utilityProcess.fork` 启动，加载 Electron ABI 的 `better-sqlite3`。

因此，“打包后统一使用 Electron bundled Node”并不意味着本地 dev/test 也使用 Electron ABI。避免在同一个 shell 里混用不同 Node 管理器；`node`、`pnpm exec node` 和 native rebuild 使用的 Node 应保持一致。

快速检查：

```bash
node -p "process.version + ' modules=' + process.versions.modules"
pnpm exec node -p "process.version + ' modules=' + process.versions.modules"
```

如果测试报 `NODE_MODULE_VERSION` mismatch，先恢复 pi-server 依赖到当前 Node ABI：

```bash
pnpm --filter @marginalia/pi-server run ensure:native
pnpm --filter @marginalia/pi-server test
```

`ensure:native` 会从 pi-server package path 打开 `better-sqlite3` 的 `:memory:` 数据库；只有遇到 native ABI mismatch 时才调用精确恢复命令。`pnpm --filter @marginalia/pi-server start` 直接用 `node` 运行同一个 check-only 脚本，遇到 mismatch 会失败并提示先回到 workspace 执行 `ensure:native`，不会在生产式启动里触发 rebuild。

不要用根目录的 `require("better-sqlite3")` 做判断，根 `node_modules` 可能存在另一份 native copy；也不要用宽泛的 `pnpm rebuild -r better-sqlite3`，它在这个 workspace/store 布局下容易留下错误或模糊的 ABI 状态。如果 `ensure:native` 本身无法恢复，再手动运行 `pnpm --filter @marginalia/desktop run rebuild:server-native` 作为 fallback，然后重新执行 pi-server 检查或测试。

## 启动开发环境

```bash
pnpm dev
```

它会先构建 pi-server，再用 `concurrently` 同时跑：

- pi-server 的 `build --watch`，
- desktop 的 `dev`——后者编译 Electron 侧 TS（`tsconfig.node.json`），起 Vite dev server，等其就绪后用 `VITE_DEV_SERVER_URL` 拉起 **Electron 应用**。

> `pnpm --filter @marginalia/desktop dev` 启动的是 **Electron 应用**（Vite + Electron 一起），不是浏览器页面。直接用浏览器打开 Vite 页面拿不到 `window.marginalia` 桥接，server 状态会显示不可用。

Electron 启动 pi-server 时会自动生成 Loopback Access bearer，通过 child environment 注入 server，
并只保留在 main。pi-server 在 agent 或工具初始化前读取 bearer 与开发 Origin，并立即从自己的
`process.env` 删除这两个变量，因此后续 Bash 工具子进程不会继承它们；开发者正常运行 `pnpm dev`
不需要手动管理凭据。preload bridge 给 renderer 的是受限 request capability 与
`marginalia://pi-server` 逻辑 URL，不含真实 loopback URL 或 bearer；该 scheme 不能由页面直接 fetch。
直接打开 Vite 浏览器页面没有这项 Electron capability，不是支持的调试
runtime；URL query/fragment 中旧的 `capabilityToken` 会被忽略并清除。

Electron 只接受 `http:`/`https:` 且 host 为 `127.0.0.1`、`localhost` 或 bracketed IPv6 loopback
`[::1]` 且不含 userinfo/credentials 的 `VITE_DEV_SERVER_URL`。其他 host、协议、credentials 或无效 URL
会被忽略并回退到 packaged renderer entry；这项校验也决定注入 pi-server 的 exact development Origin。

## 常用命令

全部包（根目录，`-r` 递归）：

```bash
pnpm build        # 构建所有包
pnpm test         # 测试所有包；pretest 会先跑 ensure:native
pnpm typecheck    # 类型检查所有包
pnpm lint         # eslint apps packages scripts
pnpm format       # prettier 写入
pnpm format:check # prettier 校验
pnpm docs:check   # 文档、API inventory、状态和生命周期检查
pnpm verify       # docs + format + lint + typecheck + test + build
```

根级 `dev`、`test` 和 `typecheck` 会先运行 `build:workspace-libs`，生成 `@marginalia/chat-core` 的 `dist` exports。不要依赖上一次本地构建残留的产物；这些命令必须在刚完成 `pnpm install` 的干净 checkout 中也能独立运行。

`docs:check` 的 diff 模式（`-- --base <ref>`）对二进制变更安全：截图基线等 PNG 不会让检查崩溃，也不能借二进制绕过 changed-line 规则。

单个包用 `--filter`：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server test # pretest 会先跑 ensure:native
pnpm --filter @marginalia/pi-server typecheck
pnpm --filter @marginalia/chat-core build
```

按名称/模式跑单个测试（Vitest run）：

```bash
pnpm --filter @marginalia/desktop test -- <pattern>
```

> desktop 的 `typecheck` 跑**两个** tsconfig——`tsconfig.json`（src）和 `tsconfig.node.json`（vite/electron 配置），两者都必须通过。

`pnpm verify` 不包含视觉差异裁决。UI 改动另跑 `pnpm verify:visual`，并查看每张 changed screenshot。

打包相关命令见[打包与发布](./build-and-release.md)。

## 相关环境变量

| 变量                         | 说明                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MARGINALIA_NODE_PATH`       | dev 下指定启动 pi-server 用的 `node` 二进制。                                                                                                                                                                                                                        |
| `MARGINALIA_DB_PATH`         | 覆盖 SQLite 路径（默认 `~/.marginalia/db.sqlite`）。                                                                                                                                                                                                                 |
| `MARGINALIA_LOOPBACK_BEARER` | Electron 启动 pi-server 时自动注入的进程 bearer；server 启动即复制到内存 policy 并从 `process.env` 删除，正常开发不要手工设置，也不要写入日志或 SQLite。                                                                                                             |
| `MARGINALIA_ALLOWED_ORIGIN`  | Electron 注入 exact renderer Origin：开发模式为已校验的 loopback Vite origin，打包模式为 `null`；server 启动即读取并从 `process.env` 删除。                                                                                                                          |
| `VITE_DEV_SERVER_URL`        | Electron 只从已校验的 IPv4/localhost/bracketed IPv6 loopback URL 加载 renderer；`pnpm dev` 自动设置。                                                                                                                                                                |
| `MARGINALIA_FAKE_AGENT`      | 设为 `1` 时 pi-server 用 `ScriptedFakeAgentClient`（`apps/pi-server/src/agent/scripted-fake-agent.ts`）替换真实 agent，按消息关键字回放确定性脚本（含审批事件）。**仅用于截图验证（`approval-flow` 场景）和本地调试**，不接入任何真实模型；不要在打包/生产环境设置。 |

完整清单见[配置 · 环境变量](../user/configuration.md#环境变量)。

## 代码约定

这些约定是仓库规则的一部分，完整内容见根 `AGENTS.md`。`CLAUDE.md` 是指向同一文件的 symlink，不单独维护。

- **ESM 导入扩展名**：TypeScript 源码导入即使是 `.ts`/`.tsx` 也写 `.js` 后缀，例如 `import { Foo } from "./Foo.js"`。漏写会导致构建失败。
- **`@/` 别名** → `apps/desktop/src/`（tsconfig + vite 都配了），跨目录导入优先用它。
- **i18n 强制**（`apps/desktop`）：每个面向用户的字符串（文本、`aria-label`、placeholder、toast）都要走 `t()`（`@/i18n/useTranslation.js`）。新增 key 要同时加到 `src/i18n/messages.ts` 的 `en` 和 `zh`——`zh` 用 `satisfies`，漏 key 会在 typecheck 报错。UI 里不允许硬编码英文。
- **设计 token**：视觉风格锁定在 mono + serif + emerald（见 `src/styles.css` + `tailwind.config.ts`）。用设计 token（`text-muted`、`border-soft`、`brand`、`.dot`、`.h-display` 等），不要写临时颜色。
- **聊天模型约定**：保持消息体为 pi 原生形状，不重新引入扁平化的 `UiMessage`/`UiToolCall`。详见[系统架构 · 单一事实源](./architecture.md#单一事实源single-source-of-truth)。
- **文档代码引用**：`docs/` 里指向源码时用 `path`（整文件）或 `path#符号`（文件内稳定的标识符 / 路由 / 字符串），**不要用 `path:line`**——行号会随上方代码变动而静默失真。引用写成 repo 根相对路径，根级守卫 `scripts/docs-check.test.mjs` 会校验文件存在、锚点命中，并在出现 `:line` 时报错。`apps/pi-server/dist` 这类生成目录会被明确跳过，因为 CI 在构建前运行文档检查；是否存在本地构建产物不能改变结果。需要精确到某一行时，用提交 SHA 固定的 GitHub permalink。

## 完成前检查

开发任务按[文档生命周期](./documentation-lifecycle.md)收口：

1. 先写或调整测试，确认它在实现前失败，再实现到通过。
2. 行为进入正常产品路径时，同步对应 user/developer 文档；能力、P0/P1 或发布决定变化时更新产品状态。
3. 开发中持续同步 active spec/plan 的进度和 Deviation。
4. 跑改动所在包的 typecheck 和相关 test。
5. 跑根级 `pnpm verify`。
6. UI 改动用 Electron 执行 `pnpm verify:visual`。每个 changed 截图都要裁决：有意更改用 `--update-baseline ... --reason "<原因>"` 更新，意外变化修复后重跑。
7. 功能关闭时写 `Implementation Outcome`，从活跃索引移除并归档。

浏览器打开 Vite 页面不能替代 Electron 验证。场景和输出见 `apps/desktop/scripts/README.md`。

## 测试

- `apps/desktop`：Vitest + jsdom + Testing Library。
- `apps/pi-server`、`packages/chat-core`：Vitest。

### 测试有效性准则

原则：**测行为，不复述实现；不为了测试而测试。** 一个测试若只是把实现里的常量/类名抄一遍再断言相等，或者测的是第三方库自身的行为，它不会捕获任何真实回归，应当删除或改写（2026-06 审计中已据此删除 `button.smoke.test.tsx`、`cn.test.ts`）。

仓库里有几类**模式特殊但有效**的测试，遇到时不要误删：

- **源码守卫测试**（`apps/desktop/src/test/vite-base.test.ts`、`apps/desktop/electron/dev-script.test.ts`、`apps/desktop/scripts/verify-screenshots.test.ts`、`scripts/docs-check.test.mjs`、`apps/pi-server/test/package-surface.test.ts`）：用读源码 + 正则的方式锁定打包、file URL 加载和文档契约等无法在 jsdom 里运行的行为。它们守护真实事故，注释中应写清原因。
- **设计规格锁**（如 `SettingsPrimitives.test.tsx` 对 Toggle 尺寸 class 的断言）：jsdom 拿不到真实几何，class 断言只用于锁定设计稿明确给出的规格值；真正的视觉验证以 Electron 截图 gate 为准，不要把 class 断言当成 UI 测试的常规手段。
- **Live 冒烟测试**（`minimax-smoke.test.ts`）：用 `describe.runIf(环境变量)` 门控，默认跳过，只在显式提供 API key 时跑真实链路。

## 截图验证

只做截图 capture：

```bash
pnpm verify:screenshots
```

常用调试命令：

```bash
pnpm --filter @marginalia/desktop verify:screenshots -- --list
pnpm --filter @marginalia/desktop verify:screenshots -- --scenario core-ui
```

验证刚构建的新功能（打开真 Electron，手动导航到新界面后输入标签截图，空行或 `q` 结束）：

```bash
pnpm verify:screenshots:shot
```

输出写到 `output/desktop-screenshots/`。runner 会设置隔离的 `MARGINALIA_DB_PATH`、`HOME` 和 `MARGINALIA_USER_DATA_DIR`，避免使用真实 `~/.marginalia` 状态。真实 MiniMax 场景是 opt-in：

```bash
MINIMAX_CN_API_KEY=... pnpm verify:screenshots:live
```

### 视觉回归与设计稿对比

**常用命令：**

- `pnpm verify:visual` — 截图后立即与基线比对（等价于先跑 `verify:screenshots` 再跑 `compare:screenshots`），UI 改动的标准门控。
- `pnpm --filter @marginalia/desktop compare:screenshots` — 只做基线比对，不重新截图，读上次 `output/desktop-screenshots/` 的产物。
- `pnpm --filter @marginalia/desktop compare:design <设计稿> --impl <scenario/label 或 png 路径>` — 生成设计稿三联图（设计稿 | 实现 | diff）供肉眼裁决。
- `--update-baseline <selector> --reason "<原因>"` — 显式将截图 bless 为新基线（**必须附原因**）。
- `--fail-on-diff` / `--max-diff-percent <n>` — CI 门控开关；不传时默认软报告，仅输出 diff 百分比供人工判断。

`pnpm verify:visual` 默认也沿用软报告行为。出现 changed 但命令返回 0 时，仍不能写成视觉通过。

**基线纪律：**

基线存放于 `apps/desktop/screenshots-baseline/`，只能通过 `--update-baseline` 显式更新，且必须附 `--reason`。`minimax-live` 与 adhoc 截图不进基线；遇到 `changed` 但不确定是否有意为之时，**不要 bless**，先排查原因。

**设计稿输入类型：**

支持 PNG（须 1280×800）、独立 HTML 文件、`http(s)://` URL；JSX 须先预渲染为 HTML 再传入。diff 百分比是趋势信号而非硬性门控，最终由人或 agent 读三联图按布局、间距、颜色 token 裁决。

**输出位置：**

比对结果写到 `output/visual-diff/report.json`、`output/visual-diff/report.md`，三联图位于 `output/visual-diff/design/` 目录下；所有输出均不入库（`.gitignore` 已排除）。

**确定性机制：**

截图时冻结渲染端时钟、隐藏输入框 caret、等待 `document.fonts.ready` 后连拍稳定帧再比对，排除动画与字体加载抖动。`seeded-workspace` 场景使用一个内容固定的 seed 工作区（而非真实仓库目录），让附件选择器 / @-mention / 文档面板等**文件列表类截图**不随仓库文件增减而漂移。

**新增功能的回归流程：**

实现一个新 UI 状态后，要让它纳入此后的自动回归保护：

1. 把该状态加进 `apps/desktop/scripts/verify-screenshots.mjs` 里对应场景的 `expected` 标签与 `run` 步骤（参考同场景已有截图；临时探索可先用 `pnpm verify:screenshots:shot` 拍 adhoc，但 adhoc **不进**基线）。
2. `pnpm verify:visual` 重新截图并比对——新标签会被标为 `new`（无基线）。
3. 读 `output/visual-diff/report.md` 确认新截图符合预期，再 bless 为基线：
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<原因>"`，提交新增的基线 PNG。
4. 此后每次 `pnpm verify:visual` 都会把该截图与基线比对；`changed` 时逐张裁决——有意改动用 `--update-baseline ... --reason` 更新，意外回归则修复，不确定则先排查不要 bless。

改动既有功能时同理：先 `pnpm verify:visual`，对每个 `changed` 截图按上述规则裁决。完整的「实现 → 截图 → 对比设计稿 → 迭代」循环见 `design-loop` skill。

## 相关文档

- 整体架构与进程模型：[系统架构](./architecture.md)
- 提交/分支/PR 规范：[贡献指南](./contributing.md)
- 文档同步、docs impact 和 closeout：[文档生命周期](./documentation-lifecycle.md)
- 当前验证快照和发布阻断：[产品状态](../product/status.md)

## Run 生命周期回归

`pnpm --filter @marginalia/pi-server test -- run-recovery.test.ts run-process.test.ts provider-chat.test.ts approval-flow.test.ts` 使用临时 SQLite/workspace、隔离 HOME 和可控 Agent 验证旧 Run 归一、历史保留、下一条输入、新权限与文件内容、SSE 断连、SIGTERM、server SIGKILL 和应用所有者 SIGKILL。无需模型网络或真实凭据。

`pnpm verify:screenshots -- --scenario run-recovery` 在真实 Electron 中操作停止、强杀该测试 server、用键盘激活 Retry，并在同 Session 发送新的 Run。它也是 `pnpm verify:visual` 的默认场景，新增 `server-stopped` 与 `server-restarted` 两张截图；仍需逐张判断差异。测试使用脚本 Agent，不声称模拟回复已持久化为真实 pi history。

`MARGINALIA_PARENT_PID` 仅由 Electron 注入用于存活检查，server 读取后从环境移除。独立启动 server 不需要该变量；退出处理接受 SIGTERM/SIGINT，最多等待 2 秒。

进程身份探测依赖 Unix 系统的 `/bin/ps` 或 Windows 自带 Windows PowerShell。测试不得把当前 PID 冒充旧进程而省略启动时间；PID 复用回归应给出不同的历史启动时间。Unix 的 `lstart` 只有秒级精度，无法区分同一秒内发生的 PID 复用；当前保留这一有限边界，不承诺强进程身份或安全隔离。

Bash 崩溃回归：`pnpm --filter @marginalia/pi-server test -- run-process.test.ts supervised-bash.test.ts`。使用真实 pi Session 和 Bash，仅替换模型流；验证 Ask 批准前无写入、Read-only 无 Bash，以及 server SIGKILL 后重启的新文件不会被旧 shell 延迟覆盖。不要用停在 fake approval 的测试替代活动工具进程测试。

真实 Bash worker 测试包含 Node/pi 冷启动，在 CI 并发负载下可能超过 Vitest 默认 5 秒；`apps/pi-server/test/supervised-bash.test.ts` 单独使用 20 秒测试与清理预算，不改变生产 Bash 超时。测试清理先 abort 并等待执行 settle，再删除临时 workspace；失败或超时也不能让存活 worker 访问已删除目录。

## 面板交互回归

`pnpm --filter @marginalia/desktop verify:screenshots --scenario desktop-panels` 使用既有 Electron 启动器、隔离 profile、临时 workspace/SQLite 和可控 Agent，实际执行外侧拖动、文件开合、应用内全屏、Escape、焦点限制、窄窗口和重载后的偏好恢复。它也是 `pnpm verify:visual` 的默认场景。截图与交互记录位于 `output/desktop-screenshots/`，必须逐张检查 changed/new；测试不使用真实 Provider 凭据或外部模型。
