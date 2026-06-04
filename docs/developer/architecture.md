# 系统架构

本文描述 Marginalia 的进程模型、启动流程和请求数据流，面向想理解或修改代码的贡献者。源码引用使用 `path:line` 形式，便于在编辑器中定位。

## 总览

Marginalia 是一个本地优先的桌面应用，由三个 pnpm workspace 包组成：

| 包                   | 名称                    | 角色                                                                |
| -------------------- | ----------------------- | ------------------------------------------------------------------- |
| `apps/desktop`       | `@marginalia/desktop`   | Electron 桌面壳 + React 渲染层（UI）。                              |
| `apps/pi-server`     | `@marginalia/pi-server` | 本机 HTTP 服务，封装 `@earendil-works/pi-coding-agent`。            |
| `packages/chat-core` | `@marginalia/chat-core` | pi 消息/工具类型的薄封装 + 渲染 helper，desktop 与 pi-server 共用。 |

整体数据流：

```
┌─────────────────────────── Electron 进程 ───────────────────────────┐
│                                                                     │
│  main 进程 (electron/main.ts)                                        │
│   • 开窗、splash、IPC                                                 │
│   • 后台启动 pi-server 子进程                                          │
│        │                                                            │
│        │ spawn / utilityProcess.fork                                │
│        ▼                                                            │
│  pi-server 子进程 (apps/pi-server)  ──►  @earendil-works/             │
│   • Hono HTTP，监听 127.0.0.1:<随机端口>      pi-coding-agent          │
│   • SQLite (~/.marginalia/db.sqlite)        + 各 LLM provider         │
│        ▲                                                            │
│        │ HTTP + SSE                                                 │
│        │                                                            │
│  renderer 进程 (apps/desktop/src, React)                             │
│   • ApiClient → pi-server                                           │
│   • 从原始 pi 事件派生聊天 UI                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

renderer 不直接接触文件系统或 LLM——所有能力都经本机 pi-server 的 HTTP/SSE 接口暴露。pi-server 只监听 `127.0.0.1`，不对外开放。

## 进程模型

### main 进程

`createWindow()`（`apps/desktop/electron/main.ts#createWindow`）创建窗口（macOS 用 `hiddenInset` 标题栏），并在渲染层 `did-finish-load` 后才后台启动 pi-server（`apps/desktop/electron/main.ts#did-finish-load`）——这样静态 splash 已经画出来，冷启动 server 的耗时不会阻塞首帧。

main 进程通过 `ipcMain.handle` 暴露给 renderer 的桥接：

| IPC 通道                   | 作用                    | 源码                                                     |
| -------------------------- | ----------------------- | -------------------------------------------------------- |
| `pi-server:status`         | 查询 pi-server 当前状态 | `apps/desktop/electron/main.ts#pi-server:status`         |
| `pi-server:restart`        | 杀掉并重启 pi-server    | `apps/desktop/electron/main.ts#pi-server:restart`        |
| `workspace:pick-directory` | 打开系统目录选择框      | `apps/desktop/electron/main.ts#workspace:pick-directory` |

这些通道经 `electron/preload.cts` 暴露到 renderer 的 `window.marginalia`（见 `getBridge()`，`apps/desktop/src/App.tsx#getBridge`）。

Electron 截图验证不再通过 renderer IPC；统一由
`apps/desktop/scripts/verify-screenshots.mjs` 用 Playwright 驱动 Electron 并写入
`output/desktop-screenshots/`。

### pi-server 子进程

pi-server 是一个独立的 Node 进程，入口 `apps/pi-server/src/index.ts`：用 `@hono/node-server` 在 `127.0.0.1:0`（端口 0 = 由系统分配空闲端口）起服务，就绪后向 stdout 打印一行 JSON `{"type":"ready","port":<n>}`。

main 进程的 `startPiServer()`（`apps/desktop/electron/pi-server-spawner.ts#startPiServer`）解析这行 ready 消息（`createReadyLineParser`，`apps/desktop/electron/pi-server-spawner.ts#createReadyLineParser`），拿到端口后把状态置为 `{ status: "ready", url: "http://127.0.0.1:<port>" }`。10 秒内未就绪则判定 `failed`。

**启动策略按 dev / packaged 区分**（见 `apps/desktop/electron/pi-server-spawner.ts#defaultLaunch`）：

- **开发**：用系统 Node（`MARGINALIA_NODE_PATH` 或 PATH 中的 `node`）`child_process.spawn` 运行 `apps/pi-server/dist/index.js`。此时 better-sqlite3 的原生 ABI 与 `pnpm install` 编译出的一致。
- **打包**：用 Electron 内置 Node 经 `utilityProcess.fork` 运行随包发布的 `resources/pi-server/dist/index.js`，**客户端无需安装 Node**。此时 better-sqlite3 必须匹配 Electron 的 ABI——打包脚本会专门重建它（见 [打包与发布](./build-and-release.md)）。

脚本路径解析见 `resolvePiServerScriptPath`（`apps/desktop/electron/pi-server-spawner.ts#resolvePiServerScriptPath`）：dev 走 monorepo 内的 `apps/pi-server/dist`，packaged 走 `process.resourcesPath/pi-server/dist`。

### renderer 进程

React 应用入口 `apps/desktop/src/main.tsx` → `App.tsx`。`App` 负责启动期状态机（`apps/desktop/src/App.tsx#App`）：

1. 轮询 `pi-server:status`，`starting` 时显示 `LoadingSplash`，每 250ms 再查（`apps/desktop/src/App.tsx#refreshStatus`）。
2. server `ready` 后请求 `GET /health` 做一次健康校验（`apps/desktop/src/App.tsx#loadHealth`）。
3. 通过则渲染 `AppShell`，否则显示错误 + 重试按钮（重试走 `pi-server:restart`）。

`AppShell`（`apps/desktop/src/app/AppShell.tsx#AppShell`）是三栏布局：左 `Sidebar`（workspace/session 树）、中主区（`ChatView` / `SettingsView` / `FirstRunView` / `NewThreadView` 按 `view` 状态切换）、右 `DocumentPanel`（仅在 chat 视图且有活跃 workspace 时显示）。视图状态由 zustand store `apps/desktop/src/store/app-store.ts` 管理。

## 请求数据流

renderer 通过 `ApiClient`（`apps/desktop/src/api/client.ts#ApiClient`）调用 pi-server。`useApi(serverUrl)`（`apps/desktop/src/hooks/useApi.ts`）用 main 进程拿到的 server URL 实例化它，各 `use*` hook（`useWorkspaces`、`useSessions`、`useMessages`、`useProviders`、`useStreamingChat` 等）在其上封装数据获取与状态。

一次对话的完整链路：

1. renderer 调 `ApiClient.runChat(sessionId, …)`（`apps/desktop/src/api/client.ts#runChat`）→ `POST /sessions/:sessionId/runs`。
2. pi-server 路由（`apps/pi-server/src/app.ts#/sessions/:sessionId/runs`）建一条 `run` 记录，开 SSE 流，先发 `run_started`。
3. 调 `agentClient.run(...)`（`PiCodingAgentClient`，`apps/pi-server/src/agent/pi-coding-agent-client.ts`），后者驱动 `@earendil-works/pi-coding-agent` 与选定 provider 对话。若带 `@文件` 上下文，`buildAgentMessage`（`apps/pi-server/src/app.ts#buildAgentMessage`）会把文件内容内联进消息。
4. agent 产出的**原始 pi 事件**被原样包进 `agent_event` 逐条 SSE 推回（`apps/pi-server/src/app.ts#agent_event`）。
5. 结束时发 `run_completed`，出错发 `run_failed`，并落 `runs` 表（`apps/pi-server/src/app.ts#completeRun`）。
6. renderer 端 `streamSse`（`apps/desktop/src/api/sse-stream.ts`）解析流，`useStreamingChat` 从原始事件派生气泡、增量文本、工具卡片、思考指示等所有 UI。

### 单一事实源（single source of truth）

这是聊天渲染的核心设计约定：**pi-server 只转发原始 pi `agent_event`，外加 run 级信封（`run_started` / `run_failed` / `run_completed`）；不把它们重映射成 desktop 专用的 delta/tool 事件形状**（见 `apps/pi-server/src/app.ts#agent_event` 的注释）。

由此带来的不变量（见 `CLAUDE.md` 的 Chat model conventions）：

- 聊天历史是 `ChatEntry = { id, message }`（来自 `@marginalia/chat-core`），消息体保持 pi 原生形状，不引入扁平化的 `UiMessage`/`UiToolCall` 或假角色（如 `system`）。
- UI 状态完全从 entries 派生：assistant 的 `toolCall` 内容渲染为工具 UI；带相同 `toolCallId` 的 `toolResult` 消息挂到对应工具卡片上，而非独立气泡。
- 实时流式与重开会话的渲染必须一致，都以 pi `message_start` 作为 assistant 气泡边界。

历史消息的读取也分两种来源（`apps/pi-server/src/app.ts#readMessagesFromSessionFile`）：若该 session 已有 `agentSessionPath`（pi 落盘的 session 文件），从该文件读；否则从 SQLite 的 `messages` 表读并转成 `ChatEntry`。

## 包依赖关系

```
@marginalia/desktop ──┬──► @marginalia/chat-core ──► @earendil-works/pi-ai
                      │                              @earendil-works/pi-agent-core
                      └──► (HTTP/SSE) ──► @marginalia/pi-server
                                              │
                                              ├──► @marginalia/chat-core
                                              ├──► @earendil-works/pi-coding-agent
                                              ├──► @earendil-works/pi-ai
                                              ├──► hono / @hono/node-server
                                              └──► better-sqlite3
```

`chat-core` 刻意保持成 pi 类型之上的薄桥接层——优先复用 `@earendil-works/pi-ai` / `@earendil-works/pi-agent-core` 的消息和工具类型，而非自己重复定义 schema。

## 相关文档

- 数据模型、HTTP 路由、SSE 事件格式：[API 参考](./api.md)
- 打包时如何处理 better-sqlite3 原生 ABI：[打包与发布](./build-and-release.md)
- 环境变量、provider、存储位置：[配置](../user/configuration.md)
