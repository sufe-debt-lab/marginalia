# pi-coding-agent Electron 套壳：MiniMax 调通设计

> 状态：草案
> 作者：Claude（与 shixy 协作）
> 范围：单一 spec，可被一份 plan 完整覆盖

## 1. 目标

Electron 桌面端能够通过 `apps/pi-server` 调用本地已配置的 MiniMax (China) 模型完成最基本的多轮 chat：
- 用户在 `ChatView` 输入消息 → pi-server 走 `@earendil-works/pi-coding-agent` → MiniMax 返回 → UI 流式显示
- 每条会话的真源是 pi-coding-agent 持久化的 session 文件，不再依赖 pi-server 自维护的 `messages` 表
- 删除自研的 OpenAI-compatible streaming/tester 实现，全部能力下沉到 pi SDK
- 项目立项目标：**"作为 pi 的 Electron 套壳能跑通 agent 最基本交互"**

不在本 spec 范围：
- 工具调用 UI（read/bash/edit/write 等执行过程的可视化）— 沿用文本输出，不专门设计组件
- Provider 管理 UI 重做（仅做"能选已配置 provider"最小改动）
- 多 workspace 切换体验改进
- Auth 流（OAuth、长期 token 轮换）

## 2. 上下文

### 2.1 现状

`apps/pi-server` 当前调用栈：

```
ChatView.send()
  → ApiClient.runChat
    → POST /sessions/:id/runs (Hono)
      → PiAgentClient.stream  (基于 @earendil-works/pi-agent-core@0.75.5 的 agentLoop)
        → OpenAI-completions HTTP 直连
```

并行还有一份 `OpenAICompatibleAgentClient`（HTTP fetch 流式），以及 `OpenAICompatibleProviderTester`（独立 HTTP /chat/completions ping）。

存在的问题：
1. `ChatView` 永远使用 `providers[0]`（数据库里最早一条是测试用 OpenAI），不会选 MiniMax — 这是当前调不通的最直接根因
2. `POST /sessions/:id/runs` 把所有 SSE event 累积成字符串后一次性 `Response`，并非真流式
3. 自研类型 `AgentStreamInput / AgentStreamChunk / RunEvent` 与 pi SDK 类型重叠，违反"优先用 pi 类型"原则
4. 消息真源分裂：pi-server 用 SQLite `messages` 表，pi SDK 又有自己的 session JSONL；两者迟早冲突
5. provider tester 自行打 `/chat/completions`，与 pi 的 `ModelRegistry.getAvailable()` 重复

### 2.2 已就绪

- 本地 SQLite (`~/.marginalia/db.sqlite`) 里已有一条可用的 Minimax provider（`MINIMAX_API_KEY` 125 字符）+ `MiniMax-M2.7` 模型
- `@earendil-works/pi-ai@0.75.5` **内置**了 `minimax-cn` provider：
  - id `minimax-cn`、baseUrl `https://api.minimaxi.com/anthropic`、api `anthropic-messages`
  - 模型 `MiniMax-M2.7` 已在 `models.generated.js`
  - 不需要注册自定义 provider，只需 `AuthStorage.setRuntimeApiKey("minimax-cn", key)`
- `@earendil-works/pi-coding-agent@0.75.5` 暴露的关键导出：
  - `createAgentSession(options)` → `{ session: AgentSession }`
  - `AgentSession.subscribe(fn)`、`session.prompt(text)`、`session.state.messages`、`session.dispose()`
  - 类型 `AgentSessionEvent`、`AgentSessionConfig`、`PromptOptions`、`SessionContext`
  - `SessionManager.create(cwd)` / `.open(path)` / `.inMemory(cwd)`
  - `AuthStorage.create(path?)` + `setRuntimeApiKey(provider, key)`
  - `ModelRegistry.create(authStorage)` + `getAvailable()`
  - `parseSessionEntries`、`buildSessionContext` 用于读 session 文件
  - 默认工具：`read/bash/edit/write/grep/find/ls`（本 spec 启用全套）

### 2.3 用户选择

| 决策点 | 选项 | 选择 |
|---|---|---|
| Agent 包 | pi-agent-core vs pi-coding-agent | **pi-coding-agent** |
| AgentSession 生命周期 | 每请求新建 / 按 UI sessionId 缓存 / **SessionManager 文件持久化** | **SessionManager.create() 文件持久化** |
| 工具集 | 纯对话 / 只读 / **全套默认** | **全套默认** |
| 类型来源 | pi 优先 | **直接 re-export pi 的类型，不能满足才自定义** |
| 旧代码 | 重构优先 | **删除自研 OpenAI-compat client/tester，重构 agent-client 接口** |

## 3. 架构

### 3.1 数据流（新）

```
ChatView.send(draft)
  → ApiClient.runChat  (POST /sessions/:id/runs, fetch + body.getReader)
    → app.ts runs route
      → AgentSessionRegistry.acquire(sessionId)
          ├ session 表里有 agent_session_path → SessionManager.open(path)
          └ 否则 SessionManager.create(workspace.rootDir) → 落 path 回 sessions 表
      → session.subscribe(emit)
      → session.prompt(message)
      → emit SSE { type, payload } 实时 write 到 Response stream
ChatView 接收 SSE → 把 message_update / text_delta 追加到当前 assistant 气泡
```

### 3.2 模块边界

```
apps/pi-server/src/
├── agent/
│   ├── agent-client.ts         (薄接口 + 从 pi re-export 类型)
│   ├── pi-coding-agent-client.ts  (默认实现：createAgentSession 包装)
│   ├── agent-session-registry.ts  (按 sessionId 缓存 AgentSession，LRU)
│   └── fake-agent-client.ts    (测试用，发固定 deltas)
├── providers/
│   └── provider-availability.ts  (替换 provider-tester：用 ModelRegistry.getAvailable)
├── db/migrations.ts             (新增 agent_session_path)
└── app.ts                       (改写 runs/messages 路由)

apps/desktop/src/
├── api/
│   ├── client.ts                (RunEvent = pi.AgentSessionEvent；runChat 返回 async iterator)
│   └── sse-stream.ts            (从 client.ts 拆出来，可测)
└── chat/
    ├── ChatView.tsx             (按 sessionId 增量渲染 deltas + provider 选择下拉)
    └── ProviderPicker.tsx       (新增最小组件：列 providers，选中后 PATCH session.providerId)
```

每个单元的职责：
- `agent-client.ts`：仅定义 `AgentClient` 接口（`prompt(input): AsyncIterable<AgentSessionEvent>`）+ 类型 re-export
- `pi-coding-agent-client.ts`：调 `createAgentSession`，吐 pi 的原生事件，关心初始化和 dispose
- `agent-session-registry.ts`：唯一进程级单例，持有 `AuthStorage` / `ModelRegistry` / sessionId→AgentSession 缓存
- `provider-availability.ts`：把 `ModelRegistry.getAvailable()` 的结果映射回 `{ ok, message }`，给路由用
- `app.ts`：路由层，不再关心 streaming 细节

### 3.3 依赖

```diff
# apps/pi-server/package.json
- "@earendil-works/pi-agent-core": "0.75.5",
- "@earendil-works/pi-ai": "0.75.5",
+ "@earendil-works/pi-coding-agent": "0.75.5"
```
`pi-coding-agent` 通过 `npm-shrinkwrap.json` 锁定了 `pi-agent-core` / `pi-ai` / `pi-tui` 的版本，作为间接依赖即可。所有类型 import 走 `@earendil-works/pi-coding-agent` 的顶层导出（含从 pi-agent-core/pi-ai re-export 的部分）。

## 4. 关键决策

### 4.1 AgentSession 注册表

设计为单例：
- 进程启动时构造 `AuthStorage.create(path.join(home, ".marginalia/auth.json"))` + `ModelRegistry.create(authStorage)`
- 启动时 + 任何 provider 增删时，调 `syncProviderKeys(db, authStorage)`：把 DB 里所有 enabled providers 转成 `setRuntimeApiKey(piProviderId(name), apiKey)`
  - `piProviderId("Minimax")` → `"minimax-cn"`（保留 `"minimax"` 与 `"minimax-cn"` 的映射）
  - 名字未识别时直接小写并把空格 → "-"，作为 best effort
- 按 sessionId 缓存（默认 20 条 LRU，超出 dispose）；session 被 UI 删除时同步淘汰

### 4.2 Session 文件位置

- `SessionManager.create(workspace.rootDir)` 默认在 `<cwd>/.pi/sessions/<id>.jsonl`
- pi-server 把返回的 `session.sessionFile` 路径写入 `sessions.agent_session_path`
- "继续"一个 UI session 时：`SessionManager.open(savedPath)`

### 4.3 流式 SSE

`POST /sessions/:id/runs` 必须真流式：
- 用 Web Streams API（`ReadableStream` + `controller.enqueue`）构造响应体
- 每个 pi event 序列化成 `data: { ...event, run_id, session_id }\n\n` 立即 enqueue
- run 结束（`message_end` 或 `error`）后 close stream，并把 status 写回 `runs` 表

### 4.4 消息读取路径

`GET /sessions/:id/messages`：
- 没有 `agent_session_path` → 返回 `[]`
- 有 → 读文件，用 pi 的 `parseSessionEntries(content)` + `buildSessionContext(entries)` 得 `messages`，映射为 UI 的 `Message[]`
- SQLite 的旧 `messages` 表本 spec 保留但停写（migration 不删，给将来的回滚留余地；新代码不写不读）

### 4.5 Provider 测试

- `POST /providers/:id/test`：用 `ModelRegistry.getAvailable()`，看用户的 provider id 是否出现在列表
- 不再发真请求；如果未来需要 ping，pi-ai 也提供了底层 `chat()`，但本 spec 不引入

### 4.6 错误传播

- pi 抛出的所有错误经 `session.prompt` 的 reject / `message_end stopReason="error"` 触发，路由层捕获并 emit `run_failed { error }`
- UI `ChatView` 看到 `run_failed` 时弹一个"重试"按钮（沿用现有 UI）

## 5. 接口契约

### 5.1 `AgentClient`（pi-server 内部）

```ts
import type {
  AgentSessionEvent,
  PromptOptions,
} from "@earendil-works/pi-coding-agent";

export type AgentRunInput = {
  sessionId: string;        // UI session id（pi-server 自身的）
  workspaceRoot: string;    // 用作 pi cwd
  message: string;
  agentSessionPath?: string | null;  // 已有 pi 文件就 open，否则 create
  prompt?: PromptOptions;
};

export type AgentRunResult = {
  sessionFile: string;      // 落库到 sessions.agent_session_path
  events: AsyncIterable<AgentSessionEvent>;
};

export interface AgentClient {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
```

类型 re-export：
```ts
export type { AgentSessionEvent, PromptOptions, AgentSessionConfig } from "@earendil-works/pi-coding-agent";
```

### 5.2 HTTP

不变（保持向后兼容）：
- `POST /sessions/:id/runs`：body `{ providerId, model?, message, contextFiles? }`；响应 `text/event-stream`
- `GET /sessions/:id/messages`：响应 `Message[]`，但内容来源换成 pi session 文件
- `GET /providers`、`POST /providers`、`POST /providers/:id/test`、`PATCH /sessions/:id`：行为不变，实现替换

SSE envelope 设计原则：**内部一律用 pi 的 `AgentSessionEvent`；只在 HTTP 边界做一次映射**。两层并存：

1. 原生层（推荐前端默认消费）：
```
data: { "run_id": "...", "session_id": "...", "kind": "agent_event", "event": <pi 原生 AgentSessionEvent>, "created_at": "..." }
```
2. 兼容层（向后兼容现有 UI，保留到 ChatView 重构完成后可删）：把以下 pi 事件折叠成项目固有 `type`：
   - `message_update` + `assistantMessageEvent.type==="text_delta"` → `assistant_delta { text }`
   - `message_end stopReason==="end"` → `assistant_message { content }` + `run_completed`
   - `message_end stopReason==="error"` → `run_failed { error }`

前端 `RunEvent` 直接用 `import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"`；envelope 外层（`run_id/session_id/kind/event`）类型由 `agent-client.ts` 定义并被前后端共用（通过 `pnpm-workspace.yaml` 已有的 workspace 引用，或暂时在两边各自 import 同一份 .ts 文件，本 spec 选后者以避免新增 package）。

### 5.3 前端

`runChat` 改为：
```ts
async runChat(sessionId, input): Promise<{
  events: AsyncIterable<RunEvent>;
  done: Promise<void>;
}>
```
让 `ChatView` 一边迭代一边渲染，而不是等全部 events 收齐。

## 6. 错误与边界

| 场景 | 行为 |
|---|---|
| MiniMax key 未注入 / 失效 | pi 抛 401 → `run_failed { error: "..."}`，UI 显示 + 重试按钮 |
| workspace.rootDir 不存在 | `SessionManager.create` 失败 → 路由返回 500 + JSON error |
| pi session 文件被外部删除 | `SessionManager.open` 失败 → 自动 fallback 到 `.create`，并刷新 `agent_session_path` |
| 多个客户端同时往同一 session 发消息 | LRU 命中同一 `AgentSession` 实例，pi 内部串行化；本 spec 不额外加锁 |
| pi-server 进程重启 | 缓存丢失但 `agent_session_path` 在 SQLite，重启后再 `.open` 即可 |

## 7. 测试

| 文件 | 验证点 |
|---|---|
| `apps/pi-server/test/agent-session-registry.test.ts` | mock `createAgentSessionFn`，验证按 sessionId 命中、LRU 淘汰、dispose 调用 |
| `apps/pi-server/test/pi-coding-agent-client.test.ts` | fake `createAgentSession` 返回固定 deltas，验证 `AgentClient.run` 正确产生 sessionFile + events |
| `apps/pi-server/test/provider-availability.test.ts` | mock `ModelRegistry`，验证 `MINIMAX_API_KEY` 注入后 `minimax-cn` 出现在 available |
| `apps/pi-server/test/provider-chat.test.ts` | 注入 fake AgentClient，断言 SSE envelope 仍正确（含 `run_started/assistant_delta/run_completed`） |
| `apps/pi-server/test/messages-from-session.test.ts` | 准备一份 JSONL 文件，断言 `GET /sessions/:id/messages` 用 pi `parseSessionEntries` 正确返回 user/assistant |
| `apps/pi-server/test/minimax-smoke.test.ts` | **可跳过**：当 `MINIMAX_CN_API_KEY` 或对应 DB provider 存在时，真打 MiniMax，断言至少 1 个非空 `assistant_delta` + 1 个 `run_completed`；30s timeout |
| `apps/desktop/src/api/sse-stream.test.ts` | 验证流式 reader 在跨 chunk / 大于一个 event 一次性进来时仍正确切分 |
| `apps/desktop/src/chat/ChatView.test.tsx` | mock SSE，按 deltas 验证 user 消息立刻可见 + assistant 气泡逐步累加；切换 provider 后 model 更新 |

整体覆盖矩阵：
- 单元：注册表 / availability / sse parser
- 集成：app.ts 路由 + fake agent
- 端到端（可选 smoke）：真实 MiniMax

## 8. 截图验证

新增 `apps/desktop/electron/screenshot-helper.ts`：
- 监听 IPC `marginalia:capture-screenshot`，调用 `BrowserWindow.webContents.capturePage()`，把 PNG 写到 `output/screenshots/<ts>-<label>.png`

新增 `scripts/verify-minimax.mjs`：
- 启动 pi-server（test 模式，指向 `~/.marginalia/db.sqlite`）
- 启动 electron（生产 build）
- 通过 IPC：
  1. 列 providers，选中 Minimax
  2. 截图 #1：初始空 chat
  3. 输入"用一句话介绍你自己"
  4. 等到 `run_completed`
  5. 截图 #2：完整回复
  6. 再发"那再说一个冷笑话"
  7. 截图 #3：多轮上下文（验证 pi session 持久化生效）
- 生成 `output/verify-minimax/2026-05-26.md`，串联三张截图 + SSE 原始 log

## 9. 落地顺序（plan 会展开）

1. 引入 pi-coding-agent 依赖、删除旧 OpenAI-compat client/tester / pi-agent-core 适配器 / fake-agent-client
2. 写 `agent-client.ts` 接口 + 类型 re-export
3. 写 `agent-session-registry.ts` + 单元测试
4. 写 `pi-coding-agent-client.ts` 默认实现 + 单元测试
5. migration：`sessions.agent_session_path`
6. 改写 `app.ts` 的 `runs` 路由（真 SSE）+ `messages` 路由 + provider availability
7. 前端 `sse-stream` + `runChat` 重构 + `ChatView` 增量渲染 + ProviderPicker
8. 端到端 smoke + 截图脚本
9. README 增补 verify-minimax 章节

## 10. 风险

- **pi-coding-agent 的 system prompt / skills 发现**会扫 cwd 与 `~/.pi/agent`，可能引入用户没料到的 context。Mitigation：cwd 严格用 workspace.rootDir，并在文档里写清
- **默认工具包含 bash/write**，对话里若 agent 主动写文件可能让用户惊讶。Mitigation：在 ChatView 加一行提示"此 agent 可读写当前 workspace 文件"
- **pi session 文件格式版本**：`CURRENT_SESSION_VERSION` 升级时旧文件需要 migrate。Mitigation：先调用 `migrateSessionEntries`
- **AuthStorage 路径冲突**：用户如果同时在终端跑 `pi` CLI，可能用 `~/.pi/agent/auth.json`；我们的 pi-server 默认 `~/.marginalia/auth.json` 隔离，避免覆盖
