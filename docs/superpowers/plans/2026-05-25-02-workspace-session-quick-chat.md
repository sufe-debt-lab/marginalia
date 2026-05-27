# Workspace、Session 与 Quick Chat 实现计划

> **给 agentic worker：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 在本机桌面壳之上加入可持久化的 workspace、session、message 和 Quick chat。

**架构：** pi-server 负责 SQLite 和 REST API。Desktop renderer 使用一个小的类型化 API client，当前视图自己维护 UI 状态。Quick chat 规则放在 server 侧，保证所有入口都使用同一套“最近 workspace”逻辑。

**技术栈：** TypeScript、Hono、better-sqlite3、Vitest、React Testing Library。

---

## 文件结构

- 修改：`apps/pi-server/package.json` — 添加 SQLite 依赖。
- 新建：`apps/pi-server/src/db/connection.ts` — 打开数据库路径。
- 新建：`apps/pi-server/src/db/migrations.ts` — 幂等 schema 初始化。
- 新建：`apps/pi-server/src/db/repositories.ts` — workspace/session/message 查询。
- 新建：`apps/pi-server/src/routes/workspaces.ts` — workspace API。
- 新建：`apps/pi-server/src/routes/sessions.ts` — session 和 messages API。
- 新建：`apps/pi-server/src/routes/quick-chat.ts` — Quick chat API。
- 修改：`apps/pi-server/src/app.ts` — 注册 routes 和 DB。
- 新建：`apps/pi-server/test/workspace-session.test.ts` — API 测试。
- 新建：`apps/desktop/src/api/client.ts` — 类型化 fetch wrapper。
- 修改：`apps/desktop/electron/main.ts` — 暴露选择 workspace 目录的 IPC。
- 修改：`apps/desktop/electron/preload.ts` — 暴露 `pickWorkspaceDirectory()`。
- 修改：`apps/desktop/src/App.tsx` — server ready 后展示 shell layout。
- 新建：`apps/desktop/src/workspaces/WorkspaceShell.tsx` — 左栏和首启控件。
- 新建：`apps/desktop/src/workspaces/WorkspaceShell.test.tsx` — UI 测试。

## 前置 Gate

执行本计划前必须确认第 01 份 spec/plan 已完成，不能在空仓库里跳过桌面壳和 pi-server 基线。

```bash
test -f pnpm-workspace.yaml
test -f apps/pi-server/package.json
test -f apps/desktop/package.json
pnpm --filter @marginalia/pi-server test -- health.test.ts
pnpm --filter @marginalia/desktop test -- App.test.tsx
```

预期：全部以 0 退出。任何一条失败都先回到 `2026-05-25-01-local-shell-and-server.md` 修复。

## TDD 覆盖矩阵

| 功能点 | 先写的失败测试 | 通过标准 |
| --- | --- | --- |
| schema + migration version | `workspace-session.test.ts` | 建表后 `schema_migrations` 记录版本 `1`。 |
| workspace recent 逻辑 | `workspace-session.test.ts` | 新 workspace 的 `last_opened_at` 为 `null`，显式 open 后才成为最近。 |
| session/message 持久化 | `workspace-session.test.ts` | 重启 file-backed DB 后 workspace、session、message 仍可读。 |
| API 完整闭环 | `workspace-session.test.ts` | 覆盖 `GET/POST /workspaces`、`PATCH /workspaces/:id/open`、`GET /workspaces/:id/sessions`、`POST /sessions`、`GET/POST /sessions/:id/messages`、`POST /quick-chat`。 |
| Quick chat 无 workspace | `workspace-session.test.ts` + `WorkspaceShell.test.tsx` | Server 返回 409，UI 展示创建 workspace 的指引。 |
| 选择已有目录 | `WorkspaceShell.test.tsx` | 点击 Browse 会调用 preload directory picker 并填入路径。 |
| session/message UI | `WorkspaceShell.test.tsx` | 可以创建/打开 session，发送 user message，并看到消息列表。 |

## 任务 1：SQLite 连接和 migrations

**文件：**
- 修改：`apps/pi-server/package.json`
- 新建：`apps/pi-server/src/db/connection.ts`
- 新建：`apps/pi-server/src/db/migrations.ts`
- 测试：`apps/pi-server/test/workspace-session.test.ts`

- [ ] **步骤 1：添加依赖**

运行：`pnpm add --filter @marginalia/pi-server better-sqlite3 && pnpm add -D --filter @marginalia/pi-server @types/better-sqlite3`

预期：`better-sqlite3` 出现在 server dependencies 中。

- [ ] **步骤 2：编写预期失败的 migration 测试**

```ts
// apps/pi-server/test/workspace-session.test.ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";

const dbs: Database.Database[] = [];

function memoryDb() {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("migrations", () => {
  it("creates workspace session and message tables", () => {
    const db = memoryDb();
    migrate(db);

    const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all();

    expect(tables).toEqual([
      { name: "messages" },
      { name: "schema_migrations" },
      { name: "sessions" },
      { name: "workspaces" }
    ]);
    expect(db.prepare("select version from schema_migrations").all()).toEqual([{ version: 1 }]);
  });
});
```

- [ ] **步骤 3：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：FAIL，提示缺少 `../src/db/migrations`。

- [ ] **步骤 4：实现 connection 和 migrations**

```ts
// apps/pi-server/src/db/connection.ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function defaultDbPath() {
  const home = process.env.HOME ?? process.cwd();
  return path.join(home, ".marginalia", "db.sqlite");
}

export function openDatabase(filePath = process.env.MARGINALIA_DB_PATH ?? defaultDbPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}
```

```ts
// apps/pi-server/src/db/migrations.ts
import type Database from "better-sqlite3";

export function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_dir TEXT NOT NULL,
      last_opened_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'desktop',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
  db.prepare("insert or ignore into schema_migrations (version, applied_at) values (?, ?)").run(1, Date.now());
}
```

- [ ] **步骤 5：运行测试确认通过**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add apps/pi-server package.json pnpm-lock.yaml
git commit -m "feat: add workspace database schema"
```

## 任务 2：Repository 层

**文件：**
- 新建：`apps/pi-server/src/db/repositories.ts`
- 修改：`apps/pi-server/test/workspace-session.test.ts`

- [ ] **步骤 1：添加 repository 测试**

追加到 `workspace-session.test.ts`：

```ts
import {
  createMessage,
  createSession,
  createWorkspace,
  getMessages,
  getRecentWorkspace,
  listSessions,
  listWorkspaces,
  markWorkspaceOpened
} from "../src/db/repositories.js";

describe("workspace repositories", () => {
  it("creates workspaces and tracks the most recent workspace", () => {
    const db = memoryDb();
    migrate(db);

    const first = createWorkspace(db, { name: "Alpha", rootDir: "/tmp/alpha" });
    const second = createWorkspace(db, { name: "Beta", rootDir: "/tmp/beta" });

    expect(getRecentWorkspace(db)).toBeNull();

    markWorkspaceOpened(db, first.id);

    expect(listWorkspaces(db).map((w) => w.name)).toEqual(["Alpha", "Beta"]);
    expect(getRecentWorkspace(db)?.id).toBe(first.id);
    expect(second.rootDir).toBe("/tmp/beta");
  });

  it("creates sessions and messages", () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const session = createSession(db, { workspaceId: workspace.id, title: "Read paper", origin: "desktop" });
    createMessage(db, { sessionId: session.id, role: "user", content: "hello" });

    expect(listSessions(db, workspace.id)).toMatchObject([{ id: session.id, title: "Read paper" }]);
    expect(getMessages(db, session.id)).toMatchObject([{ role: "user", content: "hello" }]);
  });

  it("orders sessions by most recent message activity", () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const first = createSession(db, { workspaceId: workspace.id, title: "First", origin: "desktop" });
    const second = createSession(db, { workspaceId: workspace.id, title: "Second", origin: "desktop" });

    // 先给 second 加消息，再给 first 加消息，确保 first 的 updated_at 最新
    createMessage(db, { sessionId: second.id, role: "user", content: "second bump" });
    createMessage(db, { sessionId: first.id, role: "user", content: "first bump" });

    expect(listSessions(db, workspace.id).map((session) => session.id)).toEqual([first.id, second.id]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：FAIL，提示缺少 repository exports。

- [ ] **步骤 3：实现 repositories**

```ts
// apps/pi-server/src/db/repositories.ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

let lastTimestamp = 0;
const now = () => {
  const current = Date.now();
  lastTimestamp = Math.max(current, lastTimestamp + 1);
  return lastTimestamp;
};

export type Workspace = {
  id: string;
  name: string;
  rootDir: string;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  origin: string;
  createdAt: number;
  updatedAt: number;
};

export type Message = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
};

const mapWorkspace = (row: any): Workspace => ({
  id: row.id,
  name: row.name,
  rootDir: row.root_dir,
  lastOpenedAt: row.last_opened_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapSession = (row: any): Session => ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  origin: row.origin,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapMessage = (row: any): Message => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  content: row.content,
  createdAt: row.created_at
});

export function createWorkspace(db: Database.Database, input: { name: string; rootDir: string }): Workspace {
  const id = randomUUID();
  const timestamp = now();
  db.prepare("insert into workspaces (id, name, root_dir, last_opened_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
    .run(id, input.name, input.rootDir, null, timestamp, timestamp);
  return listWorkspaces(db).find((workspace) => workspace.id === id)!;
}

export function listWorkspaces(db: Database.Database): Workspace[] {
  return db.prepare("select * from workspaces order by created_at asc").all().map(mapWorkspace);
}

export function markWorkspaceOpened(db: Database.Database, id: string) {
  db.prepare("update workspaces set last_opened_at = ?, updated_at = ? where id = ?").run(now(), now(), id);
}

export function getRecentWorkspace(db: Database.Database): Workspace | null {
  const row = db.prepare("select * from workspaces where last_opened_at is not null order by last_opened_at desc limit 1").get();
  return row ? mapWorkspace(row) : null;
}

export function createSession(db: Database.Database, input: { workspaceId: string; title: string; origin: string }): Session {
  const id = randomUUID();
  const timestamp = now();
  db.prepare("insert into sessions (id, workspace_id, title, origin, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
    .run(id, input.workspaceId, input.title, input.origin, timestamp, timestamp);
  return listSessions(db, input.workspaceId).find((session) => session.id === id)!;
}

export function listSessions(db: Database.Database, workspaceId: string): Session[] {
  return db.prepare("select * from sessions where workspace_id = ? order by updated_at desc").all(workspaceId).map(mapSession);
}

export function createMessage(db: Database.Database, input: { sessionId: string; role: string; content: string }): Message {
  const id = randomUUID();
  const timestamp = now();
  db.transaction(() => {
    db.prepare("insert into messages (id, session_id, role, content, created_at) values (?, ?, ?, ?, ?)")
      .run(id, input.sessionId, input.role, input.content, timestamp);
    db.prepare("update sessions set updated_at = ? where id = ?").run(timestamp, input.sessionId);
  })();
  return getMessages(db, input.sessionId).find((message) => message.id === id)!;
}

export function getMessages(db: Database.Database, sessionId: string): Message[] {
  return db.prepare("select * from messages where session_id = ? order by created_at asc").all(sessionId).map(mapMessage);
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add apps/pi-server/src/db apps/pi-server/test
git commit -m "feat: add workspace repositories"
```

## 任务 3：REST API routes

**文件：**
- 新建：`apps/pi-server/src/routes/workspaces.ts`
- 新建：`apps/pi-server/src/routes/sessions.ts`
- 新建：`apps/pi-server/src/routes/quick-chat.ts`
- 修改：`apps/pi-server/src/app.ts`
- 修改：`apps/pi-server/src/index.ts`
- 修改：`apps/pi-server/test/workspace-session.test.ts`

- [ ] **步骤 1：添加 API 测试**

追加：

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";

const tempRoots: string[] = [];

function tempDir() {
  const root = mkdtempSync(path.join(tmpdir(), "marginalia-db-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace API", () => {
  it("returns 409 when quick chat starts without a recent workspace", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const response = await app.request("/quick-chat", { method: "POST" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Create a workspace before starting Quick chat." });
  });

  it("covers workspace session message APIs and quick chat recent workspace", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const createWorkspaceResponse = await app.request("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Docs", rootDir: "/tmp/docs" }),
      headers: { "content-type": "application/json" }
    });
    const workspace = await createWorkspaceResponse.json();

    expect(createWorkspaceResponse.status).toBe(201);
    expect(workspace.name).toBe("Docs");

    const listWorkspaceResponse = await app.request("/workspaces");
    expect(await listWorkspaceResponse.json()).toMatchObject([{ id: workspace.id, name: "Docs" }]);

    const openWorkspaceResponse = await app.request(`/workspaces/${workspace.id}/open`, { method: "PATCH" });
    expect(openWorkspaceResponse.status).toBe(200);

    const createSessionResponse = await app.request("/sessions", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspace.id, title: "Read paper", origin: "desktop" }),
      headers: { "content-type": "application/json" }
    });
    const session = await createSessionResponse.json();

    expect(createSessionResponse.status).toBe(201);
    expect(session).toMatchObject({ workspaceId: workspace.id, title: "Read paper" });

    const listSessionResponse = await app.request(`/workspaces/${workspace.id}/sessions`);
    expect(await listSessionResponse.json()).toMatchObject([{ id: session.id, title: "Read paper" }]);

    const quickChatResponse = await app.request("/quick-chat", { method: "POST" });
    const quickChat = await quickChatResponse.json();

    expect(quickChatResponse.status).toBe(201);
    expect(quickChat.workspaceId).toBe(workspace.id);
    expect(quickChat.origin).toBe("quick_chat");

    const messageResponse = await app.request(`/sessions/${quickChat.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "user", content: "hello" }),
      headers: { "content-type": "application/json" }
    });

    expect(messageResponse.status).toBe(201);
    expect(await messageResponse.json()).toMatchObject({ role: "user", content: "hello" });

    const messagesResponse = await app.request(`/sessions/${quickChat.id}/messages`);
    expect(await messagesResponse.json()).toMatchObject([{ role: "user", content: "hello" }]);
  });

  it("persists workspace session and message data after reopening the database", () => {
    const file = path.join(tempDir(), "db.sqlite");
    const firstDb = openDatabase(file);
    migrate(firstDb);
    const workspace = createWorkspace(firstDb, { name: "Persisted", rootDir: "/tmp/persisted" });
    const session = createSession(firstDb, { workspaceId: workspace.id, title: "Saved session", origin: "desktop" });
    createMessage(firstDb, { sessionId: session.id, role: "user", content: "saved" });
    firstDb.close();

    const secondDb = openDatabase(file);
    migrate(secondDb);

    expect(listWorkspaces(secondDb)).toMatchObject([{ id: workspace.id, name: "Persisted" }]);
    expect(listSessions(secondDb, workspace.id)).toMatchObject([{ id: session.id, title: "Saved session" }]);
    expect(getMessages(secondDb, session.id)).toMatchObject([{ role: "user", content: "saved" }]);

    secondDb.close();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：FAIL，因为 routes 还没有注册。

- [ ] **步骤 3：实现 route modules**

```ts
// apps/pi-server/src/routes/workspaces.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { createWorkspace, listWorkspaces, markWorkspaceOpened } from "../db/repositories.js";

export function workspacesRoutes(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => c.json(listWorkspaces(db)));

  app.post("/", async (c) => {
    const body = await c.req.json<{ name: string; rootDir: string }>();
    if (!body.name || !body.rootDir) return c.json({ error: "name and rootDir are required" }, 400);
    return c.json(createWorkspace(db, body), 201);
  });

  app.patch("/:id/open", (c) => {
    markWorkspaceOpened(db, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
```

```ts
// apps/pi-server/src/routes/sessions.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { createMessage, createSession, getMessages, listSessions } from "../db/repositories.js";

export function sessionsRoutes(db: Database.Database) {
  const app = new Hono();

  app.get("/workspaces/:workspaceId/sessions", (c) => c.json(listSessions(db, c.req.param("workspaceId"))));

  app.post("/sessions", async (c) => {
    const body = await c.req.json<{ workspaceId: string; title?: string; origin?: string }>();
    if (!body.workspaceId) return c.json({ error: "workspaceId is required" }, 400);
    return c.json(createSession(db, {
      workspaceId: body.workspaceId,
      title: body.title ?? "New session",
      origin: body.origin ?? "desktop"
    }), 201);
  });

  app.get("/sessions/:sessionId/messages", (c) => c.json(getMessages(db, c.req.param("sessionId"))));

  app.post("/sessions/:sessionId/messages", async (c) => {
    const body = await c.req.json<{ role: string; content: string }>();
    if (!body.role || !body.content) return c.json({ error: "role and content are required" }, 400);
    return c.json(createMessage(db, { sessionId: c.req.param("sessionId"), role: body.role, content: body.content }), 201);
  });

  return app;
}
```

```ts
// apps/pi-server/src/routes/quick-chat.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { createSession, getRecentWorkspace } from "../db/repositories.js";

export function quickChatRoutes(db: Database.Database) {
  const app = new Hono();

  app.post("/", (c) => {
    const workspace = getRecentWorkspace(db);
    if (!workspace) return c.json({ error: "Create a workspace before starting Quick chat." }, 409);
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Quick chat",
      origin: "quick_chat"
    });
    return c.json(session, 201);
  });

  return app;
}
```

- [ ] **步骤 4：注册 DB 和 routes**

修改 `createApp` 让它接收 `db`，在 `index.ts` 中运行 migrations，并注册 routes：

```ts
// apps/pi-server/src/app.ts
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { createHealthInfo } from "./health.js";
import { quickChatRoutes } from "./routes/quick-chat.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { workspacesRoutes } from "./routes/workspaces.js";

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
};

export function createApp(options: AppOptions = {}) {
  const startedAt = options.startedAt ?? new Date();
  const app = new Hono();

  app.get("/health", (c) => c.json(createHealthInfo(startedAt)));

  if (options.db) {
    app.route("/workspaces", workspacesRoutes(options.db));
    app.route("/", sessionsRoutes(options.db));
    app.route("/quick-chat", quickChatRoutes(options.db));
  }

  return app;
}
```

```ts
// apps/pi-server/src/index.ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrations.js";

const requestedPort = Number(process.env.PORT ?? "0");
const host = process.env.HOST ?? "127.0.0.1";
const db = openDatabase();
migrate(db);
const app = createApp({ db });

const server = serve({ fetch: app.fetch, hostname: host, port: Number.isFinite(requestedPort) ? requestedPort : 0 }, (info) => {
  process.stdout.write(`MARGINALIA_SERVER_READY ${JSON.stringify({ host, port: info.port, url: `http://${host}:${info.port}` })}\n`);
});

function shutdown() {
  db.close();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **步骤 5：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- workspace-session.test.ts`

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add apps/pi-server/src apps/pi-server/test
git commit -m "feat: add workspace session api"
```

## 任务 4：Desktop Workspace UI

**文件：**
- 新建：`apps/desktop/src/api/client.ts`
- 新建：`apps/desktop/src/workspaces/WorkspaceShell.tsx`
- 新建：`apps/desktop/src/workspaces/WorkspaceShell.test.tsx`
- 修改：`apps/desktop/src/App.tsx`

- [ ] **步骤 1：编写预期失败的 UI 测试**

```tsx
// apps/desktop/src/workspaces/WorkspaceShell.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./WorkspaceShell";

describe("WorkspaceShell", () => {
  function createApi(overrides: Record<string, unknown> = {}) {
    return {
      listWorkspaces: vi.fn().mockResolvedValue([]),
      createWorkspace: vi.fn().mockResolvedValue({ id: "w1", name: "Docs", rootDir: "/tmp/docs" }),
      markWorkspaceOpened: vi.fn().mockResolvedValue({ ok: true }),
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({ id: "s1", workspaceId: "w1", title: "Notes", origin: "desktop" }),
      listMessages: vi.fn().mockResolvedValue([]),
      createMessage: vi.fn().mockResolvedValue({ id: "m1", sessionId: "s1", role: "user", content: "hello" }),
      startQuickChat: vi.fn().mockResolvedValue({ id: "q1", workspaceId: "w1", title: "Quick chat", origin: "quick_chat" }),
      ...overrides
    };
  }

  it("guides the user to create a workspace when quick chat has no recent workspace", async () => {
    // 模拟 fetch 返回 409，覆盖 API client 的完整 HTTP → Error 转换链路
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "Create a workspace before starting Quick chat." })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createApiClient } = await import("../api/client");
    const api = createApiClient("http://127.0.0.1:4321");

    render(<WorkspaceShell api={api} pickWorkspaceDirectory={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Quick chat" }));

    // 不只是显示错误文字，还要把焦点放到 workspace name 输入框上，引导用户创建
    expect(await screen.findByText("Create a workspace before starting Quick chat.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Workspace name")).toHaveFocus());

    vi.unstubAllGlobals();
  });

  it("uses the directory picker to fill the workspace path", async () => {
    const api = createApi();
    const pickWorkspaceDirectory = vi.fn().mockResolvedValue("/tmp/docs");

    render(<WorkspaceShell api={api} pickWorkspaceDirectory={pickWorkspaceDirectory} />);
    await userEvent.click(screen.getByRole("button", { name: "Browse" }));

    expect(pickWorkspaceDirectory).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Workspace path")).toHaveValue("/tmp/docs");
  });

  it("creates a workspace and starts quick chat", async () => {
    const api = createApi();

    render(<WorkspaceShell api={api} pickWorkspaceDirectory={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Workspace name"), "Docs");
    await userEvent.type(screen.getByLabelText("Workspace path"), "/tmp/docs");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await userEvent.click(screen.getByRole("button", { name: "Quick chat" }));

    await waitFor(() => expect(api.startQuickChat).toHaveBeenCalled());
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Quick chat started")).toBeInTheDocument();
  });

  it("creates a session and appends user messages", async () => {
    const api = createApi({
      listWorkspaces: vi.fn().mockResolvedValue([{ id: "w1", name: "Docs", rootDir: "/tmp/docs" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "s1", workspaceId: "w1", title: "Notes", origin: "desktop" }]),
      listMessages: vi.fn().mockResolvedValue([{ id: "m0", sessionId: "s1", role: "assistant", content: "ready" }])
    });

    render(<WorkspaceShell api={api} pickWorkspaceDirectory={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Docs" }));
    await userEvent.click(await screen.findByRole("button", { name: "Notes" }));
    expect(await screen.findByText("ready")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(api.createMessage).toHaveBeenCalledWith("s1", { role: "user", content: "hello" });
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- WorkspaceShell.test.tsx`

预期：FAIL，提示缺少 `WorkspaceShell`。

- [ ] **步骤 3：实现 API client**

```ts
// apps/desktop/src/api/client.ts
export type ApiClient = ReturnType<typeof createApiClient>;

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof body.error === "string" ? body.error : response.statusText);
  }
  return response.json() as Promise<T>;
}

export function createApiClient(baseUrl: string) {
  return {
    listWorkspaces: () => request<any[]>(baseUrl, "/workspaces"),
    createWorkspace: (input: { name: string; rootDir: string }) =>
      request<any>(baseUrl, "/workspaces", { method: "POST", body: JSON.stringify(input) }),
    markWorkspaceOpened: (workspaceId: string) =>
      request<{ ok: true }>(baseUrl, `/workspaces/${workspaceId}/open`, { method: "PATCH" }),
    listSessions: (workspaceId: string) => request<any[]>(baseUrl, `/workspaces/${workspaceId}/sessions`),
    createSession: (input: { workspaceId: string; title: string; origin?: string }) =>
      request<any>(baseUrl, "/sessions", { method: "POST", body: JSON.stringify(input) }),
    listMessages: (sessionId: string) => request<any[]>(baseUrl, `/sessions/${sessionId}/messages`),
    createMessage: (sessionId: string, input: { role: string; content: string }) =>
      request<any>(baseUrl, `/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify(input) }),
    startQuickChat: () => request<any>(baseUrl, "/quick-chat", { method: "POST" })
  };
}
```

- [ ] **步骤 4：暴露选择 workspace 目录的 preload API**

在 `apps/desktop/electron/main.ts` 顶部把 Electron import 改成：

```ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
```

在现有 IPC handle 旁边追加：

```ts
ipcMain.handle("pick-workspace-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
```

在 `apps/desktop/electron/preload.ts` 暴露方法：

```ts
contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: () => ipcRenderer.invoke("get-pi-server-status") as Promise<PiServerStatus>,
  restartPiServer: () => ipcRenderer.invoke("restart-pi-server") as Promise<PiServerStatus>,
  pickWorkspaceDirectory: () => ipcRenderer.invoke("pick-workspace-directory") as Promise<string | null>,
  onPiServerStatus: (callback: (status: PiServerStatus) => void) => {
    const listener = (_event: unknown, status: PiServerStatus) => callback(status);
    ipcRenderer.on("pi-server-status", listener);
    return () => ipcRenderer.off("pi-server-status", listener);
  }
});
```

在 `apps/desktop/src/App.tsx` 的 `MarginaliaBridge` type 中加入：

```ts
pickWorkspaceDirectory?: () => Promise<string | null>;
```

- [ ] **步骤 5：实现 workspace shell**

```tsx
// apps/desktop/src/workspaces/WorkspaceShell.tsx
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";

type Workspace = { id: string; name: string; rootDir: string };
type Session = { id: string; workspaceId: string; title: string; origin: string };
type Message = { id: string; sessionId: string; role: string; content: string };

export function WorkspaceShell({
  api,
  pickWorkspaceDirectory
}: {
  api: Pick<ApiClient, "listWorkspaces" | "createWorkspace" | "markWorkspaceOpened" | "listSessions" | "createSession" | "listMessages" | "createMessage" | "startQuickChat">;
  pickWorkspaceDirectory?: () => Promise<string | null>;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [name, setName] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces);
  }, [api]);

  async function openWorkspace(workspace: Workspace) {
    setError("");
    setActiveWorkspace(workspace);
    await api.markWorkspaceOpened(workspace.id);
    setSessions(await api.listSessions(workspace.id));
    setActiveSession(null);
    setMessages([]);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const workspace = await api.createWorkspace({ name, rootDir });
    setWorkspaces((current) => [...current, workspace]);
    setName("");
    setRootDir("");
    await openWorkspace(workspace);
  }

  async function browse() {
    const picked = await pickWorkspaceDirectory?.();
    if (picked) setRootDir(picked);
  }

  async function quickChat() {
    try {
      setError("");
      const session = await api.startQuickChat();
      setActiveSession(session);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setMessages([]);
      setStatus("Quick chat started");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to start Quick chat.");
      // 引导用户去创建 workspace：把焦点放到 name 输入框上
      nameInputRef.current?.focus();
    }
  }

  async function createSession() {
    if (!activeWorkspace) return;
    const session = await api.createSession({ workspaceId: activeWorkspace.id, title: "New session", origin: "desktop" });
    setSessions((current) => [session, ...current]);
    setActiveSession(session);
    setMessages([]);
  }

  async function openSession(session: Session) {
    setActiveSession(session);
    setMessages(await api.listMessages(session.id));
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activeSession || !message.trim()) return;
    const created = await api.createMessage(activeSession.id, { role: "user", content: message.trim() });
    setMessages((current) => [...current, created]);
    setMessage("");
  }

  return (
    <section>
      <aside>
        <button type="button" onClick={quickChat}>Quick chat</button>
        {workspaces.map((workspace) => (
          <button key={workspace.id} type="button" onClick={() => openWorkspace(workspace)}>{workspace.name}</button>
        ))}
      </aside>
      <form onSubmit={create}>
        <label>Workspace name<input ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Workspace path<input value={rootDir} onChange={(event) => setRootDir(event.target.value)} /></label>
        <button type="button" onClick={browse}>Browse</button>
        <button type="submit">Create workspace</button>
      </form>
      {activeWorkspace && (
        <section>
          <button type="button" onClick={createSession}>New session</button>
          {sessions.map((session) => (
            <button key={session.id} type="button" onClick={() => openSession(session)}>{session.title}</button>
          ))}
        </section>
      )}
      {activeSession && (
        <section>
          {messages.map((item) => <p key={item.id}>{item.content}</p>)}
          <form onSubmit={sendMessage}>
            <label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <button type="submit">Send</button>
          </form>
        </section>
      )}
      {error && <p>{error}</p>}
      {status && <p>{status}</p>}
    </section>
  );
}
```

- [ ] **步骤 6：把 shell 接入 ready 状态的 app**

在 `App.tsx` 中，当 `status.state === "ready"` 时创建 `api = createApiClient(status.url)`，并在 ready 文案下方渲染：

```tsx
<WorkspaceShell api={api} pickWorkspaceDirectory={bridge.pickWorkspaceDirectory} />
```

- [ ] **步骤 7：运行测试**

运行：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server test
pnpm typecheck
```

预期：全部通过。

- [ ] **步骤 8：手动验证**

运行：`pnpm dev`

预期：Browse 可选择目录；创建 workspace 后它成为 active workspace；点击 Quick chat 会在最近 workspace 下创建 session；重启 app 后 workspace/session/message 仍然存在。

- [ ] **步骤 9：提交**

```bash
git add apps/desktop apps/pi-server
git commit -m "feat: add workspace and quick chat flow"
```

## 自检

- 规格覆盖：覆盖 SQLite 初始化、migrations、workspace/session/message 表、API、Quick chat 最近 workspace 行为和首启 workspace 创建 UI。
- 占位符扫描：没有开放式错误处理或未来实现表述。
- 类型一致性：`origin` 各处都是 string；Quick chat 使用 `quick_chat`。
