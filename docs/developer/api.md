# pi-server HTTP API 参考

pi-server 是 Marginalia 的本机后端，由 Hono 实现，只监听 `127.0.0.1` 上一个系统分配的随机端口。所有路由定义在 `apps/pi-server/src/app.ts`。

桌面端通过 `ApiClient`（`apps/desktop/src/api/client.ts`）调用这些接口，启动时由 main 进程把实际 URL（`http://127.0.0.1:<port>`）传给 renderer。

除 raw 文件和 SSE 外，业务路由主要使用 JSON。多数显式错误返回 `{ "error": "<message>" }`，但当前没有全局 error schema。

当前仅 run 与后续 Skills API 使用 Electron 每次启动生成的进程 capability；其他既有 loopback
路由仍未认证。CORS 不再反射任意 Origin，但随机 loopback 端口和局部 capability 都不是整套 API
的授权边界；`P0-SEC-001` 仍未关闭，这套 API 仍只适合 Alpha 开发和评估。

## Route inventory

以下区间是服务端路由的机器可读清单。检查器只读取 Method 和 Path 两列，并与 `createApp()` 中的字符串字面量注册点做集合全等比较。

<!-- route-inventory:start -->

| Method | Path                                         | Description                   |
| ------ | -------------------------------------------- | ----------------------------- |
| GET    | `/health`                                    | 健康检查                      |
| GET    | `/workspaces`                                | 列出 workspace                |
| POST   | `/workspaces`                                | 创建 workspace                |
| PATCH  | `/workspaces/:id/open`                       | 标记最近打开                  |
| DELETE | `/workspaces/:id`                            | 删除 workspace 及关联记录     |
| GET    | `/workspaces/:id/sessions`                   | 列出 workspace session        |
| GET    | `/workspaces/:id/files`                      | 列出文件                      |
| GET    | `/workspaces/:id/files/content`              | 读取文本预览                  |
| GET    | `/workspaces/:id/files/raw`                  | 读取原始字节                  |
| GET    | `/workspaces/:id/files/search`               | 搜索文件名和文本              |
| PUT    | `/workspaces/:id/files/content`              | 创建或覆盖文本文件            |
| POST   | `/sessions`                                  | 创建 session                  |
| PATCH  | `/sessions/:sessionId`                       | 更新 session model            |
| GET    | `/sessions/:sessionId/messages`              | 读取消息                      |
| POST   | `/sessions/:sessionId/messages`              | 追加消息                      |
| POST   | `/sessions/:sessionId/approvals/:approvalId` | 提交审批决定                  |
| GET    | `/sessions/:sessionId/approvals`             | 列出审批记录                  |
| POST   | `/quick-chat`                                | 创建 quick chat session       |
| GET    | `/providers`                                 | 列出 provider                 |
| POST   | `/providers`                                 | 创建 provider                 |
| POST   | `/providers/:id/test`                        | 检查本地模型可用状态          |
| PATCH  | `/providers/:id`                             | 更新 provider                 |
| DELETE | `/providers/:id`                             | 删除 provider、key 和关联 run |
| POST   | `/sessions/:sessionId/runs`                  | 启动 SSE agent run            |

<!-- route-inventory:end -->

## Run capability 与 CORS

每个 `POST /sessions/:sessionId/runs` 请求必须包含 Electron main 进程提供给 renderer 的 bearer：

```http
Authorization: Bearer <capabilityToken>
Content-Type: application/json
```

pi-server 在读取 session 或 body 前验证请求：token 缺失、不匹配或 server 没有配置 token 时返回
`401 { "error": "unauthorized" }`；`Origin` 既不是缺省/`null`，也不在本次启动的 exact allowlist
时返回 `403 { "error": "origin_forbidden" }`。`GET /health`、workspace、provider、document 和
approval 等既有 API 不带 bearer，保持原有认证边界。

浏览器预检不要求 bearer。允许来源的 `OPTIONS` 返回 `204`，并声明
`Access-Control-Allow-Headers: Authorization,Content-Type`；不可信来源不会收到
`Access-Control-Allow-Origin`。Electron 开发模式只允许经过 loopback URL 校验的 Vite origin；
打包后的 `file:` renderer 使用 `Origin: null`。

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

文件接口通过 `files/path-sandbox.ts` 做 lexical path 和已存在目标 realpath 检查。当前新文件写入没有校验最近存在父目录的 realpath，可通过 workspace 内的 symlink parent 写到目录外，见[产品就绪审计](./issues/2026-07-11-product-readiness-audit.md)。Agent 默认 coding tools 不复用这层检查。

| 方法 | 路径                                       | 说明                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET  | `/workspaces/:id/files`                    | 文件树，返回 `{ path, name, kind: "file" }[]`（`files/file-tree.ts`）。   |
| GET  | `/workspaces/:id/files/content?path=<rel>` | 读取文档文本预览，返回 `DocumentContent`。                                |
| GET  | `/workspaces/:id/files/raw?path=<rel>`     | 原始字节流（PDF/图片预览用），带 `content-type` / `content-disposition`。 |
| GET  | `/workspaces/:id/files/search?q=<query>`   | 搜索，返回 `{ path, match: "name" \| "content" }[]`。                     |
| PUT  | `/workspaces/:id/files/content`            | 创建或覆盖 UTF-8 文本文件。                                               |

`DocumentContent`（`apps/pi-server/src/files/document-reader.ts#DocumentContent`）：`{ path, mime, text, language, lineCount, lineCountExact, truncated, bytesRead, bytesTotal, rawOnly? }`。读取限制（大小、行数 cap、二进制处理）见[配置](../user/configuration.md#文档读取限制)。预览失败按错误码返回对应状态：`not_found`(404)、`file_too_large`、`binary_not_previewable` 等。

文件写入 Body：

```jsonc
{
  "path": "notes/summary.md",
  "content": "# Summary\n",
  "overwrite": false
}
```

新文件返回 `201`，覆盖返回 `200`；目标存在但 `overwrite` 不是 `true` 时返回 `409 { "error": "file exists" }`。它只写 UTF-8 文本，不是通用二进制上传接口。

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

| 方法   | 路径                  | 说明                                                                                                                                                                                                                                                              |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/providers`          | 列出已配置的 provider（不含 API key）。                                                                                                                                                                                                                           |
| POST   | `/providers`          | 创建。Body `{ name, apiKey, baseUrl?, defaultModel }`，返回 `201`。API key 存入 `env_vars` 并注册到 pi 运行时（`authStorage.setRuntimeApiKey`）。                                                                                                                 |
| PATCH  | `/providers/:id`      | 更新。Body 任意子集 `{ name?, apiKey?, baseUrl?, defaultModel?, enabled? }`，返回更新后的 provider（不含 API key）。省略 `apiKey` 则保留原 key；改名会同步重命名 `env_vars` 键并把 pi 运行时 key 从旧 `piProviderId` 迁到新的；`enabled:false` 会移除运行时 key。 |
| DELETE | `/providers/:id`      | 删除 provider 及其 `env_vars` 记录，并清除 pi 运行时 key，返回 `204`。                                                                                                                                                                                            |
| POST   | `/providers/:id/test` | 检查 provider/model 是否存在于本地可用模型列表，不发真实网络请求。                                                                                                                                                                                                |

`Provider`（对客户端）：`{ id, name, baseUrl?, defaultModel, enabled? }`。`name` 会经 `piProviderId()`（`agent/provider-id.ts`）映射到 pi 运行时的 provider id，例如 `"MiniMax"` → `"minimax-cn"`、`"OpenAI"` → `"openai"`。当前 GLM 和 Xiaomi MiMo 预设会分别映射到 registry 中不存在的 `glm`、`xiaomi-mimo`。Run 只把 provider/model ID 交给 `getModel()`，数据库中的 `baseUrl` 没有进入模型请求；Test 只检查本地 registry 和是否配置凭据，不验证 key 或网络。

删除 provider 时，repository 会先删除关联 runs，随后删除 provider 和 `env_vars` key。它不是保留历史记录的 soft delete。

## 运行对话（SSE 流式）

### `POST /sessions/:sessionId/runs`

发起一次 agent run，以 **Server-Sent Events** 流式返回（`apps/pi-server/src/app.ts#/sessions/:sessionId/runs`）。

同一 session 同时只允许一个 active run。若前一个 execution 尚未完成清理，返回
`409 { "error": "session_busy" }`，不会调用 agent、创建 `runs` 记录或打开 SSE；不同 session
可以并发执行。服务端收到 SSE disconnect 时会请求中止 execution、立即拒绝挂起审批，但直到其
`settled` Promise 完成后才释放 session lease，因此紧随断连到达的重试仍可能收到
`session_busy`。

消息附件构建、agent preparation 或 `runs` 记录创建在 SSE/start 之前完成。其中任一步骤失败都
返回 JSON 错误且不保留 `runs` 记录；`start()` 之后的失败则已有一条 run，并以 `failed` 终态完成。
完整顺序为：capability auth → session/workspace lookup → request decode/validation（含 provider）→
session lease → message build → agent preparation → `runs` insert → SSE/start。message build、
preparation 和 run insert 都在 lease 内；request abort listener 保持到 execution `settled` 完成后
才移除，因此事件已结束但 execution 仍在收尾时的 disconnect 仍会触发 abort 和审批取消。

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
  "type": "run_started" | "agent_event" | "approval_requested" | "approval_resolved" | "run_completed" | "run_failed",
  "payload": { /* 随 type 不同 */ },
  "created_at": "ISO 时间"
}
```

事件序列：

1. `run_started` — `payload: { model }`。
2. 若干 `agent_event` — `payload: { event }`，其中 `event` 是 **原样转发的原始 pi 事件**（message_start、文本/思考增量、工具调用、message_end 等）。客户端从这些原始事件派生所有 UI。
3. `ask` 权限下，审批策略认为需要确认的工具调用会插入 `approval_requested` / `approval_resolved`，并在请求事件处暂停。当前部分 shell 前缀和新文件 write 自动放行，不会产生审批事件。
4. 结束：`run_completed`（无 payload）；或 `run_failed` — `payload: { error }`（agent 返回 `message_end` 且 `stopReason === "error"`，或抛异常时）。

> 设计约定：pi-server **不**把 pi 事件重映射成 desktop 专用形状，只加 run 级信封。详见[系统架构 · 单一事实源](./architecture.md#单一事实源single-source-of-truth)。

客户端解析见 `apps/desktop/src/api/sse-stream.ts` 与 `apps/desktop/src/hooks/useStreamingChat.ts`。

### 审批（`ask` 档）

判定某次工具调用是否需要审批的纯函数见 `apps/pi-server/src/agent/approval-policy.ts`；暂停/恢复流程（含挂起态管理、断连时的自动拒绝）见 `apps/pi-server/src/agent/approval-gateway.ts`；把两者接到 pi 工具调用钩子上的 extension 见 `apps/pi-server/src/agent/approval-extension.ts`。

当前策略：read/grep/find/ls 直接放行；bash 按命令分段和首 token allowlist 判断；edit 必审；write 只在目标已存在时审批；未知工具使用命令卡审批。这个字符串判断不解析完整 shell 语义，审批不是安全沙箱。

两类 SSE 信封（`payload.approval` 形状见 `apps/pi-server/src/agent/agent-client.ts#ApprovalRequestedEvent`/`ApprovalResolvedEvent`）：

```jsonc
// approval_requested — 流在此暂停
{
  "type": "approval_requested",
  "payload": {
    "approval": {
      "approvalId": "<id>",
      "sessionId": "<session id>",
      "toolCallId": "<对应 toolCall 的 id>",
      "toolName": "bash" | "edit" | "write",
      "payload": {
        // kind: "command" —— bash 工具
        "kind": "command",
        "command": "<shell 命令>",
        "cwd": "<workspace 内绝对路径>"

        // 或 kind: "file_edit" —— edit/write 工具
        // "kind": "file_edit",
        // "path": "<workspace 相对路径>",
        // "mode": "edit" | "write",
        // "patch": "<unified diff 文本>",
        // "additions": 0,
        // "deletions": 0,
        // "exact": true,          // false 时是近似 diff（预览失败的降级）
        // "error": "<可选，预览失败时的说明>"
      }
    }
  }
}
// approval_resolved —— 决策到达（用户批准/拒绝，或断连/run 结束时自动过期拒绝）后恢复流
{
  "type": "approval_resolved",
  "payload": {
    "approval": {
      "approvalId": "<id>",
      "sessionId": "<session id>",
      "toolCallId": "<对应 toolCall 的 id>",
      "approved": true,
      "reason": "可选，拒绝理由",
      "expired": false
    }
  }
}
```

对应的 REST 接口：

| 方法 | 路径                                         | 说明                                                                                                 |
| ---- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST | `/sessions/:sessionId/approvals/:approvalId` | 提交决策。Body `{ approved, reason?, alwaysAllowPrefix? }`；未知或已处理的 `approvalId` 返回 `404`。 |
| GET  | `/sessions/:sessionId/approvals`             | 列出该 session 的全部审批记录（含终态），用于重开会话还原 UI。                                       |

`Approval` 形状（`apps/pi-server/src/db/repositories.ts#ApprovalRow`）：`{ id, sessionId, runId, toolCallId, toolName, kind, payload, status, reason, createdAt, decidedAt }`；`status` 为 `"pending" | "approved" | "denied" | "expired"`。客户端断连或 run 结束时仍处于 `pending` 的审批会被标记为 `expired`（`apps/pi-server/src/app.ts#expirePendingApprovals`）。

## 数据模型（SQLite）

schema 见 `apps/pi-server/src/db/migrations.ts`。存储位置和 secret 边界见[配置](../user/configuration.md)。

| 表                  | 关键列                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `workspaces`        | `id, name, root_dir, last_opened_at, created_at, updated_at`                                             |
| `sessions`          | `id, workspace_id, title, origin, model, agent_session_path, created_at, updated_at`                     |
| `messages`          | `id, session_id, role, content, created_at`                                                              |
| `providers`         | `id, name, api_key_ref→env_vars, base_url, default_model, enabled, config, …`                            |
| `runs`              | `id, session_id, provider_id, model, status, error, created_at, completed_at`                            |
| `approvals`         | `id, session_id, run_id, tool_call_id, tool_name, kind, payload, status, reason, created_at, decided_at` |
| `env_vars`          | `id, key, value, scope, workspace_id, created_at`（存 provider API key 等）                              |
| `schema_migrations` | `version, applied_at`                                                                                    |

删除 workspace 时 repository 在 transaction 中显式清理 message/run/session，再删除 workspace。数据库外键也对 session/message 的部分关系启用 cascade。删除 provider 会清理关联 runs。

> 说明：`ApiClient` 中存在 `getBranch()` / `GET /workspaces/:id/branch`，但该路由在当前 pi-server 中**尚未实现**；客户端在请求失败时静默返回 `null`，对应版本快照功能仍属路线图（见[术语](../user/concepts.md)）。

## 桌面 IPC 桥（renderer ↔ Electron main）

HTTP API 之外，renderer 通过 `window.marginalia`（`apps/desktop/electron/preload.cts`）调用少量 Electron main 能力。通道清单见[系统架构](./architecture.md)；对 renderer 有契约意义的返回形状：

| 通道                        | 结果契约                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `marginalia:save-text-file` | 成功 `{ saved: true, path }`；用户取消 `{ saved: false }`；写盘失败 `{ saved: false, error }`，不 reject |

调用方按结果对象渲染反馈（见 `apps/desktop/src/lib/save-file.ts`）；IPC promise 拒绝不属于该契约。

## 相关文档

- 数据流与事件转发设计：[系统架构](./architecture.md)
- provider 预设、存储位置、读取限制：[配置](../user/configuration.md)
