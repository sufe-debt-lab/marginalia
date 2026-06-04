# pi-cowork 桌面 UI · 设计稿对齐设计

> 状态：草案（待 plan 展开）
> 作者：Claude（与 shixy 协作）
> 日期：2026-05-29
> 设计稿 bundle：`docs/internal/specs/assets/pi-cowork-design/`（含 README + 6 个 JSX 原型 + styles.css + 两份聊天记录 chat1/chat2）

## 背景

`apps/desktop` 已经经过 PR A–F（见 `git log`）把界面从裸 HTML 表单重写成 mono+serif+emerald 的三栏壳层，整体已经接近 Claude Design 导出的「pi-cowork desktop UI」设计稿。本 spec 把"设计稿 vs 当前实现"的差异、当前实现里的不合理点，整理成一份可落地的对齐计划。

**视觉基准来源**：设计稿 bundle 里的 6 个 React 原型（`shell.jsx` / `views.jsx` / `doc-panel.jsx` / `settings.jsx` / `app.jsx` / `styles.css`）是像素级真源；两份聊天记录是用户与设计助手的迭代意图，记录了"最终落在哪"。关键最终决策（来自 chat1/chat2）：

- 默认 `mono + serif + emerald + regular` + 中文
- 语言切换放到 Settings（不在侧栏底部）
- Settings tabs：通用 / 服务商（含模型）/ MCP / Skills；无"关于"；通用页保持简单
- 侧栏折叠 = 完全隐藏（不留 48px shortcut 条）
- Composer 对齐 Codex 截图：附件卡片 / Full access 权限 chip / `model · reasoning` chip / 黑色实心圆 Send / 无麦克风 / 模型展开菜单含 Reasoning 子项
- NewThread：去掉 git/权限 chip（与 composer 重复），只留 workspace 文件夹按钮、左对齐
- 顶栏：去掉前进/后退、去掉右上角设置图标
- 工作区"+"在"工作区"标题右侧（不在底部）
- 去掉全局"搜索/命令"功能

## 范围与决策

本轮对齐覆盖 P0（视觉收尾）+ P1（实现/交互重构）+ P2（依赖后端）。已确认决策：

| 项                | 决策                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ToolCard 工具卡片 | **改 pi-server 转发** pi SDK 的工具事件，前端渲染运行中/完成/失败                                                                                     |
| Providers 设置    | **预设快捷添加**（参考 `agent-harness/CodePilot`），裁剪为 openai / GLM(CN) / MiniMax(CN) / Xiaomi MiMo Token Plan；含模型列表/默认标/摘要条/连接诊断 |
| FirstRunView      | 按设计稿做欢迎页，**两步清单**（选目录 + 加 provider），**无 MCP 那步**                                                                               |
| MCP / Skills      | 本轮不做，Settings 中继续置灰                                                                                                                         |

## 非目标

- MCP / Skills 面板与侧栏入口（设计稿有，本轮排除）
- 设计稿 tweaks 面板的多主题/多字体/多密度切换（产品锁定 mono+serif+emerald+regular，不做运行时切换）
- 跨会话搜索 / 全局命令面板（已确认删除）
- 版本时间线、召唤式 Quick chat（用户已在设计阶段砍掉）
- 暗色模式
- 端到端 Playwright（继续 Vitest + RTL + Electron 截图）

## 当前实现与设计稿的差异（核对结论）

总体：壳层、Topbar、Composer 骨架、设计 token、DocumentPanel 框架已对齐。剩余差异：

### 重要缺失

1. **NewThread 缺"继续之前的会话"列表**——空态过于空旷。设计：workspace chip 下方一段 `Pick up where you left off`，每行 = 消息图标 + 标题 + `2h · 14 msgs · gpt-5.1` 元信息，点击进入该 session。
2. **Chat 消息流缺 ToolCard**——设计有 `read_document` / `edit_file` 工具卡片（状态点：运行中脉动 / 完成 / 失败）。当前 `MessageItem` 只渲染 user/assistant 文本。后端目前 SSE 只发 `run_started/assistant_delta/run_completed/run_failed`，**不发 tool 事件**。
3. **Settings → 服务商缺三块**：① 顶部"默认模型 / 当前工作区 / 推理预算"摘要条 ② "已连接 / 其他"分组 ③ 每 provider 展开的模型列表（default 标 + 启停开关）+ 连接诊断按钮。当前是扁平列表 + Test/Edit + 通用手填表单。

### 次要偏差

4. **Topbar 标题逻辑错**：new-thread/settings 应显示"新对话"/"设置"，当前显示 workspace 名（`AppShell.tsx` title 计算）。
5. **侧栏会话树缺**相对时间戳（现在/2h/昨天）+ 左侧竖向引导线（设计 `sb-session::before`）。
6. **流式 caret 未用**：`.caret` 已在 `styles.css` 定义，但 `MessageItem` 流式时不渲染。
7. **assistant 标签**：设计 `assistant · gpt-5.1`（带模型名），当前只有 `assistant`。
8. **缺 FirstRunView**：无 workspace 时当前进 NewThread 并禁用 Send，设计是独立欢迎引导页。
9. **General 缺"启动时打开上次会话"开关**。
10. **文案**：`新建聊天`→设计稿 `新对话`；个别 placeholder 用词不同。

### 已对齐（无需改）

- 三栏壳层 + hiddenInset + ResizeHandle、Topbar（已无前进后退/右上设置图标，info 仅 chat、panelRight 仅 chat）、Composer（附件卡片/权限 chip/模型 chip/黑圆 Send/无麦克风/模型菜单）、设计 token、侧栏"+"在标题右侧、折叠完全隐藏、Settings 4 tab（MCP/Skills 置灰）、DocumentPanel（tabs + 路径条 + tree/split + attach/edit）。

## 当前实现的不合理点（一并修）

1. **重复数据拉取**：`useWorkspaces` 在 Sidebar、NewThreadView 各拉一次；`useProviders` 在 NewThreadView、ChatView、ProvidersPane 各拉一次；`AppShell` 为拿标题用 `listSessions` 全量 find。同一份服务器数据被多处独立 fetch，无共享缓存。
2. **DocumentPanel 测试桩泄漏生产 DOM**：`data-testid="doc-tree-fallback"` 的 `sr-only` 区把每个文件又渲染一遍（pierre 树 + 隐藏按钮列表双份），大目录翻倍 DOM。应改为测试专用注入。
3. **Composer `/` 和 `@` 触发脆弱**：slash 只匹配整行 `^\/(\w*)$`；`@` 只在行尾触发、replace 只处理行尾 `@`。句中输入失效。
4. **Composer 附件 `+` 按钮无 onClick**（纯装饰）。
5. **权限 chip "完全访问" 偏红刺眼**：设计意图是焦糖橙警示 `oklch(0.58 0.17 35)`，当前偏红、在 emerald 主题下像报错。
6. **字体仅 CDN**：`index.html` 注释也写了离线前要打包本地 woff2；离线时回退系统字体，serif 标题质感丢失。

## 架构与实现拆分（7 个 PR）

每个 PR 独立可合、`pnpm dev` 可跑、遵守 commit gate（TDD + 该包 typecheck/test + UI commit 走 Electron 截图）。顺序：P0(A→B→C) → P1(D→E) → P2(F→G)。

### PR-A · NewThread 收尾 + Topbar 标题修正（P0，纯前端）

- **NewThread 最近会话列表**：新增组件读取当前 workspace 的最近 sessions（`useSessions`），渲染 `Pick up where you left off` 段（图标 + 标题 + `相对时间 · N msgs · model` 元信息），点击 = 选中 session 并切 chat。无 session 时整段隐藏。
- **Topbar 标题**：改 `AppShell` title 计算 —— `new-thread`→`t("newThread.tabTitle")`(新对话/New chat)、`settings`→`t("settings.title")`、`chat`→会话标题。
- 文件：`apps/desktop/src/chat/NewThreadView.tsx`、新增 `RecentThreads.tsx` + 测试、`apps/desktop/src/app/AppShell.tsx`、`i18n/messages.ts`。
- 验收：英文/中文各一张 Electron 截图，空态不再空旷；顶栏标题随 view 变化。

### PR-B · 侧栏 + 文案对齐（P0，纯前端）

- 会话树每行加相对时间戳（需要 `session.createdAt`/`updatedAt`，若 API 无则用 `useSessions` 现有字段，缺失则隐藏时间）+ 左侧竖向引导线（CSS `::before` 或 border-left）。
- 文案：`新建聊天`→`新对话`、对齐设计稿其余用词；en/zh 同步。
- 文件：`sidebar/WorkspaceTree.tsx`、`styles.css`（引导线）、`i18n/messages.ts`。
- 验收：侧栏截图对照设计稿 sb-session 样式。

### PR-C · Chat 流式细节（P0，纯前端）

- 流式中渲染 `.caret`（`MessageItem` / `MessageStream` 标记最后一条 assistant 为 streaming）。
- assistant 标签带模型名：`assistant · {model}`。
- ErrorRow 对齐设计：alert 图标 + `run_failed` 粗体 + danger-soft 背景 + 重试。
- 权限 chip 改设计的橙色调 token。
- 文件：`chat/MessageItem.tsx`、`chat/MessageStream.tsx`、`chat/Composer/PermissionChip.tsx`、`styles.css`/`tailwind.config.ts`（橙色 token）。
- 验收：streaming / done / error 三态截图。

### PR-D · 字体本地化 + 数据层去重（P1）

- **字体本地化**：用 `@fontsource`（Geist / Geist Mono / Source Serif 4）或下载 woff2 到 `public/fonts`，`styles.css` `@font-face` 本地引入，去掉 `index.html` 的 Google Fonts CDN（离线可用）。
- **数据去重**：引入轻量共享层——把 workspaces / providers 拉取提到 `AppShell` 并通过 props 或一个最小 context 下发，或封装带模块级缓存的 hook（`useWorkspaces`/`useProviders` 复用同一 promise）。`AppShell` 标题改用缓存数据而非 `listSessions` 全量。
- 文件：`package.json`、`index.html`、`styles.css`、`hooks/useWorkspaces.ts`、`hooks/useProviders.ts`、`app/AppShell.tsx`、相关测试。
- 验收：断网启动 serif 标题仍在；用 mock 计数确认 fetch 不再重复。

### PR-E · Composer 交互健壮化 + 清理测试桩（P1）

- slash `/` 和 `@` 支持句中触发（光标位置解析当前 token）、选中后正确替换该 token。
- 附件 `+` 按钮接通：点击走文件选择（mention 同源 or `pickWorkspaceDirectory` 同类 IPC），加入 contextFiles。
- 移除 `DocumentPanel` 的 `sr-only` 生产测试桩，改为测试专用（如 `DocumentTree` 暴露可注入的 onSelect 钩子或测试用 testid 仅在测试构建）。
- 文件：`chat/Composer/Composer.tsx`、`chat/Composer/MentionMenu.tsx`/`SlashMenu.tsx`、`documents/DocumentPanel.tsx`、`documents/DocumentTree.tsx`、相关测试。
- 验收：句中 `/`、`@` 用例测试；附件 + 可加文件；DocumentPanel 测试仍绿且生产 DOM 无重复。

### PR-F · 后端工具事件 + ToolCard（P2，动 pi-server）

- **pi-server**：`POST /sessions/:id/runs` run 路由在转发 `assistant_delta` 之外，转发 pi SDK 的工具事件（tool_call 开始 / tool_result 完成 / 失败），新增 SSE 类型如 `tool_started` / `tool_completed` / `tool_failed`（payload：工具名、参数摘要如文件路径、行数增减、状态）。
- **前端**：`api/client.ts` 的 `RunEvent` 扩展工具事件类型；`useStreamingChat` 把工具事件累积成消息流中的 tool item；`MessageStream` 渲染 `ToolCard`（状态点 pulse/ok/err + 图标 + 标题 + 文件路径 mono + 行数 meta）。
- 文件：`apps/pi-server/src/app.ts`（+ 测试 `provider-chat.test.ts` 扩展）、`apps/desktop/src/api/client.ts`、`hooks/useStreamingChat.ts`、新增 `chat/ToolCard.tsx` + 测试、`chat/MessageStream.tsx`。
- 验收：pi-server 测试断言 SSE 含工具事件；前端 mock SSE 渲染 ToolCard 三态；真实 MiniMax smoke（可选）看到工具卡片。
- 风险：pi SDK 的 `AgentSessionEvent` 工具事件结构需先核对（`@earendil-works/pi-coding-agent`）。若结构复杂，先支持最常见的 read/edit/bash，其余降级为通用 tool 卡片。

### PR-G · Providers 预设体系 + FirstRunView（P2，可能动 pi-server）

- **Provider 预设目录**：在 desktop 内建裁剪版 `provider-catalog`（仅 4 家：openai / GLM(CN) / MiniMax(CN) / Xiaomi MiMo Token Plan），含 name / baseUrl / 默认模型 / 文档与 key 链接 / billing 说明。映射到 pi-coding-agent 运行时（`minimax-cn` 等内置）。
- **快捷添加交互**（参考 CodePilot `provider-presets.tsx` / `ProviderManager.tsx`）：Add provider → 预设卡片列表 → 选一家 → 填 API key（+ 必要字段）→ 创建。替换当前"所有字段手填"为主路径（手填留作 fallback）。
- **Providers 面板对齐设计**：顶部摘要条（全局默认模型 / 当前工作区 / 推理预算 low-med-high）+ "已连接 / 其他"分组 + 每 provider 展开模型列表（default 标 + 开关）+ 连接诊断按钮（复用 `testProvider` 或新 `diagnostics`）。
- **General**：加"启动时打开上次会话"开关（写 store persist；默认关，沿用现有"启动落到 new-thread"语义）。
- **FirstRunView**：无 workspace 时替换当前空态——欢迎页 + 两步清单（① 选工作目录 ② 添加 provider），每步带完成态。
- 按需 **pi-server `listModels`**：若要展示某 provider 的完整模型列表（而非只 defaultModel），新增接口由 pi `ModelRegistry.getAvailable()` 提供；若成本高，首版用预设目录里的静态模型列表。
- 文件：新增 `settings/provider-catalog.ts`、`settings/ProviderPresetPicker.tsx`、改 `settings/SettingsView.tsx`、`chat/FirstRunView.tsx`、`store/app-store.ts`、（可选）`apps/pi-server/src/app.ts` + provider availability、i18n、测试。
- 验收：4 家预设可快捷添加；Providers 面板对照设计稿；无 workspace 进 FirstRun 两步清单；General 开关持久化。

## 数据流与状态

- 复用现有 Zustand `app-store`（view / locale / activeWorkspaceId / activeSessionId / pendingPrompt / contextFiles / 折叠 / 宽度 / pin / composer model+permission+reasoning）。PR-G 新增 `resumeLastSession: boolean`（persist）。
- 服务器数据（workspaces/sessions/providers/messages）仍由 hooks 拉取，PR-D 收敛为共享缓存而非每个消费者各拉一次。
- 工具事件（PR-F）进 `useStreamingChat` 的本地消息流，不进 store。

## 测试策略

- 继续 Vitest + jsdom + RTL；每个 PR TDD 闭环。
- pi-server 改动（PR-F、PR-G 可选）补 Hono app 路由测试 + fake agent/registry。
- 每个 UI commit 用 Electron 截图验收关键状态（英文 + 中文），存 `output/`；浏览器 Vite 页面不算。

## 失败 / 边缘场景

| 场景                   | 行为                                                   |
| ---------------------- | ------------------------------------------------------ |
| 无 workspace           | PR-G 后进 FirstRunView 两步清单（替换"禁用 Send"空态） |
| 最近会话为空           | NewThread 隐藏整个"继续之前的会话"段                   |
| session 无时间戳字段   | 侧栏时间戳隐藏，不报错                                 |
| 工具事件结构未识别     | ToolCard 降级为通用卡片（工具名 + 状态点），不崩       |
| provider 预设缺 key    | 快捷添加 Save 禁用，提示填 key                         |
| listModels 未实现/失败 | 退回预设目录静态模型列表                               |
| 字体本地加载失败       | 回退 `ui-sans-serif`/`Georgia` 系统栈（已有 fallback） |

## Open questions

- ToolCard 的 pi SDK 工具事件具体字段：实施 PR-F 第一步先打印真实 `AgentSessionEvent` 流确认，再定 SSE payload。
- Providers 摘要条的"当前工作区模型"是否要按 workspace 持久化：沿用现有 `session.model` 机制，不新增 workspace 级字段（除非实现中发现必要）。
- 推理预算条带（low/med/high）与 composer 的 reasoning 是否同一状态源：倾向共用 store `reasoning`，Settings 与 composer 双向同步。
