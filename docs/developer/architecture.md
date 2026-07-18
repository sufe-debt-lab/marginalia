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

Pi session 中的 user message 保留发给模型的完整 prompt，包括开头连续的原生 `<skill>` blocks 和末尾
Marginalia `<attached_files>` envelope。`packages/chat-core/src/user-display.ts` 定义实时与重开共用的展示
契约；其中 `normalizeAgentPromptForDisplay()`
（`packages/chat-core/src/user-display.ts#normalizeAgentPromptForDisplay`）严格解析连续 Skill blocks、只解码
builder 支持的五种 XML attribute entities、按原顺序生成 `$name` markers，并只移除完整匹配 Marginalia
builder 语法且位于字符串末尾的附件 envelope。疑似 Skill 前缀、未知 entity 或 closing-tag 歧义会保留整个
原 prompt；不完整附件 suffix 也保持可见。解析不查询当前 Catalog，因此磁盘上已删除的 Skill 仍按 session
内保存的 name 展示。

该 V1 边界只验证内部 serialization 的完整语法，不能证明 markup 的生成来源。用户若故意输入完全匹配
Marginalia grammar 的 leading Skill blocks 或 trailing attachment envelope，重开时也会按内部 prompt
归一化，可能隐藏该段原文；malformed、unknown entity 和 closing-tag ambiguity 仍 fail closed。绝对来源证明
需要另行设计可信 turn display metadata，本期不增加第二套 session 历史事实源。

`readMessagesFromSessionFile()`（`apps/pi-server/src/agent/session-messages.ts#readMessagesFromSessionFile`）
只对 string-content user message 创建展示副本并应用该归一化；array-content user message 仅克隆外层，assistant
与 tool result 保持原消息。读取过程不回写或改动 pi session 文件，模型历史继续使用落盘的完整 prompt。
共享的 `formatUserDisplayText()`（`packages/chat-core/src/user-display.ts#formatUserDisplayText`）保留给实时 user
bubble 使用，避免实时与重开各自维护 marker 排版规则。

SQLite schema 由 `migrate()`（`apps/pi-server/src/db/migrations.ts#migrate`）按版本顺序升级，每个版本
使用独立的 `BEGIN IMMEDIATE` transaction，并在取得写锁后重新检查版本，保证两个连接并发启动时只
应用一次。v1 transaction 在记录版本前建立既有 workspace/session/provider/run/approval 数据模型，
并补齐 `sessions.model` 与 `sessions.agent_session_path`；已记录 v1 的历史异常数据库也先在该 transaction
中幂等修复，再进入 v2。migration body、兼容修复和版本记录不会留下部分提交；v2 只增加
`skill_preferences`。`createSkillPreferenceStore()`
（`apps/pi-server/src/db/skill-preferences.ts#createSkillPreferenceStore`）以调用方已解析的 canonical
path 原字符串保存启停状态，缺省为启用，并通过单次 `list()` 为后续 Catalog 构造偏好 map。Store 不
检查文件是否仍存在，也不自动清理记录，因此被删除 Skill 的偏好会作为 tombstone 保留。Catalog 在
每次 refresh 中只调用一次 `list()` 构造内存 map；Skills HTTP 管理路由通过同一个 store 更新 preference。

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
effective winner 由下一阶段 Catalog reducer 处理。

### Skill catalog snapshot

`createSkillCatalogService()`（`apps/pi-server/src/skills/catalog.ts#createSkillCatalogService`）把 discovery
和 candidate parsing 组成两阶段 pipeline。第一阶段对每个 descriptor 独立调用 Task 6 loader，并保留
该稳定读取产生的 Pi Skill metadata、content hash、preview 与 diagnostics；reducer 不重新读盘或调用
Pi parser，也不使用 Pi 多路径加载后的 collision 结果反推 winner。

Reducer 先按 canonical path 保留 discovery 顺序中的第一个 alias，再通过一次 preference `list()` 构造
map。状态 precedence 是 invalid、disabled、name collision：没有 Pi Skill 的 candidate 为 `invalid`；
有效但 preference 关闭的 candidate 为 `disabled`；第一个 enabled valid name 为 `effective`，后续同名
candidate 为 `shadowed`，`shadowedBy` 指向 winner canonical path。Invalid 和 disabled candidate 不占
name，允许后续 candidate 接替。Snapshot 中的 candidate、diagnostic、Pi Skill 和 `sourceInfo` 都是
loader-owned 值的深拷贝并递归冻结，发布后不可变，同时不会冻结上游共享对象。

每个 shadowed loser 会在其 cloned diagnostics 末尾追加 Pi-compatible `pi_collision` warning：message
为 `name "<name>" collision`，diagnostic path 与 structured `loserPath` 使用 loser canonical path，
structured `winnerPath` 使用 winner canonical path，`resourceType` 固定为 `skill`。同一 diagnostic 同时
进入 snapshot aggregate diagnostics 和 `catalogRevision` projection；invalid、disabled 以及 canonical
first-wins 已移除的 alias 不生成 collision diagnostic。Task 6 对 Pi 原生 diagnostic 的映射也保留可选
`collision` identity（含 Pi 提供时的 source 字段）。

每个 snapshot 有两个稳定 SHA-256 revision。`catalogRevision` 的手工固定-key projection 覆盖 workspace
identity 以及全部管理可见 candidate 状态，包括 metadata、diagnostics、preference 结果、preview、
collision 和 content identity；`effectiveRevision` 只投影 discovery 顺序中的 effective Skill metadata、
canonical path 与正文 hash。`refreshedAt` 不进入 revision，因此同一状态重复 refresh 的 revision 不变；
非 effective candidate 或仅 diagnostic/preview 变化不会重建 runtime identity。

Refresh 开始时只解析一次 canonical workspace root，并把同一个值用于 cache key、discovery 和 snapshot，
避免排队期间 workspace symlink retarget 把新 target 的 candidate 发布到旧 key。Global-only 使用独立固定
key。Candidate descriptor 仍全部经过 Task 6 stable loader 后才按 canonical identity first-wins 去重，避免
提前丢掉 invalid/diagnostic candidate；loader 使用固定四 worker 并保持 descriptor result 顺序，限制并发
read/parse 数量。

每个 cache key 有 promise chain 和递增 generation：refresh 串行执行，只有调用时最高 generation 可以
发布到 `current()`；每次完成的成功结果也会在内部暂存。如果较新的 generation 失败，它向上 reject，并
保留或发布最近一次成功结果；stale success 仍不能覆盖 newer success。`setEnabled()` 先 refresh，再按
exact canonical path 验证当前 membership，只在命中后写 preference 并再次 refresh。Workspace symlink
或 candidate symlink retarget 后，旧 canonical selection 不再命中新 snapshot。

### Skills HTTP 管理边界

`createApp()`（`apps/pi-server/src/app.ts#createApp`）允许注入 `SkillCatalogService`；正常启动在数据库
migration 后用 `createSkillPreferenceStore()` 构造默认 Catalog。`GET /skills`、
`PATCH /skills/state` 和 `GET /skills/content` 都先执行进程 capability 与 exact-Origin 判定，再读取
query/body、查询 workspace 或调用 Catalog。缺失 `workspaceId` 固定解析为 global-only input，只扫描
三个 user roots；提供 ID 时只通过 `getWorkspace()` 取得 server-owned root，客户端不能指定 root。

两个 GET 每次都调用 `refresh()`。List route 通过 `toPublicSkillCatalogSnapshot()`
（`apps/pi-server/src/skills/catalog.ts#toPublicSkillCatalogSnapshot`）逐字段复制公开 DTO，不 spread 内部
candidate，也不发布 workspace root、preview/body、content hash、Pi Skill object 或 effective Skills。
Content route 在刚刷新的 `candidates` 中以 request path 做 exact canonical membership lookup，响应的
path、preview、截断状态和字节总数全部取自匹配 candidate；它不会对 request path 调用文件读取，也不会
在响应时重读 canonical target。

State route 只接受 `{ path: string, enabled: boolean, workspaceId?: string }`，再委托 Catalog 完成 refresh
→ membership → preference upsert → refresh。Typed missing member 映射为 404；Catalog/internal failure
统一映射为不含内部 path/bytes 的错误。该 API 只管理已经发现的文件，不创建、导入、安装、编辑或删除
Skill。

Desktop 尚未调用这三个管理 route，Settings Skills 入口仍禁用，Composer 也没有 picker。Run API
已经接受显式 Skill selections 并接通 runtime；因此这是可由受保护 API 使用的后端能力，仍不是普通
桌面流程可操作的用户功能。

## Agent session 与资源

每个 run 先在 capability auth 后以 bounded stream 读取最多 4 MiB body；declared/actual oversize 和
stream read failure 都会 best-effort cancel，reader 始终释放 lock。随后在持有 per-session lease 后
刷新一次 workspace Catalog，即使请求没有显式 Skill selection也一样。`prepareSkillTurn()`
（`apps/pi-server/src/skills/turn-preflight.ts#prepareSkillTurn`）先在去重前限制 16 个 raw selections 和
每个 identity field 16 KiB UTF-8，再只使用该 immutable snapshot：显式选择按 canonical path 首次去重
和排序，再按 exact path/name/status 校验；XML
block 的 body 只来自 snapshot `rawContent`，不会重新读盘。Builder 与 Pi 0.75.5 使用相同的 newline 和
frontmatter boundary，分别转义 XML attribute/text，并拒绝 XML 1.0 不支持的 control character。Prompt
拼接顺序固定为 Skill blocks → user text → trailing `attached_files` envelope。
Shadowed selection 的 typed 409 从 candidate `shadowedBy` 复制当前 winner canonical path 到
`winnerPath`；其他 invalid reason 的对象省略该字段。

显式 XML block 单项最多 512 KiB；全部 blocks 以 `blocks.join("\n\n")` 实际序列化后的 UTF-8 bytes
（包含分隔符）计量，最多 2 MiB。Pre-create typed Skill failure 保留 409/413；其他内部失败统一返回
`500 run_preparation_failed`，不暴露异常消息、内部 path 或 byte count。

同一 preflight 还产出 `{ effectiveRevision, loadResult }` runtime snapshot。`PiCodingAgentClient.prepare()`
为 run 构造 `DefaultResourceLoader`，保持 `noSkills: true` 以关闭磁盘 discovery，同时通过
`skillsOverride` 注入 pinned effective Skills 和 diagnostics；extension、prompt template、theme 和
context file discovery 也保持关闭，只注入 Marginalia 审批 extension。Explicit-only Skill 仍保留在
loader，供显式 block 调用；Pi 原生 `formatSkillsForPrompt()` 按 `disableModelInvocation` 把它排除在
隐式 system prompt 列表之外。启动 prompt 时服务端强制 `expandPromptTemplates: false`，禁止 Pi 原生
`/skill:name` 从 `skill.filePath` 重读磁盘；显式调用只能经过 snapshot preflight 生成的 block。
`prepare()` 不调用 prompt；`PreparedAgentRun.start()` 才建立事件订阅并启动 prompt，返回可中止的
事件流和始终可等待的 `settled` Promise。MCP 仍没有配置或工具注入链路。

AgentSession 由 `AgentSessionRegistry` 按 session ID 和 `resourceRevision` 缓存，其中 revision 固定使用
Catalog `effectiveRevision`。相同 revision 的 cache hit 复用 handle；revision 变化时先 dispose 旧
handle，再用同一个已持久化 `agentSessionPath` 创建 session。仅 diagnostic、disabled loser 或 preview
变化不会改变 effective revision，因此不会重建 session。Run lease 在整个 refresh/preflight/prepare/
execution settled 边界内阻止同 session 的第二次 refresh 或 acquire。Reasoning 仍通过 setter 动态更新，
权限工具集没有同类更新路径；provider、model 或 permission 变化时缓存仍不能保证一致。

Provider 的 `baseUrl` 会保存到 SQLite，但 run 只用 `piProviderId(provider.name)` 和 model ID 调用 `getModel()`，没有把该 URL 注入请求。Provider Test 只检查本地 ModelRegistry 和是否配置凭据，不验证 key 或网络。

## 当前信任边界

下面几项是已确认的 Alpha 限制，不应在其他文档中描述成已解决：

- run 和后续 Skills API 有每进程 capability 与 exact-Origin 检查，CORS 不再反射任意来源；但其他既有 loopback 路由仍未认证。这个局部边界不关闭 `P0-SEC-001`，随机 loopback 端口也不是授权边界。
- BrowserWindow 使用 context isolation 和 `nodeIntegration: false`，但 `sandbox: false`。
- Full 和 Ask 使用 pi 默认 coding tools。Workspace 只作为 cwd，工具可接收绝对路径，bash 使用宿主用户权限。
- HTTP 文件接口检查 lexical path 和已存在目标 realpath，但新目标的 symlink parent 仍可逃逸。
- Skill discovery 沿用 Pi symlink 语义，不要求 canonical target 留在 source root。持有 capability 的调用方
  只有在外部 target 已通过预先存在、可发现的 Skill symlink 成为当前 snapshot member 时才能取得其
  snapshot preview；单独提交任意 path 不会触发读取，content route 也不重读 target。
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
