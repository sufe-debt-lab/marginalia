# 系统架构

本文描述 Marginalia 的进程模型、启动流程、请求数据流和当前信任边界。源码引用使用仓库根相对的 `path` 或 `path#symbol`，不使用容易漂移的行号。

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

Renderer 不直接加载 Node API。Workspace 文件和 LLM 请求主要经过 pi-server；系统目录选择、外部链接和导出 `.md` 走 preload 到 Electron main 的 IPC。pi-server 只监听 `127.0.0.1`。每次启动生成的进程 capability 只保护 run 和后续 Skills API；其余既有 API 仍未认证。

## 进程模型

### main 进程

`createWindow()`（`apps/desktop/electron/main.ts#createWindow`）创建窗口（macOS 用 `hiddenInset` 标题栏），并在渲染层 `did-finish-load` 后才后台启动 pi-server（`apps/desktop/electron/main.ts#did-finish-load`）——这样静态 splash 已经画出来，冷启动 server 的耗时不会阻塞首帧。

main 进程通过 `ipcMain.handle` 暴露给 renderer 的桥接：

| IPC 通道                    | 作用                                                                                                                                               | 源码                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pi-server:status`          | 查询 pi-server 当前状态                                                                                                                            | `apps/desktop/electron/main.ts#pi-server:status`          |
| `pi-server:restart`         | 杀掉并重启 pi-server                                                                                                                               | `apps/desktop/electron/main.ts#pi-server:restart`         |
| `workspace:pick-directory`  | 打开系统目录选择框                                                                                                                                 | `apps/desktop/electron/main.ts#workspace:pick-directory`  |
| `marginalia:open-external`  | 在系统浏览器打开 HTTP(S) URL                                                                                                                       | `apps/desktop/electron/main.ts#marginalia:open-external`  |
| `marginalia:save-text-file` | 弹出保存对话框，写入 .md 文件；成功返回 `{ saved: true, path }`，取消返回 `{ saved: false }`，写盘失败返回 `{ saved: false, error }` 而不是 reject | `apps/desktop/electron/main.ts#marginalia:save-text-file` |

这些通道经 `electron/preload.cts` 暴露到 renderer 的 `window.marginalia`。Main 对保存输入只做 TypeScript 断言，没有完整 runtime schema；扩展 IPC 时必须验证来自 renderer 的值。

Electron 截图验证不再通过 renderer IPC；统一由
`apps/desktop/scripts/verify-screenshots.mjs` 用 Playwright 驱动 Electron 并写入
`output/desktop-screenshots/`。

### pi-server 子进程

pi-server 是一个独立的 Node 进程，入口 `apps/pi-server/src/index.ts`：用 `@hono/node-server` 在 `127.0.0.1:0`（端口 0 = 由系统分配空闲端口）起服务，就绪后向 stdout 打印一行 JSON `{"type":"ready","port":<n>}`。

main 进程的 `startPiServer()`（`apps/desktop/electron/pi-server-spawner.ts#startPiServer`）每次启动用 32 字节随机数生成 base64url capability token，通过 child environment 的 `MARGINALIA_CAPABILITY_TOKEN` 注入；开发模式还只把经过 loopback 校验的 Vite URL `.origin` 作为 `MARGINALIA_ALLOWED_ORIGIN` 注入。token 不进入 ready stdout、日志或 SQLite。解析 ready 行后，main 内部状态变为 `{ status: "ready", url: "http://127.0.0.1:<port>", capabilityToken, process }`，经 preload 序列化给 renderer 时移除 `process`、保留 token。10 秒内未就绪则判定 `failed`。

当前 exit listener 只解决“启动前退出”。进程在 ready 后崩溃时，main 中的 `serverStatus` 可能继续显示 ready，直到普通 API 调用失败；完整恢复见 readiness issue `P1-RECOVERY-001`。

**启动策略按 dev / packaged 区分**（见 `apps/desktop/electron/pi-server-spawner.ts#defaultLaunch`）：

- **开发**：用系统 Node（`MARGINALIA_NODE_PATH` 或 PATH 中的 `node`）`child_process.spawn` 运行 `apps/pi-server/dist/index.js`。此时 better-sqlite3 的原生 ABI 与 `pnpm install` 编译出的一致。
- **打包**：用 Electron 内置 Node 经 `utilityProcess.fork` 运行随包发布的 `resources/pi-server/dist/index.js`，**客户端无需安装 Node**。此时 better-sqlite3 必须匹配 Electron 的 ABI——打包脚本会专门重建它（见 [打包与发布](./build-and-release.md)）。

脚本路径解析见 `resolvePiServerScriptPath`（`apps/desktop/electron/pi-server-spawner.ts#resolvePiServerScriptPath`）：dev 走 monorepo 内的 `apps/pi-server/dist`，packaged 走 `process.resourcesPath/pi-server/dist`。

### renderer 进程

React 应用入口 `apps/desktop/src/main.tsx` → `App.tsx`。`App` 负责启动期状态机（`apps/desktop/src/App.tsx#App`）：

1. 轮询 `pi-server:status`，`starting` 时显示 `LoadingSplash`，每 250ms 再查（`apps/desktop/src/App.tsx#refreshStatus`）。
2. server `ready` 后请求 `GET /health` 做一次健康校验（`apps/desktop/src/App.tsx#loadHealth`）。
3. 通过则渲染 `AppShell`，否则显示错误 + 重试按钮（重试走 `pi-server:restart`）。

`AppShell`（`apps/desktop/src/app/AppShell.tsx#AppShell`）接收可信的 server URL 与 capability token，并据此构造 `ApiClient`。它是三栏布局：左 `Sidebar`（workspace/session 树）、中主区（`ChatView` / `SettingsView` / `FirstRunView` / `NewThreadView` 按 `view` 状态切换）、右 `DocumentPanel`（仅在 chat 视图且有活跃 workspace 时显示）。视图状态由 zustand store `apps/desktop/src/store/app-store.ts` 管理。

## 请求数据流

renderer 通过 `ApiClient`（`apps/desktop/src/api/client.ts#ApiClient`）调用 pi-server。`useApi(serverUrl, capabilityToken)`（`apps/desktop/src/hooks/useApi.ts`）用 main 进程拿到的 server URL 与 token 实例化它；普通 workspace/provider/document API 不发送 token，run 和后续 Skills API 才使用 bearer。各 `use*` hook（`useWorkspaces`、`useSessions`、`useMessages`、`useProviders`、`useStreamingChat` 等）在其上封装数据获取与状态。

一次对话的完整链路：

1. renderer 调 `ApiClient.runChat(sessionId, …)`（`apps/desktop/src/api/client.ts#runChat`），携带进程 bearer → `POST /sessions/:sessionId/runs`。
2. pi-server 路由（`apps/pi-server/src/app.ts#/sessions/:sessionId/runs`）按 capability auth → session/workspace lookup → request decode/validation（含 provider）顺序建立请求上下文。随后通过 `SessionRunLeases`（`apps/pi-server/src/run/session-run-leases.ts#SessionRunLeases`）取得该 session 的进程内 single-flight lease；重叠请求返回 `409 session_busy`，且不创建 run。
3. lease 内先由 `buildAgentMessage`（`apps/pi-server/src/agent/agent-message.ts#buildAgentMessage`）构造附件信封，再调 `agentClient.prepare(...)`（`PiCodingAgentClient`，`apps/pi-server/src/agent/pi-coding-agent-client.ts`）取得已配置的 session。两步都成功后才创建 `runs` 记录并打开 SSE。
4. SSE 先发 `run_started`，再以 `start(message)` 驱动 `@earendil-works/pi-coding-agent`。agent 产出的**原始 pi 事件**被原样包进 `agent_event` 逐条推回（`apps/pi-server/src/app.ts#agent_event`）。
5. 正常结束时发 `run_completed`，出错发 `run_failed`，并完成 `runs` 表记录（`apps/pi-server/src/app.ts#completeRun`）。SSE disconnect 或事件异常会请求 `execution.abort()` 并立即拒绝挂起审批；request abort listener 保持安装直到 `execution.settled` 完成，随后 route 才执行幂等的审批清理、释放 lease。正常事件结束不会额外 abort。
6. renderer 端 `streamSse`（`apps/desktop/src/api/sse-stream.ts`）解析流，`useStreamingChat` 从原始事件派生气泡、增量文本、工具卡片、思考指示等所有 UI。

服务端 single-flight 防止同一进程内两个请求并发驱动相同 session；不同 session 不共享 lease。该
lease 不跨 pi-server 重启持久化，renderer 的 `sendingRef` 也仍只保护当前 hook 实例；ChatView
卸载后的主动停止和崩溃恢复仍属于 readiness issue `P0-RUN-001` / `P1-RECOVERY-001` 的剩余范围。

### 单一事实源（single source of truth）

这是聊天渲染的核心设计约定：**pi-server 只转发原始 pi `agent_event`，外加 Marginalia 的 run/approval 信封（`run_started`、`approval_requested`、`approval_resolved`、`run_failed`、`run_completed`）；不把原始 pi 事件重映射成 desktop 专用的 delta/tool 事件形状**（见 `apps/pi-server/src/app.ts#agent_event` 的注释）。

由此带来的不变量（见 `AGENTS.md` 的 Chat model conventions）：

- 聊天历史是 `ChatEntry = { id, message }`（来自 `@marginalia/chat-core`），消息体保持 pi 原生形状，不引入扁平化的 `UiMessage`/`UiToolCall` 或假角色（如 `system`）。
- UI 状态完全从 entries 派生：assistant 的 `toolCall` 内容渲染为工具 UI；带相同 `toolCallId` 的 `toolResult` 消息挂到对应工具卡片上，而非独立气泡。
- 实时流式与重开会话的渲染必须一致，都以 pi `message_start` 作为 assistant 气泡边界。

历史消息的读取也分两种来源（`apps/pi-server/src/app.ts#readMessagesFromSessionFile`）：若该 session 已有 `agentSessionPath`（pi 落盘的 session 文件），从该文件读；否则从 SQLite 的 `messages` 表读并转成 `ChatEntry`。

SQLite schema 由 `migrate()`（`apps/pi-server/src/db/migrations.ts#migrate`）按版本顺序升级，每个版本
使用独立的 `BEGIN IMMEDIATE` transaction，并在取得写锁后重新检查版本，保证两个连接并发启动时只
应用一次。v1 transaction 在记录版本前建立既有 workspace/session/provider/run/approval 数据模型，
并补齐 `sessions.model` 与 `sessions.agent_session_path`；已记录 v1 的历史异常数据库也先在该 transaction
中幂等修复，再进入 v2。migration body、兼容修复和版本记录不会留下部分提交；v2 只增加
`skill_preferences`。`createSkillPreferenceStore()`
（`apps/pi-server/src/db/skill-preferences.ts#createSkillPreferenceStore`）以调用方已解析的 canonical
path 原字符串保存启停状态，缺省为启用，并通过单次 `list()` 为后续 Catalog 构造偏好 map。Store 不
检查文件是否仍存在，也不自动清理记录，因此被删除 Skill 的偏好会作为 tombstone 保留。Catalog
和 HTTP 接入仍由后续任务实现。

### Skill discovery descriptor

`discoverSkillFiles()`（`apps/pi-server/src/skills/discovery.ts#discoverSkillFiles`）实现六级磁盘 root
枚举：workspace `.marginalia`、workspace `.pi`、由近到远的 ancestor `.agents`、user
`.marginalia`、user `.pi`、user `.agents`。Ancestor 在 Git root（`.git` 可为目录或 worktree
文件）停止并包含该 root；没有 Git marker 时到 filesystem root。每个已存在 root 通过 realpath 与
global `~/.agents/skills` 比较，避免同一 global root 以 workspace ancestor 和 user source 重复出现；
缺失 root 不会让 discovery 失败。

每个 root 委托 Pi 导出的 `loadSkillsFromDir()` 扫描，以复用 Pi 的 root Markdown、递归
`SKILL.md`、ignore 和 symlink 语义。Discovery 合并 `skills[].filePath` 与
`diagnostics[].path`，因此缺 description 等未被 Pi 解析成 Skill 的文件仍有 descriptor，后续阶段可
产生完整 invalid 状态。Agents mode 在合并后只保留 basename 为 `SKILL.md` 的 path。

该层只产出 `DiscoveredSkillFile` descriptor：discovered path、source root、POSIX relative path、
source/scope/mode、source priority 和 ancestor depth。它不读取或解析 candidate metadata，不做
canonical file identity 去重、preference、name collision 或 effective winner 判定；这些属于后续
Catalog pipeline。输出固定按 source priority、ancestor depth、relative path 的 Unicode code-point
顺序排列，不依赖 `readdir` 顺序。

### Skill candidate 稳定解析

`loadSkillCandidate()`（`apps/pi-server/src/skills/candidate-loader.ts#loadSkillCandidate`）一次只处理
一个 discovery descriptor。每次尝试严格执行 discovered path realpath、读取 bytes A、以 canonical
path 单独调用 Pi `loadSkills()`、再次 realpath、读取 bytes B；Pi 调用固定
`skillPaths: [canonicalPath]` 和 `includeDefaults: false`。只有两次 canonical path 相等且 bytes 的
SHA-256 相等时，才发布夹在两次读取之间得到的 Pi metadata、diagnostics 与 bytes B。路径或内容不一致
最多重试三次；持续变化、realpath、读取或 parser 失败只把当前 candidate 变成 invalid diagnostic，
不会使整个 Catalog refresh reject。

Pi 返回 `Skill` 即保留为 valid，即使同时返回 warning；Pi 没有返回 `Skill` 才是解析 invalid。稳定
bytes 用 UTF-8 解码，`bytesTotal` 和大小限制始终按 Buffer bytes 判断。显式调用的正文上限为 512 KiB
（边界包含），preview 上限为 256 KiB；超过正文上限或 name、canonical path、canonical base directory
含 XML 1.0 不允许的字符时，candidate 仍保留 Pi metadata 和 preview，但
`explicitEligible: false`、`rawContent: null`。`disable-model-invocation` 直接映射为 `explicitOnly`，
完整稳定内容用 SHA-256 `contentHash` 标识。Preference、canonical identity 去重、同名 collision 和
effective winner 仍属于后续 Catalog 阶段。

## Agent session 与资源

`PiCodingAgentClient.prepare()` 为每次 run 构造 `DefaultResourceLoader`，关闭磁盘 extension、skills、prompt template、theme 和 context file 发现，只注入 Marginalia 的审批 extension，并取得已配置的 AgentSession；此阶段不会调用 prompt。`PreparedAgentRun.start()` 才建立事件订阅并启动 prompt，返回可中止的事件流和始终可等待的 `settled` Promise。Skills 因 `noSkills: true` 处于禁用状态；MCP 没有配置或工具注入链路。

AgentSession 由 `AgentSessionRegistry` 按 session ID 缓存。首次创建时传入 model、resource loader、tool allowlist 和 session manager；缓存命中后直接返回旧 handle，不重新应用配置。Reasoning 通过 setter 动态更新，权限工具集没有同类更新路径。Provider、model、permission 或资源边界变化时，当前缓存不能保证一致。

Provider 的 `baseUrl` 会保存到 SQLite，但 run 只用 `piProviderId(provider.name)` 和 model ID 调用 `getModel()`，没有把该 URL 注入请求。Provider Test 只检查本地 ModelRegistry 和是否配置凭据，不验证 key 或网络。

## 当前信任边界

下面几项是已确认的 Alpha 限制，不应在其他文档中描述成已解决：

- run 和后续 Skills API 有每进程 capability 与 exact-Origin 检查，CORS 不再反射任意来源；但其他既有 loopback 路由仍未认证。这个局部边界不关闭 `P0-SEC-001`，随机 loopback 端口也不是授权边界。
- BrowserWindow 使用 context isolation 和 `nodeIntegration: false`，但 `sandbox: false`。
- Full 和 Ask 使用 pi 默认 coding tools。Workspace 只作为 cwd，工具可接收绝对路径，bash 使用宿主用户权限。
- HTTP 文件接口检查 lexical path 和已存在目标 realpath，但新目标的 symlink parent 仍可逃逸。
- Ask 审批按字符串前缀判断 shell，新文件 write 默认直通；Read-only 还受缓存 session 配置影响。
- Provider key 以明文写入 SQLite。

修复目标和验收条件见[产品就绪审计](./issues/2026-07-11-product-readiness-audit.md)。

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
