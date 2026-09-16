# pi-server HTTP API 参考

pi-server 是 Marginalia 的本机后端，由 Hono 实现，只监听 `127.0.0.1` 上一个系统分配的随机端口。所有路由定义在 `apps/pi-server/src/app.ts`。

桌面端通过 `ApiClient`（`apps/desktop/src/api/client.ts`）调用这些接口。renderer 只看到
`marginalia://pi-server` 逻辑 URL，并经 `window.marginalia.requestPiServer` 的受限 preload capability 发出
请求；该 scheme 不注册为页面可直接 fetch 的协议。Electron main 验证 IPC sender 与请求形状，把请求
代理到实际随机 loopback URL，并注入进程 bearer 与当前 renderer 的 exact Origin。

除 raw 文件和 SSE 外，业务路由主要使用 JSON。多数显式错误返回 `{ "error": "<message>" }`，但当前没有全局 error schema。

除 `GET /health` 外，所有路由统一经过 Loopback Access policy。缺失或错误 bearer 返回稳定 401，缺失或
不可信 Origin 返回稳定 403；renderer 不持有实际 URL 或 bearer。随机 loopback 端口不是授权边界，进程
bearer 才是本机桌面进程与其他调用方之间的凭据边界。

## Route inventory

以下区间是服务端路由的机器可读清单。检查器只读取 Method 和 Path 两列，并与 `createApp()` 中的字符串字面量注册点做集合全等比较。

<!-- route-inventory:start -->

| Method | Path                                         | Description                   |
| ------ | -------------------------------------------- | ----------------------------- |
| GET    | `/health`                                    | 健康检查                      |
| GET    | `/skills`                                    | 刷新并读取 Skill catalog      |
| PATCH  | `/skills/state`                              | 更新 Skill 启停 preference    |
| GET    | `/skills/content`                            | 读取 snapshot member 预览     |
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

## Loopback Access 与 CORS

除 `GET /health` 外，每个请求都必须包含 Electron main 为本次 pi-server 进程生成的 bearer：

```http
Authorization: Bearer <processBearer>
Content-Type: application/json
```

pi-server 在读取 route query/body 或业务数据前验证请求：bearer 缺失、不匹配或 server 没有配置 bearer
时返回 `401 { "error": "unauthorized" }`；`Origin` 缺失或不在本次启动的 exact allowlist 时返回
`403 { "error": "origin_forbidden" }`。packaged renderer 使用 exact `Origin: null`，开发 renderer 使用
main 校验后的 exact loopback Vite origin。`GET /health` 是唯一公开 HTTP route；启动 ready 是 stdout
进程协议，不是额外 HTTP route。

预检不要求 bearer。允许来源的 `OPTIONS` 返回 `204`，并声明
`Access-Control-Allow-Headers: Authorization,Content-Type`；不可信来源不会收到
`Access-Control-Allow-Origin`，同时返回 `403 { "error": "origin_forbidden" }`。允许 Origin 下的 401
响应保留 CORS header，因此 renderer 能读取稳定机器错误，而不是只看到浏览器 CORS failure。

Desktop 的 `ApiClient` 不保存 bearer，只向 preload capability 发送相对 path 与业务 method/header/body。
main transport 验证 sender，丢弃 renderer 提供的 Authorization/Cookie，仅转发 allowlist header，并对
所有 route 注入自己的 bearer 与 Origin；JSON 和 SSE 的 response status/header/body chunk 经 IPC 回传。
原始文件预览通过仅应用主 frame 可访问的 `marginalia-file` 协议流式读取。Skills list/content query 由
`URLSearchParams` 编码，state update 只发送 `{ path, enabled, workspaceId? }`，run 的 `skills`
selection 按调用方顺序序列化。

renderer owner view 的 `useSkillCatalog` 在 Chat/New Thread 挂载、workspace 切换和每次 Composer 新打开
`$` 或 `/` 菜单时调用 `listSkills()`，再把同一个 controller 下传给 Composer；picker 与 blocked repair
不会各建一份可互相覆盖的 cache。Settings -> Skills 在页面挂载/重新进入、workspace 切换和手动刷新时也调用它。Hook 用
request generation 与 requested workspace 拒绝迟到响应；当前请求返回 workspace 不匹配的 snapshot 时
记录为 refresh failure。失败保留最后成功 snapshot，Composer picker 不允许从旧 snapshot 新增 selection，
Settings 则保留旧行并显示重试。Settings 的 toggle 调用 `setSkillEnabled()`，只用响应 snapshot 替换状态，
不做乐观更新；选中行后才调用 `readSkillContent()`。每个新 refresh/toggle 先清旧 error；catalog loading 或
toggle pending 时，错误 Retry 被禁用且 handler 也拒绝发起 GET。内容和 toggle 还以 request ID、workspace
和 exact path 丢弃迟到响应。

ChatView 的 blocked repair 在 catalog controller 之外另有 UI operation generation。每次 Refresh 捕获
owner、workspace 和 blocked object identity；新 submit/pre-start error、Remove、owner/workspace 切换或
unmount 都使旧 UI operation 失效。因此 controller 仍可接受权威 snapshot，但迟到的 A 响应不能过滤或清除
较新的 B blocked state。

`request()`、204 response helper 和 `runChat()` 的非成功 response 共用结构化错误解码。JSON object
响应会完整保存在 `ApiError.details`，同时公开 HTTP `status`、body 的字符串 `error` 作为 `code`，以及
body 的字符串 `message`（缺省为 `code`）。非 JSON 或非 object response 稳定降级为
`code/message: "http_error"` 和空 `details`，不会把 response text 当成新的错误协议。

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

## Skills

Skills API 只使用服务端 Catalog snapshot。可选 `workspaceId` 通过 SQLite workspace 记录解析为
server-owned root；省略时传入 `{ workspaceId: null, workspaceRoot: null }`，只扫描 global roots。
客户端提交的 canonical path 只用于当前 snapshot 的 exact membership lookup，服务端不会把它交给
文件读取 API。因此即使持有 Loopback Access bearer，未知 path、其他 workspace 的 path 和任意宿主 path 都不能
读取或修改。

### `GET /skills?workspaceId=<optional>`

每次请求都强制 `refresh()`，并返回公开 snapshot：

```jsonc
{
  "workspaceId": null,
  "catalogRevision": "<sha256>",
  "effectiveRevision": "<sha256>",
  "refreshedAt": 1784371200000,
  "candidates": [
    {
      "name": "pdf",
      "description": "Read and create PDF files",
      "discoveredPath": "/home/user/.marginalia/skills/pdf/SKILL.md",
      "canonicalPath": "/home/user/.marginalia/skills/pdf/SKILL.md",
      "source": "user_marginalia",
      "scope": "user",
      "status": "effective",
      "enabled": true,
      "effective": true,
      "explicitOnly": false,
      "explicitEligible": true,
      "diagnostics": [],
      "shadowedBy": null,
      "bytesTotal": 8192
    }
  ],
  "diagnostics": []
}
```

Invalid candidate 的 `name` / `description` 为 `null`。Candidate 与 aggregate diagnostic 只包含公开
diagnostic 字段；响应不会返回 `workspaceRoot`、`rawContent`、`previewContent`、`contentHash`、Pi
`Skill` object 或 `effectiveSkills`。Pi 仍可能为带 warning 的 metadata 返回 Skill；若正文含 XML 1.0
不支持的 control character，或 name/canonical path/base directory 含这类字符或 CR/LF，则该 candidate
保留诊断与 preview，但 `explicitEligible` 为 false。

### `GET /skills/content?path=<canonical>&workspaceId=<optional>`

同样先刷新 Catalog，只在该 snapshot 的 `candidates` 中按 `canonicalPath` 精确匹配。响应中的
`path` 和 `content` 都来自匹配 candidate，而不是请求 path 或新的磁盘读取：

```json
{
  "path": "/home/user/.marginalia/skills/pdf/SKILL.md",
  "content": "---\nname: pdf\n---\n...",
  "truncated": false,
  "bytesTotal": 8192
}
```

Invalid candidate 仍可预览；preview 最多 256 KiB，超出时 `truncated: true`。

### `PATCH /skills/state`

请求 Body 为 `{ "path": "<canonical>", "enabled": false, "workspaceId": "<optional>" }`。
Catalog 按 refresh → current membership → preference upsert → refresh 的顺序执行，成功返回与
`GET /skills` 相同的公开 snapshot，因此 revision 是 preference 更新后的 revision。

三个 Skills route 共用错误契约：缺失/错误 bearer 返回 `401`，不可信 Origin 返回 `403`，未知
workspace 返回 `404 { "error": "workspace not found" }`，snapshot 不含该 path 返回
`404 { "error": "skill not found" }`。`PATCH` JSON 或字段类型不符合上述 schema 时返回
`400 { "error": "invalid request" }`。Catalog build 的 service-wide 队列最多 20 项且 slot 等待最多 30 秒；
队列满、等待超时、refresh 或内部错误统一返回
`500 { "error": "skills unavailable" }`，不返回内部 path、bytes 或异常消息。

## Workspaces

| 方法   | 路径                   | 说明                                                                |
| ------ | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/workspaces`          | 列出全部 workspace（按 `created_at` 升序）。                        |
| POST   | `/workspaces`          | 创建。Body `{ name, rootDir }`，返回 `201`。                        |
| PATCH  | `/workspaces/:id/open` | 标记为「最近打开」（更新 `last_opened_at`），用于 Quick chat 归属。 |
| DELETE | `/workspaces/:id`      | 删除 workspace 及其级联的 session/message/run，返回 `204`。         |

`Workspace` 形状（`apps/pi-server/src/db/repositories.ts#Workspace`）：`{ id, name, rootDir, lastOpenedAt, createdAt, updatedAt }`。

## 文件 / 文档

文件接口与生产 pi 文件工具共享 `apps/pi-server/src/files/workspace-files.ts#WorkspaceFiles`。
`path-sandbox.ts` 规范化相对路径；WorkspaceFiles 在操作期间校验 root/目标 identity，打开后使用同一
文件句柄读取，使用原生描述符相对的临时写入及发布。拒绝绝对路径、父路径段、symlink 和外部目标，
接受 Windows 分隔符和文件系统允许的大小写别名。文件树返回 `/` 分隔的路径。

PUT 不带 `overwrite` 使用原子 create-only，目标存在或并发创建返回 409；显式 `overwrite: true`
代表用户确认的替换，服务端固定原文件版本，提交前变化返回 409。策略拒绝返回 403；底层 I/O 失败返回
500。文件发布不是跨进程 expected-inode CAS，平台保证和限制见[系统架构](./architecture.md#workspace-文件操作与审批)。

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

Catalog refresh、Skill preflight、消息附件构建、agent preparation 或 `runs` 记录创建都在 SSE/start
之前完成。其中任一步骤失败都返回 JSON 错误且不保留 `runs` 记录；`start()` 之后的失败则已有一条
run，并以 `failed` 终态完成。完整顺序为：loopback access auth → session/workspace lookup → request
decode/validation（含 provider）→ session lease → Catalog refresh → Skill preflight → message build →
agent preparation → `runs` insert → SSE/start。refresh、preflight、message build、preparation 和 run
insert 都在 lease 内；request abort listener 保持到 execution `settled` 完成后才移除，因此事件已结束
但 execution 仍在收尾时的 disconnect 仍会触发 abort 和审批取消。

Agent preparation 通过 registry 原子取得 pinned reservation；idle LRU 不会 dispose 已 prepared 或 active
handle。`runs` insert、SSE start 或 post-acquire 初始化在 prompt 前失败时幂等 release，正常 start 后则在
execution `settled` 时释放。LRU 的 20 项容量因此是 idle soft cap，而不是 active run hard cap。

请求 Body：

```jsonc
{
  "providerId": "<provider id>",
  "message": "用户输入",
  "model": "可选，缺省用 provider.defaultModel",
  "contextFiles": ["相对路径", "..."],            // @文件 上下文，会内联进消息
  "skills": [{ "name": "pdf", "path": "/canonical/pdf/SKILL.md" }], // 可选
  "permission": "full" | "ask" | "readonly",      // 可选
  "reasoning": "low" | "medium" | "high" | "xhigh" // 可选
}
```

Run body 最多 4 MiB。服务端在 loopback access auth 之后、JSON decode 之前检查 declared Content-Length 和
实际 streamed bytes；二者任一超限都返回 `413 { "error": "skill_payload_too_large" }`。因此无 bearer
的超限请求仍先返回 401，chunked body 也不能绕过限制。

每次 run（包括省略 `skills` 或传空数组）都会在 session lease 内刷新该 workspace 的 Catalog，并把
同一 snapshot 的 `effectiveRevision` 和 effective Skills 固定到 Pi loader。请求最多包含 16 个 raw
selections，每个 `name` / `path` 分别最多 16 KiB UTF-8；这些限制在 path 去重之前检查。之后按 `path`
保留第一次出现的顺序，再以 `{ name, path }` 对当前 snapshot 做 exact membership 与 identity 校验；
不会按 name 查找替代项，也不会把 disabled winner 的旧 path 改绑到同名 successor。Explicit-only
Skill 可以被显式选择，但 Pi 会把它从隐式 system prompt 的可用清单中排除。

任一选择不可用时返回 `409`，且不会调用 agent preparation、创建 run 或打开 SSE：

```jsonc
{
  "error": "skill_precondition_failed",
  "catalogRevision": "<sha256>",
  "invalidSelections": [
    {
      "name": "pdf",
      "path": "/canonical/pdf/SKILL.md",
      "reason": "missing" | "disabled" | "invalid" | "shadowed" | "name_mismatch" | "too_large" | "unsupported_identifier",
      "winnerPath": "/canonical/current-winner/SKILL.md" // 仅 reason="shadowed" 时存在
    }
  ]
}
```

`winnerPath` 是当前 effective winner 的 canonical path，只在 `reason: "shadowed"` 时返回；其他 reason
必须省略该字段，不返回 `null`。

Raw selections 超过 16、selection identity field 超限、候选 `SKILL.md` 原始文件超过 512 KiB，或全部
block 按 `blocks.join("\n\n")` 实际序列化后的 UTF-8 大小（包含 block 间分隔符）超过 2 MiB 时返回
`413 { "error": "skill_payload_too_large" }`，同样发生在 preparation 和 run insert 之前。Block 只由
immutable snapshot 中保存的 `rawContent` 构建，使用 Pi 0.75.5 的 newline/frontmatter body 规则；
name/location 与 References baseDir 会转义，Skill body 与 Pi 原生显式展开一致地保留原文。非法 UTF-8
候选为 `invalid`；正文中的 XML 1.0 非法 control character，以及 wrapper identity 中的非法字符或 CR/LF
会 fail closed。附件 path/mime/error 中的 tab、LF、CR 分别编码为 `&#9;`、`&#10;`、`&#13;`，使实时和重开
展示使用同一严格 grammar。最终用户 prompt 顺序固定为：连续 Skill blocks → 用户 `message` → trailing
`<attached_files>` envelope（如果有附件）。Prompt start 强制关闭 Pi 的原生
Skill/template expansion，因此用户文本 `/skill:name` 不会重新读磁盘或绕过上述 preflight。

Catalog refresh、message build、agent preparation 或 run insert 的非 typed 内部失败统一返回
`500 { "error": "run_preparation_failed" }`，不会回传异常消息、内部 path 或 byte count。上述 typed
409/413 响应保持其精确错误 body。

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
3. `ask` 权限下，审批策略认为需要确认的工具调用会插入 `approval_requested` / `approval_resolved`，并在请求事件处暂停。workspace 读取和新建产物自动允许；每次 bash 和已有文件覆盖均产生审批。
4. 结束：`run_completed`（无 payload）；或 `run_failed` — `payload: { error }`（agent 返回 `message_end` 且 `stopReason === "error"`，或抛异常时）。

> 设计约定：pi-server **不**把 pi 事件重映射成 desktop 专用形状，只加 run 级信封。详见[系统架构 · 单一事实源](./architecture.md#单一事实源single-source-of-truth)。

客户端解析见 `apps/desktop/src/api/sse-stream.ts` 与 `apps/desktop/src/hooks/useStreamingChat.ts`。
Desktop 把首个 `run_started` 作为唯一接受边界：此前不追加 optimistic user entry，也不清 scoped draft 或
记录 retry snapshot；首个事件到达后用完整 `{ text, contextFiles, skills }` snapshot 追加 user entry，后续
`run_failed` 保留该已接受轮并允许 Retry。接受时只在 owner 当前值仍等于 submitted snapshot 时清空；
等待期间的新编辑和 Retry 期间已有的新草稿不受影响。HTTP 失败或 SSE 在 `run_started` 前结束会以
`accepted: false` 报告并保留输入；收到 `run_started` 后流提前结束则以 `accepted: true` 报错。只有显式
`run_completed` 才调用完成回调；重复 `run_started` 不会重复接受。错误 UI 只对本轮已接受且存在对应
retry snapshot 的失败显示 Retry，pre-start 401/409/413/EOF 不会复用更早一轮的 snapshot。客户端收到
`run_failed` 后仍 drain 到 EOF，再用 envelope error 上报并结束 sending；raw pi `message_end(error)` 作为
缺失 envelope 时的 fallback，真实双事件序列优先使用稳定的 `run_failed.payload.error`。drain transport
异常不会覆盖已经收到的 terminal failure。

### 审批（`ask` 档）

`apps/pi-server/src/agent/approval-policy.ts#evaluateEffect` 判定 read/create/overwrite/delete/execute/export/send。
`ask` 自动允许 read/create，其余需要审批；readonly 只允许 read；full 不要求审批但文件边界始终生效。
`apps/pi-server/src/agent/workspace-tools.ts#createWorkspaceTools` 以 pi 原生 customTools 注册现有工具名，
在实际执行前声明 effect 并调用 ApprovalGateway，替代旧 tool_call extension 和 shell-string 推断。

审批 payload 仍为 command/file_edit，新增可选 `effect: { kind, target }`，保留旧历史的可读性。
file_edit 的 path 是实际 canonical 目标，mode 为 write/edit，patch 来自同一拟写入内容，exact 为 true。
新建失败、拒绝、过期提案和无效 edit 不产生已保存结果。审批后版本冲突作为原始 pi tool error 返回。

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

| 方法 | 路径                                         | 说明                                                                                                                                    |
| ---- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/sessions/:sessionId/approvals/:approvalId` | 提交决策。Body `{ approved, reason? }`（旧 `alwaysAllowPrefix` 字段被忽略，不再授予后续权限）；未知或已处理的 `approvalId` 返回 `404`。 |
| GET  | `/sessions/:sessionId/approvals`             | 列出该 session 的全部审批记录（含终态），用于重开会话还原 UI。                                                                          |

Desktop 在第一次提交 Allow 或 Confirm deny 时立即锁定该卡片的全部决策控件，避免同一个 pending
approval 被重复提交；请求失败时恢复控件，成功时等待对应 `approval_resolved` 更新卡片终态。

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
| `skill_preferences` | `skill_path, enabled, updated_at`；`enabled` 只能为 `0` 或 `1`                                           |
| `schema_migrations` | `version, applied_at`                                                                                    |

数据库迁移按版本顺序分别在 `BEGIN IMMEDIATE` transaction 中执行，并在取得写锁后重新检查版本，
因此多个连接并发启动不会重复应用同一版本。全新数据库在 v1 transaction 内完成既有 DDL 和
`sessions.model` / `sessions.agent_session_path` 兼容列后才记录 v1；已有 v1 数据库也先在独立的 v1
transaction 中幂等修复这两列，再尝试 v2。migration SQL、兼容修复和对应版本记录分别保持原子性；
已有 v1 数据库只补 `skill_preferences` 和 v2 记录。

`createSkillPreferenceStore()`（`apps/pi-server/src/db/skill-preferences.ts#createSkillPreferenceStore`）
是 Skill 启停偏好的数据库入口。调用方传入的 canonical path 字符串会原样作为主键；没有记录时视为
启用，写入使用 upsert，`list()` 一次读取全部偏好。路径对应文件消失时记录不会自动删除，因而保留为
tombstone，供之后再次发现同一路径时复用。

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

## Issue #3 的流式预览边界

JSON 和 SSE 复用受限 preload IPC；原始 pi 事件和 ChatEntry 不变。二进制预览使用
`marginalia-file://pi-server`，只代理 GET/HEAD 的 workspace raw-file 路由；Electron webRequest
仅允许应用主 frame 的资源请求，拒绝其他窗口、子 frame 和页面导航。main 注入 bearer/Origin，
Chromium 直接消费响应流，文件切换由原生资源生命周期及 PDF.js destroy 取消请求，不创建整文件 Blob。
浏览器直接打开 Vite 页面没有这些能力；验收必须启动 Electron。

`createApp` 不提供无认证测试旁路。功能测试使用显式测试 bearer；边界测试调用真实 HTTP 路由，
覆盖拒绝、重新认证和 SQLite 重开。进程重启生成新 bearer，旧 bearer 失效；应用数据与文件不受影响。

### 面板布局与文件接口

面板开合、拖宽及应用内全屏不创建 HTTP/SSE 或 IPC 协议；继续使用现有文件列表、正文与 raw URL。当前文件组件在同 workspace 的布局切换中保留，布局偏好使用 renderer 既有本地存储；文件正文不写入该存储。

### Skill 读取与文本审批限制

管理 API 的 preview 仍为冻结内容且最多 256 KiB，显式选择上限仍为 512 KiB；运行时隐式正文
可读取最多 10 MiB，超过时 candidate 为 invalid，诊断为 `read_too_large`。这些限制不新增 HTTP route。
生产 `read_skill` 还可读取本轮准入 Skill 根目录内的引用资源，使用与 workspace 相同的文件边界；
普通 workspace 文件接口不因此开放外部路径。文本 write/edit 对非法 UTF-8 或含 NUL 的现有目标
返回原始 pi tool error，不产生审批记录或文件副作用；有效文本的审批和 toolCallId 合同不变。
