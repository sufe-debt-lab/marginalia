# pi-server HTTP API 参考

pi-server 是 Marginalia 的本机后端，由 Hono 实现，只监听 `127.0.0.1` 上一个**系统分配的随机端口**（不对外开放）。所有路由定义在 `apps/pi-server/src/app.ts`。

桌面端通过 `ApiClient`（`apps/desktop/src/api/client.ts`）调用这些接口，启动时由 main 进程把实际 URL（`http://127.0.0.1:<port>`）传给 renderer。

请求/响应均为 JSON（除文件 raw 流和 SSE 流外）。错误统一返回 `{ "error": "<message>" }` + 对应状态码。

## 健康检查

### `GET /health`

返回服务健康信息（`apps/pi-server/src/health.ts`）。renderer 在 server 就绪后会先打一次确认可用。

```json
{
  "status": "ok",
  "service": "pi-server",
  "version": "0.1.0",
  "startedAt": "2026-06-01T00:00:00.000Z"
}
```

## Workspaces

| 方法   | 路径                   | 说明                                                                |
| ------ | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/workspaces`          | 列出全部 workspace（按 `created_at` 升序）。                        |
| POST   | `/workspaces`          | 创建。Body `{ name, rootDir }`，返回 `201`。                        |
| PATCH  | `/workspaces/:id/open` | 标记为「最近打开」（更新 `last_opened_at`），用于 Quick chat 归属。 |
| DELETE | `/workspaces/:id`      | 删除 workspace 及其级联的 session/message/run，返回 `204`。         |

`Workspace` 形状（`apps/pi-server/src/db/repositories.ts#Workspace`）：`{ id, name, rootDir, lastOpenedAt, createdAt, updatedAt }`。

## 文件 / 文档

所有文件接口都限制在 workspace 的 `rootDir` 内（`files/path-sandbox.ts` 的 `resolveWorkspacePath`，越界返回 `403 Path escapes workspace`）。

| 方法 | 路径                                       | 说明                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET  | `/workspaces/:id/files`                    | 文件树，返回 `{ path, name, kind: "file" }[]`（`files/file-tree.ts`）。   |
| GET  | `/workspaces/:id/files/content?path=<rel>` | 读取文档文本预览，返回 `DocumentContent`。                                |
| GET  | `/workspaces/:id/files/raw?path=<rel>`     | 原始字节流（PDF/图片预览用），带 `content-type` / `content-disposition`。 |
| GET  | `/workspaces/:id/files/search?q=<query>`   | 搜索，返回 `{ path, match: "name" \| "content" }[]`。                     |

`DocumentContent`（`apps/pi-server/src/files/document-reader.ts#DocumentContent`）：`{ path, mime, text, language, lineCount, lineCountExact, truncated, bytesRead, bytesTotal, rawOnly? }`。读取限制（大小、行数 cap、二进制处理）见[配置](../user/configuration.md#文档读取限制)。预览失败按错误码返回对应状态：`not_found`(404)、`file_too_large`、`binary_not_previewable` 等。

## Sessions 与消息

| 方法  | 路径                            | 说明                                                                                                 |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET   | `/workspaces/:id/sessions`      | 列出某 workspace 的 session（按 `updated_at` 降序）。                                                |
| POST  | `/sessions`                     | 创建。Body `{ workspaceId, title, origin? }`，返回 `201`。                                           |
| PATCH | `/sessions/:sessionId`          | 更新模型。Body `{ model?: string \| null }`。                                                        |
| GET   | `/sessions/:sessionId/messages` | 历史消息，返回 `ChatEntry[]`。                                                                       |
| POST  | `/sessions/:sessionId/messages` | 追加一条消息。Body `{ role, content }`，返回 `201`。                                                 |
| POST  | `/quick-chat`                   | 在「最近打开」的 workspace 下建临时 session（`origin: "quick_chat"`）；无可用 workspace 返回 `409`。 |

`Session` 形状：`{ id, workspaceId, title, origin, model?, agentSessionPath?, createdAt, updatedAt }`。

历史消息有两个来源（`apps/pi-server/src/app.ts#readMessagesFromSessionFile`）：若 session 已绑定 `agentSessionPath`（pi 落盘的 session 文件），从该文件读；否则从 SQLite `messages` 表读并转成 `ChatEntry`。`ChatEntry = { id, message }`，`message` 为 pi 原生形状（见 `@marginalia/chat-core`）。

## Providers

| 方法 | 路径                  | 说明                                                                                                                                              |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/providers`          | 列出已配置的 provider。                                                                                                                           |
| POST | `/providers`          | 创建。Body `{ name, apiKey, baseUrl?, defaultModel }`，返回 `201`。API key 存入 `env_vars` 并注册到 pi 运行时（`authStorage.setRuntimeApiKey`）。 |
| POST | `/providers/:id/test` | 测试可用性，返回可用性检查结果。                                                                                                                  |

`Provider`（对客户端）：`{ id, name, baseUrl?, defaultModel }`。`name` 会经 `piProviderId()`（`agent/provider-id.ts`）映射到 pi 运行时的 provider id，例如 `"MiniMax"` → `"minimax-cn"`、`"OpenAI"` → `"openai"`。预设列表见[配置](../user/configuration.md#provider-预设)。

## 运行对话（SSE 流式）

### `POST /sessions/:sessionId/runs`

发起一次 agent run，以 **Server-Sent Events** 流式返回（`apps/pi-server/src/app.ts#/sessions/:sessionId/runs`）。

请求 Body：

```jsonc
{
  "providerId": "<provider id>",
  "message": "用户输入",
  "model": "可选，缺省用 provider.defaultModel",
  "contextFiles": ["相对路径", "..."],            // @文件 上下文，会内联进消息
  "permission": "full" | "ask" | "readonly",      // 可选
  "reasoning": "low" | "medium" | "high" | "xhigh" // 可选
}
```

每个 SSE `data` 是一个 JSON 信封：

```jsonc
{
  "run_id": "<run id>",
  "session_id": "<session id>",
  "type": "run_started" | "agent_event" | "run_completed" | "run_failed",
  "payload": { /* 随 type 不同 */ },
  "created_at": "ISO 时间"
}
```

事件序列：

1. `run_started` — `payload: { model }`。
2. 若干 `agent_event` — `payload: { event }`，其中 `event` 是 **原样转发的原始 pi 事件**（message_start、文本/思考增量、工具调用、message_end 等）。客户端从这些原始事件派生所有 UI。
3. 结束：`run_completed`（无 payload）；或 `run_failed` — `payload: { error }`（agent 返回 `message_end` 且 `stopReason === "error"`，或抛异常时）。

> 设计约定：pi-server **不**把 pi 事件重映射成 desktop 专用形状，只加 run 级信封。详见[系统架构 · 单一事实源](./architecture.md#单一事实源single-source-of-truth)。

客户端解析见 `apps/desktop/src/api/sse-stream.ts` 与 `apps/desktop/src/hooks/useStreamingChat.ts`。

## 数据模型（SQLite）

schema 见 `apps/pi-server/src/db/migrations.ts`。存储位置见[配置 · 存储位置](../user/configuration.md#存储位置)。

| 表                  | 关键列                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| `workspaces`        | `id, name, root_dir, last_opened_at, created_at, updated_at`                         |
| `sessions`          | `id, workspace_id, title, origin, model, agent_session_path, created_at, updated_at` |
| `messages`          | `id, session_id, role, content, created_at`                                          |
| `providers`         | `id, name, api_key_ref→env_vars, base_url, default_model, enabled, config, …`        |
| `runs`              | `id, session_id, provider_id, model, status, error, created_at, completed_at`        |
| `env_vars`          | `id, key, value, scope, workspace_id, created_at`（存 provider API key 等）          |
| `schema_migrations` | `version, applied_at`                                                                |

外键启用 `ON DELETE CASCADE`：删除 workspace 会级联清理其 session/message/run。

> 说明：`ApiClient` 中存在 `getBranch()` / `GET /workspaces/:id/branch`，但该路由在当前 pi-server 中**尚未实现**；客户端在请求失败时静默返回 `null`，对应版本快照功能仍属路线图（见[术语](../user/concepts.md)）。

## 相关文档

- 数据流与事件转发设计：[系统架构](./architecture.md)
- provider 预设、存储位置、读取限制：[配置](../user/configuration.md)
