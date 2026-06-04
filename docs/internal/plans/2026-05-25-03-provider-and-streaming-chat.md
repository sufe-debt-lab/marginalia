# Provider 与流式 Chat 实现计划

> **给 agentic worker：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 加入 provider 配置、模型选择、SSE chat run，以及 assistant 回复持久化。

**架构：** pi-server 保存 provider 配置并暴露 chat run API。Chat run 通过 `AgentClient` 接口隔离，先用 fake streaming agent 测 REST/SSE/UI，再接入 pi SDK。Renderer 通过 REST 读取消息，通过 SSE 接收 run 事件。

**技术栈：** TypeScript、Hono、better-sqlite3、Server-Sent Events、React、Vitest、`@mariozechner/pi-coding-agent@0.73.1`。

---

## 文件结构

- 修改：`apps/pi-server/src/db/migrations.ts` — 添加 `providers`、`env_vars` 和 `runs` 表。
- 修改：`apps/pi-server/src/db/repositories.ts` — provider 和 run repository 函数。
- 新建：`apps/pi-server/src/agent/agent-client.ts` — streaming agent interface。
- 新建：`apps/pi-server/src/agent/fake-agent-client.ts` — 确定性的测试 client。
- 新建：`apps/pi-server/src/agent/pi-agent-client.ts` — pi SDK adapter。
- 新建：`apps/pi-server/src/providers/provider-tester.ts` — provider test connection interface。
- 新建：`apps/pi-server/src/routes/providers.ts` — provider 配置和 test connection。
- 新建：`apps/pi-server/src/routes/runs.ts` — `POST /sessions/:id/runs` SSE endpoint。
- 修改：`apps/pi-server/src/app.ts` — 注册 provider/run routes。
- 新建：`apps/pi-server/test/provider-chat.test.ts` — provider 和 run 测试。
- 修改：`apps/desktop/src/api/client.ts` — provider 和 run APIs。
- 新建：`apps/desktop/src/api/client.test.ts` — SSE parser 测试。
- 新建：`apps/desktop/src/chat/ChatView.tsx` — messages、composer、model selector。
- 新建：`apps/desktop/src/chat/ChatView.test.tsx` — chat UI 测试。
- 修改：`apps/desktop/src/workspaces/WorkspaceShell.tsx` — 在 chat 中打开 active session。

## 前置 Gate

执行本计划前必须确认第 01、02 份 spec/plan 的闭环已经落地，否则 provider/run API 没有可用 session 和 message 基线。

```bash
test -f pnpm-workspace.yaml
test -f apps/pi-server/src/db/repositories.ts
test -f apps/desktop/src/workspaces/WorkspaceShell.tsx
pnpm --filter @marginalia/pi-server test -- health.test.ts workspace-session.test.ts
pnpm --filter @marginalia/desktop test -- App.test.tsx WorkspaceShell.test.tsx
```

预期：全部以 0 退出。失败时先回到 `2026-05-25-01-local-shell-and-server.md` 或 `2026-05-25-02-workspace-session-quick-chat.md`。

## TDD 覆盖矩阵

| 功能点 | 先写的失败测试 | 通过标准 |
| --- | --- | --- |
| provider schema + session model | `provider-chat.test.ts` | `providers`、`env_vars`、`runs` 存在，`sessions.model` 存在。 |
| provider test connection | `provider-chat.test.ts` | fake tester 校验 OpenAI/Anthropic 成功和 invalid key 失败，不用真实网络。 |
| run/SSE envelope | `provider-chat.test.ts` | 每个事件都包含 `run_id`、`session_id`、`type`、`payload`、`created_at`。 |
| run 持久化 | `provider-chat.test.ts` | 创建 `runs` 记录，完成时 `status=completed`，失败时 `status=failed`。 |
| assistant 持久化 | `provider-chat.test.ts` | run 完成后 messages 中有 user 和 assistant。 |
| SSE parser | `apps/desktop/src/api/client.test.ts` | `readSse()` 能解析 envelope 和跨 chunk 数据。 |
| Chat UI 状态 | `ChatView.test.tsx` | 覆盖 sending、error、retry、model selector。 |
| pi SDK adapter | `pi-agent-client.test.ts` + 手动验证 | 先用 SDK 类型/示例验证真实事件 API，再接入 adapter；不使用未经验证的 `session.prompt()` 返回值假设。 |

## 任务 1：Provider 和 Run schema

**文件：**
- 修改：`apps/pi-server/src/db/migrations.ts`
- 修改：`apps/pi-server/test/provider-chat.test.ts`

- [ ] **步骤 1：编写预期失败的 migration 测试**

```ts
// apps/pi-server/test/provider-chat.test.ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";

const dbs: Database.Database[] = [];
const memoryDb = () => {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("provider chat migrations", () => {
  it("creates provider env var and run tables", () => {
    const db = memoryDb();
    migrate(db);

    const names = db.prepare("select name from sqlite_master where type = 'table' order by name").all().map((row: any) => row.name);

    expect(names).toContain("providers");
    expect(names).toContain("env_vars");
    expect(names).toContain("runs");

    const sessionColumns = db.prepare("pragma table_info(sessions)").all().map((row: any) => row.name);
    expect(sessionColumns).toContain("model");
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：FAIL，因为 provider tables 还不存在。

- [ ] **步骤 3：扩展 migrations**

在 `migrate(db)` 里现有建表语句之后追加：

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      workspace_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key_ref TEXT NOT NULL,
      base_url TEXT,
      default_model TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (api_key_ref) REFERENCES env_vars(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );
  `);
  const sessionColumns = db.prepare("pragma table_info(sessions)").all().map((row: any) => row.name);
  if (!sessionColumns.includes("model")) {
    db.exec("ALTER TABLE sessions ADD COLUMN model TEXT");
  }
```

- [ ] **步骤 4：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：PASS。

- [ ] **步骤 5：扩展 session repository 和 route 以持久化 model**

会话级模型选择必须能跨重启恢复，所以需要补 `updateSession` 和对应的 PATCH endpoint。

测试（追加到 `workspace-session.test.ts` 或 `provider-chat.test.ts`）：

```ts
import { updateSession } from "../src/db/repositories.js";

it("persists session model selection", () => {
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
  const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });

  updateSession(db, session.id, { model: "gpt-4.1" });

  const reloaded = listSessions(db, workspace.id).find((item) => item.id === session.id);
  expect(reloaded?.model).toBe("gpt-4.1");
});

it("PATCH /sessions/:id updates the session model", async () => {
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
  const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });
  const app = createApp({ db });

  const response = await app.request(`/sessions/${session.id}`, {
    method: "PATCH",
    body: JSON.stringify({ model: "gpt-4.1" }),
    headers: { "content-type": "application/json" }
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: session.id, model: "gpt-4.1" });
});
```

修改 `mapSession` 让它返回 `model`，并新增 `updateSession`：

```ts
const mapSession = (row: any): Session => ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  origin: row.origin,
  model: row.model ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export function updateSession(db: Database.Database, id: string, patch: { model?: string | null }): Session | null {
  if (patch.model !== undefined) {
    db.prepare("update sessions set model = ?, updated_at = ? where id = ?").run(patch.model, now(), id);
  }
  const row = db.prepare("select * from sessions where id = ?").get(id);
  return row ? mapSession(row) : null;
}
```

同时把 `Session` type 加上 `model: string | null`。

在 `apps/pi-server/src/routes/sessions.ts` 新增：

```ts
app.patch("/sessions/:sessionId", async (c) => {
  const body = await c.req.json<{ model?: string | null }>();
  const session = updateSession(db, c.req.param("sessionId"), { model: body.model });
  if (!session) return c.json({ error: "session not found" }, 404);
  return c.json(session);
});
```

记得在 import 中加入 `updateSession`。

- [ ] **步骤 6：提交**

```bash
git add apps/pi-server/src apps/pi-server/test/provider-chat.test.ts
git commit -m "feat: add provider chat schema"
```

## 任务 2：Provider repository 和 API

**文件：**
- 修改：`apps/pi-server/src/db/repositories.ts`
- 新建：`apps/pi-server/src/routes/providers.ts`
- 修改：`apps/pi-server/src/app.ts`
- 修改：`apps/pi-server/test/provider-chat.test.ts`

- [ ] **步骤 1：添加 provider API 测试**

追加：

```ts
import { createApp } from "../src/app.js";
import type { ProviderConnectionTester } from "../src/providers/provider-tester.js";

describe("provider API", () => {
  it("creates OpenAI and Anthropic providers and delegates test connection to a provider tester", async () => {
    const db = memoryDb();
    migrate(db);
    const providerTester: ProviderConnectionTester = {
      test: vi.fn(async ({ apiKey }) => apiKey === "invalid" ? { ok: false, error: "invalid key" } : { ok: true })
    };
    const app = createApp({ db, providerTester });

    const openAiResponse = await app.request("/providers", {
      method: "POST",
      body: JSON.stringify({
        name: "openai",
        apiKey: "sk-test",
        defaultModel: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1"
      }),
      headers: { "content-type": "application/json" }
    });
    const anthropicResponse = await app.request("/providers", {
      method: "POST",
      body: JSON.stringify({
        name: "anthropic",
        apiKey: "sk-ant-test",
        defaultModel: "claude-3-5-sonnet-latest",
        baseUrl: "https://api.anthropic.com"
      }),
      headers: { "content-type": "application/json" }
    });

    expect(openAiResponse.status).toBe(201);
    expect(anthropicResponse.status).toBe(201);
    const provider = await openAiResponse.json();
    expect(provider.name).toBe("openai");
    expect(provider.defaultModel).toBe("gpt-4o-mini");

    const testResponse = await app.request(`/providers/${provider.id}/test`, { method: "POST" });
    expect(testResponse.status).toBe(200);
    expect(await testResponse.json()).toEqual({ ok: true });
    expect(providerTester.test).toHaveBeenCalledWith({
      providerName: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    });
  });

  it("returns a failed provider test result for invalid keys", async () => {
    const db = memoryDb();
    migrate(db);
    const providerTester: ProviderConnectionTester = {
      test: vi.fn(async () => ({ ok: false, error: "invalid key" }))
    };
    const app = createApp({ db, providerTester });

    const createResponse = await app.request("/providers", {
      method: "POST",
      body: JSON.stringify({ name: "openai", apiKey: "invalid", defaultModel: "gpt-4o-mini" }),
      headers: { "content-type": "application/json" }
    });
    const provider = await createResponse.json();

    const testResponse = await app.request(`/providers/${provider.id}/test`, { method: "POST" });

    expect(testResponse.status).toBe(200);
    expect(await testResponse.json()).toEqual({ ok: false, error: "invalid key" });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：FAIL，`/providers` 返回 404。

- [ ] **步骤 3：添加 repository 函数**

追加到 `repositories.ts`：

```ts
export type Provider = {
  id: string;
  name: string;
  apiKeyRef: string;
  baseUrl: string | null;
  defaultModel: string;
  enabled: boolean;
  config: string;
  createdAt: number;
  updatedAt: number;
};

const mapProvider = (row: any): Provider => ({
  id: row.id,
  name: row.name,
  apiKeyRef: row.api_key_ref,
  baseUrl: row.base_url,
  defaultModel: row.default_model,
  enabled: row.enabled === 1,
  config: row.config,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export function createProvider(db: Database.Database, input: { name: string; apiKey: string; defaultModel: string; baseUrl?: string }): Provider {
  const timestamp = now();
  const envId = randomUUID();
  const providerId = randomUUID();
  db.prepare("insert into env_vars (id, key, value, scope, created_at) values (?, ?, ?, 'global', ?)")
    .run(envId, `${input.name.toUpperCase()}_API_KEY`, input.apiKey, timestamp);
  db.prepare("insert into providers (id, name, api_key_ref, base_url, default_model, enabled, config, created_at, updated_at) values (?, ?, ?, ?, ?, 1, '{}', ?, ?)")
    .run(providerId, input.name, envId, input.baseUrl ?? null, input.defaultModel, timestamp, timestamp);
  return getProvider(db, providerId)!;
}

export function getProvider(db: Database.Database, id: string): Provider | null {
  const row = db.prepare("select * from providers where id = ?").get(id);
  return row ? mapProvider(row) : null;
}

export function listProviders(db: Database.Database): Provider[] {
  return db.prepare("select * from providers order by created_at asc").all().map(mapProvider);
}

export function getProviderApiKey(db: Database.Database, providerId: string): string | null {
  const row = db.prepare(`
    select env_vars.value as value
    from providers
    join env_vars on env_vars.id = providers.api_key_ref
    where providers.id = ?
  `).get(providerId) as { value: string } | undefined;
  return row?.value ?? null;
}
```

- [ ] **步骤 4：实现 provider tester 和 route**

```ts
// apps/pi-server/src/providers/provider-tester.ts
export type ProviderTestInput = {
  providerName: string;
  apiKey: string;
  baseUrl: string | null;
  model: string;
};

export type ProviderTestResult = { ok: true } | { ok: false; error: string };

export interface ProviderConnectionTester {
  test(input: ProviderTestInput): Promise<ProviderTestResult>;
}

export class LocalProviderConnectionTester implements ProviderConnectionTester {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async test(input: ProviderTestInput): Promise<ProviderTestResult> {
    if (!input.apiKey.trim()) return { ok: false, error: "api key is required" };

    const target = this.endpoint(input);
    if (!target) return { ok: false, error: `unsupported provider: ${input.providerName}` };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetchImpl(target.url, {
        method: "GET",
        headers: target.headers,
        signal: controller.signal
      });
      if (response.ok) return { ok: true };
      // 提取一些可读文本，不暴露完整 body
      return { ok: false, error: `${response.status} ${response.statusText || "request failed"}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private endpoint(input: ProviderTestInput): { url: string; headers: Record<string, string> } | null {
    const name = input.providerName.toLowerCase();
    if (name === "openai") {
      const base = input.baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
      return {
        url: `${base}/models`,
        headers: { Authorization: `Bearer ${input.apiKey}` }
      };
    }
    if (name === "anthropic") {
      const base = input.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
      return {
        url: `${base}/v1/models`,
        headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" }
      };
    }
    return null;
  }
}
```

```ts
// apps/pi-server/src/routes/providers.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { createProvider, getProvider, getProviderApiKey, listProviders } from "../db/repositories.js";
import type { ProviderConnectionTester } from "../providers/provider-tester.js";

export function providersRoutes(db: Database.Database, providerTester: ProviderConnectionTester) {
  const app = new Hono();

  app.get("/", (c) => c.json(listProviders(db)));

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; apiKey: string; defaultModel: string; baseUrl?: string }>();
    if (!body.name || !body.apiKey || !body.defaultModel) {
      return c.json({ error: "name, apiKey, and defaultModel are required" }, 400);
    }
    return c.json(createProvider(db, body), 201);
  });

  app.post("/:id/test", async (c) => {
    const provider = getProvider(db, c.req.param("id"));
    const apiKey = getProviderApiKey(db, c.req.param("id"));
    if (!provider || !apiKey) return c.json({ ok: false, error: "provider not found" }, 404);
    return c.json(await providerTester.test({
      providerName: provider.name,
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel
    }));
  });

  return app;
}
```

- [ ] **步骤 5：注册 route**

在 `createApp` 中加入：

```ts
import { providersRoutes } from "./routes/providers.js";
import type { ProviderConnectionTester } from "./providers/provider-tester.js";
import { LocalProviderConnectionTester } from "./providers/provider-tester.js";

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
  providerTester?: ProviderConnectionTester;
};

// inside if (options.db)
app.route("/providers", providersRoutes(options.db, options.providerTester ?? new LocalProviderConnectionTester()));
```

- [ ] **步骤 6：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add apps/pi-server/src apps/pi-server/test/provider-chat.test.ts
git commit -m "feat: add provider configuration api"
```

## 任务 3：Streaming Agent contract 和 Run API

**文件：**
- 新建：`apps/pi-server/src/agent/agent-client.ts`
- 新建：`apps/pi-server/src/agent/fake-agent-client.ts`
- 新建：`apps/pi-server/src/routes/runs.ts`
- 修改：`apps/pi-server/src/db/repositories.ts`
- 修改：`apps/pi-server/src/app.ts`
- 修改：`apps/pi-server/test/provider-chat.test.ts`

- [ ] **步骤 1：添加使用 fake streaming agent 的 run API 测试**

追加：

```ts
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import { createProvider, createSession, createWorkspace, getMessages, getRun } from "../src/db/repositories.js";

function parseSseEvents(text: string) {
  return text.split("\n\n").filter(Boolean).map((raw) => {
    const data = raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data) throw new Error(`Missing SSE data: ${raw}`);
    return JSON.parse(data);
  });
}

describe("run API", () => {
  it("streams run event envelopes and persists assistant message", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });
    const provider = createProvider(db, { name: "openai", apiKey: "sk-test", defaultModel: "gpt-4o-mini" });
    const app = createApp({ db, agentClient: new FakeAgentClient(["hello", " world"]) });

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, model: "gpt-4o-mini", content: "Say hi" }),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    const events = parseSseEvents(text);
    const runId = events[0].run_id;

    expect(events.map((event) => event.type)).toEqual(["run_started", "assistant_delta", "assistant_delta", "run_completed"]);
    expect(events.every((event) => event.run_id === runId && event.session_id === session.id && event.created_at)).toBe(true);
    expect(events[1].payload).toEqual({ text: "hello" });
    expect(getRun(db, runId)).toMatchObject({ id: runId, sessionId: session.id, status: "completed" });

    const messages = getMessages(db, session.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toBe("hello world");
  });

  it("streams run_failed envelopes and marks the run failed", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });
    const provider = createProvider(db, { name: "openai", apiKey: "sk-test", defaultModel: "gpt-4o-mini" });
    const app = createApp({
      db,
      agentClient: {
        async *run() {
          throw new Error("agent down");
        }
      }
    });

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, model: "gpt-4o-mini", content: "Say hi" }),
      headers: { "content-type": "application/json" }
    });

    const events = parseSseEvents(await response.text());
    const failed = events.find((event) => event.type === "run_failed");

    expect(failed.payload).toEqual({ message: "agent down" });
    expect(getRun(db, events[0].run_id)).toMatchObject({ status: "failed", error: "agent down" });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：FAIL，提示缺少 fake agent client。

- [ ] **步骤 3：实现 agent contract**

```ts
// apps/pi-server/src/agent/agent-client.ts
export type AgentRunInput = {
  sessionId: string;
  providerName: string;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  content: string;
};

// 注意：`assistant_message` 仅用于 server 内部计算 finalText，不会作为 SSE
// envelope 下发给客户端。客户端的 `RunEventEnvelope.type` 因此不包含它。
export type AgentRunEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_message"; text: string };

export interface AgentClient {
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
}
```

```ts
// apps/pi-server/src/agent/fake-agent-client.ts
import type { AgentClient, AgentRunEvent, AgentRunInput } from "./agent-client.js";

export class FakeAgentClient implements AgentClient {
  constructor(private readonly chunks: string[]) {}

  async *run(_input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    let full = "";
    for (const chunk of this.chunks) {
      full += chunk;
      yield { type: "assistant_delta", text: chunk };
    }
    yield { type: "assistant_message", text: full };
  }
}
```

- [ ] **步骤 4：添加 run repository 函数**

追加到 `apps/pi-server/src/db/repositories.ts`：

```ts
export type Run = {
  id: string;
  sessionId: string;
  providerId: string;
  model: string;
  status: string;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
};

const mapRun = (row: any): Run => ({
  id: row.id,
  sessionId: row.session_id,
  providerId: row.provider_id,
  model: row.model,
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
  completedAt: row.completed_at
});

export function createRun(db: Database.Database, input: { sessionId: string; providerId: string; model: string }): Run {
  const id = randomUUID();
  const timestamp = now();
  db.prepare("insert into runs (id, session_id, provider_id, model, status, created_at) values (?, ?, ?, ?, 'running', ?)")
    .run(id, input.sessionId, input.providerId, input.model, timestamp);
  return getRun(db, id)!;
}

export function updateRunStatus(db: Database.Database, id: string, input: { status: "completed" | "failed"; error?: string }) {
  db.prepare("update runs set status = ?, error = ?, completed_at = ? where id = ?")
    .run(input.status, input.error ?? null, now(), id);
}

export function getRun(db: Database.Database, id: string): Run | null {
  const row = db.prepare("select * from runs where id = ?").get(id);
  return row ? mapRun(row) : null;
}
```

- [ ] **步骤 5：实现 runs route**

```ts
// apps/pi-server/src/routes/runs.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { AgentClient } from "../agent/agent-client.js";
import { createMessage, createRun, getProvider, getProviderApiKey, updateRunStatus } from "../db/repositories.js";

type RunEventEnvelope = {
  run_id: string;
  session_id: string;
  type: "run_started" | "assistant_delta" | "run_completed" | "run_failed";
  payload: unknown;
  created_at: string;
};

function envelope(runId: string, sessionId: string, type: RunEventEnvelope["type"], payload: unknown): RunEventEnvelope {
  return {
    run_id: runId,
    session_id: sessionId,
    type,
    payload,
    created_at: new Date().toISOString()
  };
}

function sse(event: RunEventEnvelope) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function runsRoutes(db: Database.Database, agentClient: AgentClient) {
  const app = new Hono();

  app.post("/sessions/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ providerId: string; model: string; content: string }>();
    const provider = getProvider(db, body.providerId);
    const apiKey = getProviderApiKey(db, body.providerId);
    if (!provider || !apiKey) return c.json({ error: "provider not found" }, 404);

    createMessage(db, { sessionId, role: "user", content: body.content });
    const run = createRun(db, { sessionId, providerId: provider.id, model: body.model });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let finalText = "";
        controller.enqueue(encoder.encode(sse(envelope(run.id, sessionId, "run_started", { provider_id: provider.id, model: body.model }))));
        try {
          for await (const event of agentClient.run({
            sessionId,
            providerName: provider.name,
            model: body.model,
            apiKey,
            baseUrl: provider.baseUrl,
            content: body.content
          })) {
            if (event.type === "assistant_delta") controller.enqueue(encoder.encode(sse(envelope(run.id, sessionId, "assistant_delta", { text: event.text }))));
            if (event.type === "assistant_message") finalText = event.text;
          }
          const assistantMessage = createMessage(db, { sessionId, role: "assistant", content: finalText });
          updateRunStatus(db, run.id, { status: "completed" });
          controller.enqueue(encoder.encode(sse(envelope(run.id, sessionId, "run_completed", { message_id: assistantMessage.id }))));
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          updateRunStatus(db, run.id, { status: "failed", error: message });
          controller.enqueue(encoder.encode(sse(envelope(run.id, sessionId, "run_failed", { message }))));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      }
    });
  });

  return app;
}
```

- [ ] **步骤 6：注册默认 fake client**

更新 `createApp` options：

```ts
import type { AgentClient } from "./agent/agent-client.js";
import { FakeAgentClient } from "./agent/fake-agent-client.js";
import type { ProviderConnectionTester } from "./providers/provider-tester.js";
import { runsRoutes } from "./routes/runs.js";

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
  providerTester?: ProviderConnectionTester;
  agentClient?: AgentClient;
};

// inside if (options.db)
app.route("/", runsRoutes(options.db, options.agentClient ?? new FakeAgentClient(["No agent configured."])));
```

- [ ] **步骤 7：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`

预期：PASS。

- [ ] **步骤 8：提交**

```bash
git add apps/pi-server/src apps/pi-server/test/provider-chat.test.ts
git commit -m "feat: add streaming chat run api"
```

## 任务 4：pi SDK adapter

**文件：**
- 新建：`apps/pi-server/src/agent/pi-agent-client.ts`
- 新建：`apps/pi-server/test/pi-agent-client.test.ts`
- 修改：`apps/pi-server/src/index.ts`

- [ ] **步骤 1：安装 pi SDK**

运行：`pnpm add --filter @marginalia/pi-server @mariozechner/pi-coding-agent@0.73.1`

预期：包被加入 server dependencies。

- [ ] **步骤 2：验证 SDK 事件 API 的类型事实**

下面的 gate 不仅验证 `agent-session.d.ts` 的三个方法签名，还要确认 adapter 实现里用到的所有顶层导出（`createAgentSession`、`AuthStorage`、`ModelRegistry`、`SessionManager`）都真实存在。如果 SDK 实际命名与假设不符，必须在写 adapter 之前发现并修订。

运行：

```bash
node -e "
const fs = require('fs');
const path = require('path');
const sdkDir = 'apps/pi-server/node_modules/@mariozechner/pi-coding-agent';

// 1) AgentSession 方法签名
const sessionDts = fs.readFileSync(path.join(sdkDir, 'dist/core/agent-session.d.ts'), 'utf8');
const required = [
  'subscribe(listener: AgentSessionEventListener): () => void',
  'prompt(text: string, options?: PromptOptions): Promise<void>',
  'getLastAssistantText(): string | undefined'
];
for (const sig of required) {
  if (!sessionDts.includes(sig)) {
    console.error('Missing AgentSession signature:', sig);
    process.exit(1);
  }
}

// 2) 顶层导出
const pkg = require(path.join(process.cwd(), sdkDir, 'package.json'));
const entry = require(path.join(process.cwd(), sdkDir, pkg.main || pkg.exports?.['.']?.import || 'dist/index.js'));
for (const name of ['createAgentSession', 'AuthStorage', 'ModelRegistry', 'SessionManager']) {
  if (typeof entry[name] === 'undefined') {
    console.error('Missing top-level export:', name);
    process.exit(1);
  }
}
"
```

预期：以 0 退出。这个 gate 明确 `prompt()` 返回 `Promise<void>`，adapter 必须通过 `subscribe()` 监听 `message_update`/`message_end`，不能把 `prompt()` 当成返回文本。**如果第二段 gate 报缺失导出，必须停下来检查 SDK 实际 API，不要继续写 adapter。**

- [ ] **步骤 3：编写预期失败的 adapter 单元测试**

```ts
// apps/pi-server/test/pi-agent-client.test.ts
import { describe, expect, it, vi } from "vitest";
import type { AgentRunInput } from "../src/agent/agent-client.js";
import { PiAgentClient, type PiSessionLike } from "../src/agent/pi-agent-client.js";

const input: AgentRunInput = {
  sessionId: "s1",
  providerName: "openai",
  model: "gpt-4o-mini",
  apiKey: "sk-test",
  baseUrl: null,
  content: "Say hi"
};

async function collect(client: PiAgentClient) {
  const events = [];
  for await (const event of client.run(input)) events.push(event);
  return events;
}

describe("PiAgentClient", () => {
  it("converts pi message_update events into assistant deltas and final message", async () => {
    const listeners: Array<(event: any) => void> = [];
    const fakeSession: PiSessionLike = {
      subscribe: vi.fn((listener) => {
        listeners.push(listener);
        return () => {};
      }),
      prompt: vi.fn(async () => {
        listeners.forEach((listener) => listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "hello" }
        }));
        listeners.forEach((listener) => listener({
          type: "message_end",
          message: { role: "assistant" }
        }));
      }),
      getLastAssistantText: vi.fn(() => "hello"),
      dispose: vi.fn()
    };
    const client = new PiAgentClient(async () => fakeSession);

    await expect(collect(client)).resolves.toEqual([
      { type: "assistant_delta", text: "hello" },
      { type: "assistant_message", text: "hello" }
    ]);
    expect(fakeSession.prompt).toHaveBeenCalledWith("Say hi");
    expect(fakeSession.dispose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **步骤 4：运行 adapter 测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- pi-agent-client.test.ts`

预期：FAIL，提示缺少 `PiAgentClient`。

- [ ] **步骤 5：实现 adapter**

```ts
// apps/pi-server/src/agent/pi-agent-client.ts
import {
  AuthStorage,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  ModelRegistry,
  SessionManager
} from "@mariozechner/pi-coding-agent";
import type { AgentClient, AgentRunEvent, AgentRunInput } from "./agent-client.js";

export type PiSessionLike = Pick<AgentSession, "subscribe" | "prompt" | "getLastAssistantText" | "dispose">;
export type CreatePiSession = (input: AgentRunInput) => Promise<PiSessionLike>;

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;
  private failure: Error | null = null;

  push(value: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end() {
    this.ended = true;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined, done: true });
  }

  fail(error: Error) {
    this.failure = error;
    this.end();
  }

  async *consume(): AsyncIterable<T> {
    while (true) {
      if (this.values.length) {
        yield this.values.shift()!;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.ended) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (this.failure) throw this.failure;
      if (next.done) return;
      yield next.value;
    }
  }
}

async function createRealPiSession(input: AgentRunInput): Promise<PiSessionLike> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(input.providerName, input.apiKey);

  const modelRegistry = ModelRegistry.create(authStorage);
  if (input.baseUrl) {
    modelRegistry.registerProvider(input.providerName, {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey
    });
  }

  const model = modelRegistry.find(input.providerName, input.model);
  if (!model) throw new Error(`Model not found: ${input.providerName}/${input.model}`);

  const { session } = await createAgentSession({
    authStorage,
    modelRegistry,
    model,
    sessionManager: SessionManager.inMemory(),
    noTools: "all"
  });
  return session;
}

export class PiAgentClient implements AgentClient {
  constructor(private readonly createSession: CreatePiSession = createRealPiSession) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    const session = await this.createSession(input);
    const queue = new AsyncQueue<AgentRunEvent>();
    let finalText = "";

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        queue.push({ type: "assistant_delta", text: event.assistantMessageEvent.delta });
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        finalText = session.getLastAssistantText() ?? finalText;
        queue.end();
      }
    });

    const prompt = session.prompt(input.content).then(() => {
      finalText = session.getLastAssistantText() ?? finalText;
      queue.end();
    }).catch((error: unknown) => {
      queue.fail(error instanceof Error ? error : new Error("pi prompt failed"));
    });

    try {
      for await (const event of queue.consume()) yield event;
      await prompt;
      yield { type: "assistant_message", text: finalText };
    } finally {
      unsubscribe();
      session.dispose();
    }
  }
}
```

- [ ] **步骤 6：运行 adapter 测试和 typecheck**

运行：

```bash
pnpm --filter @marginalia/pi-server test -- pi-agent-client.test.ts
pnpm --filter @marginalia/pi-server typecheck
```

预期：全部 PASS。

- [ ] **步骤 7：在 server 入口使用真实 adapter**

在 `index.ts` 中用下面方式创建 app：

```ts
import { PiAgentClient } from "./agent/pi-agent-client.js";

const app = createApp({ db, agentClient: new PiAgentClient() });
```

- [ ] **步骤 8：手动验证真实 provider**

运行：`pnpm dev`，配置一个真实 provider key 后发送一条短消息。

预期：SSE 收到 `assistant_delta` envelopes，最终收到 `run_completed`，DB 中有 assistant message。失败时必须看到 `run_failed` envelope 和 `runs.error`。

- [ ] **步骤 9：提交**

```bash
git add apps/pi-server package.json pnpm-lock.yaml
git commit -m "feat: connect chat runs to pi sdk"
```

## 任务 5：Desktop Chat UI

**文件：**
- 修改：`apps/desktop/src/api/client.ts`
- 新建：`apps/desktop/src/chat/ChatView.tsx`
- 新建：`apps/desktop/src/chat/ChatView.test.tsx`
- 修改：`apps/desktop/src/workspaces/WorkspaceShell.tsx`

- [ ] **步骤 1：编写预期失败的 SSE parser 测试**

```ts
// apps/desktop/src/api/client.test.ts
import { describe, expect, it } from "vitest";
import { readSse } from "./client";

describe("readSse", () => {
  it("parses run event envelopes across chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: assistant_delta\ndata: {"run_id":"r1","session_id":"s1",'));
        controller.enqueue(encoder.encode('"type":"assistant_delta","payload":{"text":"hi"},"created_at":"2026-05-25T00:00:00.000Z"}\n\n'));
        controller.close();
      }
    });

    const events = [];
    for await (const event of readSse(new Response(stream))) events.push(event);

    expect(events).toEqual([{
      run_id: "r1",
      session_id: "s1",
      type: "assistant_delta",
      payload: { text: "hi" },
      created_at: "2026-05-25T00:00:00.000Z"
    }]);
  });
});
```

- [ ] **步骤 2：运行 SSE parser 测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- client.test.ts`

预期：FAIL，提示缺少 `readSse`。

- [ ] **步骤 3：编写预期失败的 chat UI 测试**

```tsx
// apps/desktop/src/chat/ChatView.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";

describe("ChatView", () => {
  it("uses the selected session model and displays streamed assistant text", async () => {
    const api = {
      listMessages: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn().mockResolvedValue([{ id: "p1", name: "openai", defaultModel: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4.1"] }]),
      runSession: vi.fn().mockImplementation(async function* () {
        yield { run_id: "r1", session_id: "s1", type: "assistant_delta", payload: { text: "hello" }, created_at: "2026-05-25T00:00:00.000Z" };
        yield { run_id: "r1", session_id: "s1", type: "run_completed", payload: {}, created_at: "2026-05-25T00:00:01.000Z" };
      })
    };

    render(<ChatView api={api} session={{ id: "s1", model: "gpt-4.1" }} />);
    await userEvent.type(await screen.findByLabelText("Message"), "Say hi");
    await userEvent.click(screen.getByText("Send"));

    expect(api.runSession).toHaveBeenCalledWith("s1", { providerId: "p1", model: "gpt-4.1", content: "Say hi" });
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });

  it("shows sending error and retries the last message", async () => {
    const api = {
      listMessages: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn().mockResolvedValue([{ id: "p1", name: "openai", defaultModel: "gpt-4o-mini" }]),
      runSession: vi.fn()
        .mockImplementationOnce(async function* () {
          yield { run_id: "r1", session_id: "s1", type: "run_failed", payload: { message: "provider down" }, created_at: "2026-05-25T00:00:00.000Z" };
        })
        .mockImplementationOnce(async function* () {
          yield { run_id: "r2", session_id: "s1", type: "assistant_delta", payload: { text: "recovered" }, created_at: "2026-05-25T00:00:01.000Z" };
          yield { run_id: "r2", session_id: "s1", type: "run_completed", payload: {}, created_at: "2026-05-25T00:00:02.000Z" };
        })
    };

    render(<ChatView api={api} session={{ id: "s1", model: "gpt-4o-mini" }} />);
    await userEvent.type(await screen.findByLabelText("Message"), "Retry me");
    await userEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("provider down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(api.runSession).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("recovered")).toBeInTheDocument();
  });
});
```

- [ ] **步骤 4：运行 ChatView 测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- ChatView.test.tsx`

预期：FAIL，提示缺少 `ChatView`。

- [ ] **步骤 5：扩展 API client**

加入：

```ts
export type RunEventEnvelope = {
  run_id: string;
  session_id: string;
  type: "run_started" | "assistant_delta" | "run_completed" | "run_failed";
  payload: any;
  created_at: string;
};

export async function* readSse(response: Response): AsyncGenerator<RunEventEnvelope> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function* parse(block: string) {
    const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (data) yield JSON.parse(data) as RunEventEnvelope;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) yield* parse(raw);
  }
  if (buffer.trim()) yield* parse(buffer);
}
```

在 `createApiClient` 内加入：

```ts
listMessages: (sessionId: string) => request<any[]>(baseUrl, `/sessions/${sessionId}/messages`),
listProviders: () => request<any[]>(baseUrl, "/providers"),
updateSession: (sessionId: string, patch: { model?: string | null }) =>
  request<any>(baseUrl, `/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(patch) }),
runSession: async function* (sessionId: string, input: { providerId: string; model: string; content: string }) {
  const response = await fetch(`${baseUrl}/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await response.text());
  yield* readSse(response);
}
```

- [ ] **步骤 6：实现 `ChatView`**

```tsx
// apps/desktop/src/chat/ChatView.tsx
import { FormEvent, useEffect, useState } from "react";

type Provider = { id: string; name: string; defaultModel: string; models?: string[] };
type Message = { id?: string; role: string; content: string };
type Session = { id: string; model?: string | null };
type RunEventEnvelope = {
  type: "run_started" | "assistant_delta" | "run_completed" | "run_failed";
  payload: any;
};

export function ChatView({ api, session }: { api: any; session: Session }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState(session.model ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lastContent, setLastContent] = useState("");

  useEffect(() => {
    api.listMessages(session.id).then(setMessages);
    api.listProviders().then((items: Provider[]) => {
      setProviders(items);
      const first = items[0];
      if (first) {
        setSelectedProviderId(first.id);
        setSelectedModel((current) => current || first.defaultModel);
      }
    });
  }, [api, session.id]);

  async function send(userContent: string) {
    const provider = providers.find((item) => item.id === selectedProviderId);
    if (!provider || !userContent.trim()) return;
    let assistantText = "";
    setSending(true);
    setError("");
    setLastContent(userContent);
    setMessages((current) => [...current, { role: "user", content: userContent }]);
    setDraft("");
    try {
      for await (const event of api.runSession(session.id, { providerId: provider.id, model: selectedModel, content: userContent }) as AsyncIterable<RunEventEnvelope>) {
        if (event.type === "run_failed") throw new Error(event.payload.message);
        if (event.type === "assistant_delta") {
          assistantText += event.payload.text;
          setDraft(assistantText);
        }
      }
      setMessages((current) => [...current, { role: "assistant", content: assistantText }]);
      setDraft("");
      setContent("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await send(content);
  }

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const modelOptions = selectedProvider?.models ?? (selectedProvider ? [selectedProvider.defaultModel] : []);

  return (
    <section>
      <label>
        Model
        <select
          value={selectedModel}
          onChange={(event) => {
            const next = event.target.value;
            setSelectedModel(next);
            // 持久化到 session.model，重启后仍能恢复
            api.updateSession(session.id, { model: next }).catch(() => {
              /* 失败不阻塞，错误会在下一次 send 中显式暴露 */
            });
          }}
        >
          {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>
      <div>
        {messages.map((message, index) => <p key={message.id ?? index}>{message.content}</p>)}
        {draft && <p>{draft}</p>}
      </div>
      <form onSubmit={submit}>
        <label>Message<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <button type="submit" disabled={sending || providers.length === 0}>{sending ? "Sending..." : "Send"}</button>
      </form>
      {error && (
        <section>
          <p>{error}</p>
          <button type="button" onClick={() => send(lastContent)}>Retry</button>
        </section>
      )}
    </section>
  );
}
```

- [ ] **步骤 7：把 ChatView 接入 WorkspaceShell**

在 `WorkspaceShell.tsx` 的 active session 区域中用 `ChatView` 替换临时 message form：

```tsx
{activeSession && <ChatView api={api} session={activeSession} />}
```

并删除本地重复的 `messages/message/sendMessage` 状态，消息读写统一由 `ChatView` 负责。

- [ ] **步骤 8：运行测试和 typecheck**

运行：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server test
pnpm typecheck
```

预期：全部通过。

- [ ] **步骤 9：手动验证**

运行：`pnpm dev`

预期：通过 API 创建 provider 或 seed DB，打开 session，选择 model，发送消息，看到流式文本；失败时出现 Retry；reload 后仍能看到持久化消息。

- [ ] **步骤 10：提交**

```bash
git add apps/desktop apps/pi-server
git commit -m "feat: add streaming chat interface"
```

## 自检

- 规格覆盖：覆盖 provider config/test、session 级 model 字段、pi SDK adapter、run SSE envelopes、assistant 持久化、readSse parser 和 chat UI 发送/错误/重试状态。
- 占位符扫描：没有缺失测试说明或未指定验证。
- 类型一致性：server SSE envelope 与 renderer 的 `readSse`、`ChatView` 处理一致。
