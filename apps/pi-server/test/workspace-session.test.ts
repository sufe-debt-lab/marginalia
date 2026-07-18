import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
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

const dbs: Database.Database[] = [];
const roots: string[] = [];

function memoryDb() {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migrations", () => {
  it("creates workspace session and message tables", () => {
    const db = memoryDb();
    migrate(db);

    const tables = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all();

    expect(tables).toEqual(
      expect.arrayContaining([
        { name: "messages" },
        { name: "schema_migrations" },
        { name: "sessions" },
        { name: "workspaces" }
      ])
    );
    expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
      { version: 1 },
      { version: 2 }
    ]);
  });
});

describe("workspace repositories", () => {
  it("creates workspaces and tracks the most recent workspace", () => {
    const db = memoryDb();
    migrate(db);

    const first = createWorkspace(db, { name: "Alpha", rootDir: "/tmp/alpha" });
    const second = createWorkspace(db, { name: "Beta", rootDir: "/tmp/beta" });

    expect(getRecentWorkspace(db)).toBeNull();

    markWorkspaceOpened(db, first.id);

    expect(listWorkspaces(db).map((workspace) => workspace.name)).toEqual(["Alpha", "Beta"]);
    expect(getRecentWorkspace(db)?.id).toBe(first.id);
    expect(second.rootDir).toBe("/tmp/beta");
  });

  it("persists sessions and messages in a file-backed database", () => {
    const root = mkdtempSync(path.join(tmpdir(), "marginalia-db-"));
    roots.push(root);
    const dbPath = path.join(root, "db.sqlite");
    const db = new Database(dbPath);
    dbs.push(db);
    migrate(db);

    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Read paper",
      origin: "desktop"
    });
    createMessage(db, { sessionId: session.id, role: "user", content: "hello" });
    db.close();
    dbs.pop();

    const reopened = new Database(dbPath);
    dbs.push(reopened);

    expect(listWorkspaces(reopened)).toMatchObject([{ id: workspace.id, name: "Docs" }]);
    expect(listSessions(reopened, workspace.id)).toMatchObject([
      { id: session.id, title: "Read paper" }
    ]);
    expect(getMessages(reopened, session.id)).toMatchObject([{ role: "user", content: "hello" }]);
  });

  it("orders sessions by most recent message activity", () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const first = createSession(db, {
      workspaceId: workspace.id,
      title: "First",
      origin: "desktop"
    });
    const second = createSession(db, {
      workspaceId: workspace.id,
      title: "Second",
      origin: "desktop"
    });

    createMessage(db, { sessionId: second.id, role: "user", content: "second bump" });
    createMessage(db, { sessionId: first.id, role: "user", content: "first bump" });

    expect(listSessions(db, workspace.id).map((session) => session.id)).toEqual([
      first.id,
      second.id
    ]);
  });
});

describe("workspace API", () => {
  it("covers workspace session message and quick chat endpoints", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const workspaceResponse = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Docs", rootDir: "/tmp/docs" })
    });
    const workspace = await workspaceResponse.json();
    expect(workspaceResponse.status).toBe(201);

    expect(await (await app.request("/workspaces")).json()).toMatchObject([
      { id: workspace.id, name: "Docs" }
    ]);
    expect(
      (await app.request(`/workspaces/${workspace.id}/open`, { method: "PATCH" })).status
    ).toBe(200);

    const sessionResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, title: "Read paper" })
    });
    const session = await sessionResponse.json();
    expect(sessionResponse.status).toBe(201);

    await app.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hello" })
    });

    expect(await (await app.request(`/workspaces/${workspace.id}/sessions`)).json()).toMatchObject([
      { id: session.id, title: "Read paper" }
    ]);
    expect(await (await app.request(`/sessions/${session.id}/messages`)).json()).toMatchObject([
      { message: { role: "user", content: "hello" } }
    ]);

    const quick = await app.request("/quick-chat", { method: "POST" });
    expect(quick.status).toBe(201);
    expect(await quick.json()).toMatchObject({ workspaceId: workspace.id, origin: "quick_chat" });
  });

  it("returns 409 for quick chat without a recent workspace", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const response = await app.request("/quick-chat", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "workspace required" });
  });

  it("DELETE /workspaces/:id removes workspace and cascades sessions", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const created = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "to-delete", rootDir: "/tmp/to-delete-pr6" })
    });
    const ws = (await created.json()) as { id: string };

    const sessionResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, title: "doomed" })
    });
    const session = (await sessionResponse.json()) as { id: string };

    await app.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hi" })
    });

    const del = await app.request(`/workspaces/${ws.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const list = await app.request("/workspaces");
    const items = (await list.json()) as { id: string }[];
    expect(items.find((w) => w.id === ws.id)).toBeUndefined();

    expect(
      db.prepare("select count(*) as c from sessions where workspace_id = ?").get(ws.id)
    ).toEqual({ c: 0 });
    expect(
      db.prepare("select count(*) as c from messages where session_id = ?").get(session.id)
    ).toEqual({ c: 0 });
  });

  it("DELETE /workspaces/:id returns 404 for unknown id", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });

    const del = await app.request("/workspaces/no-such-id-pr6", { method: "DELETE" });
    expect(del.status).toBe(404);
  });
});
