import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type Context
} from "@earendil-works/pi-ai";
import { emptyUsage } from "@marginalia/chat-core";
import { AgentSessionRegistry } from "../src/agent/agent-session-registry.js";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import { afterEach, expect, it, vi } from "vitest";
import { createTestApp as createApp } from "./test-app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createApproval,
  createProvider,
  createSession,
  createWorkspace,
  setAgentSessionPath
} from "../src/db/repositories.js";
import type { AgentPrepareInput } from "../src/agent/agent-client.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("reconciles ownerless runs once while retaining terminal records, history and artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-recovery-"));
  roots.push(root);
  const dbPath = path.join(root, "db.sqlite");
  let db = new Database(dbPath);
  databases.push(db);
  migrate(db);
  const workspace = createWorkspace(db, { name: "Recovery", rootDir: root });
  const session = createSession(db, {
    workspaceId: workspace.id,
    title: "Existing",
    origin: "desktop"
  });
  const provider = createProvider(db, { name: "test", apiKey: "fixture", defaultModel: "test" });
  for (const status of ["running", "completed", "failed"]) {
    db.prepare(
      "insert into runs (id, session_id, provider_id, model, status, created_at, completed_at, error) values (?, ?, ?, 'test', ?, 1, ?, ?)"
    ).run(
      status,
      session.id,
      provider.id,
      status,
      status === "running" ? null : 2,
      status === "failed" ? "original failure" : null
    );
  }
  createApproval(db, {
    id: "pending",
    sessionId: session.id,
    runId: "running",
    toolCallId: "old-tool",
    toolName: "edit",
    kind: "file_edit",
    payload: {
      kind: "file_edit",
      path: "note.md",
      mode: "edit",
      patch: "",
      additions: 0,
      deletions: 0,
      exact: true
    }
  });
  const historyPath = path.join(root, "history.jsonl");
  const history =
    [
      {
        type: "session",
        version: 3,
        id: "history",
        cwd: root,
        timestamp: new Date(1).toISOString()
      },
      {
        type: "message",
        id: "user",
        parentId: null,
        timestamp: new Date(2).toISOString(),
        message: { role: "user", content: "saved request", timestamp: 2 }
      }
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n";
  fs.writeFileSync(historyPath, history);
  fs.writeFileSync(path.join(root, "note.md"), "saved artifact");
  setAgentSessionPath(db, session.id, historyPath);
  const terminal = db.prepare("select * from runs where status != 'running' order by id").all();
  db.close();
  db = new Database(dbPath);
  databases.push(db);
  const fake = new FakeAgentClient();
  let nextMessage = "";
  const prepare = vi.fn(async (input: AgentPrepareInput) => {
    const prepared = await fake.prepare(input);
    return {
      ...prepared,
      sessionFile: input.agentSessionPath,
      start(message: string) {
        nextMessage = message;
        return prepared.start(message);
      }
    };
  });
  const app = createApp({
    db,
    agentClient: { prepare, cancelPending: () => 0, resolveApproval: () => false },
    authStorage: AuthStorage.inMemory()
  });
  expect(
    db.prepare("select status, error, completed_at from runs where id = 'running'").get()
  ).toEqual({ status: "failed", error: "run_owner_unavailable", completed_at: expect.any(Number) });
  expect(db.prepare("select status from approvals where id = 'pending'").get()).toEqual({
    status: "expired"
  });
  expect(db.prepare("select * from runs where id != 'running' order by id").all()).toEqual(
    terminal
  );
  const snapshot = db.prepare("select * from runs order by id").all();
  createApp({ db, agentClient: new FakeAgentClient(), authStorage: AuthStorage.inMemory() });
  expect(db.prepare("select * from runs order by id").all()).toEqual(snapshot);
  expect(await (await app.request(`/sessions/${session.id}/messages`)).json()).toEqual([
    { id: "user", message: { role: "user", content: "saved request", timestamp: 2 } }
  ]);
  expect(fs.readFileSync(historyPath, "utf8")).toBe(history);
  expect(fs.readFileSync(path.join(root, "note.md"), "utf8")).toBe("saved artifact");
  expect(prepare).not.toHaveBeenCalled();
  fs.writeFileSync(path.join(root, "note.md"), "user edited after crash");
  const next = await app.request(`/sessions/${session.id}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: provider.id,
      message: "继续",
      contextFiles: ["note.md"],
      permission: "readonly"
    })
  });
  expect(await next.text()).toContain("run_completed");
  expect(prepare).toHaveBeenCalledOnce();
  expect(prepare.mock.calls[0][0]).toMatchObject({
    sessionId: session.id,
    agentSessionPath: historyPath,
    permission: "readonly",
    workspaceRoot: fs.realpathSync(root)
  });
  expect(nextMessage).toContain("user edited after crash");
  expect(nextMessage).not.toContain("saved artifact");
  expect(fs.readFileSync(historyPath, "utf8")).toBe(history);
  expect(db.prepare("select * from runs where id = 'running'").get()).toEqual(
    snapshot.find((row) => (row as { id: string }).id === "running")
  );
  expect(db.prepare("select count(*) as count from runs").get()).toEqual({ count: 4 });
});

it("does not mistake an unrelated live process at a reused PID for the run owner", () => {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const workspace = createWorkspace(db, { name: "PID reuse", rootDir: os.tmpdir() });
  const session = createSession(db, { workspaceId: workspace.id, title: "Old", origin: "desktop" });
  const provider = createProvider(db, { name: "test", apiKey: "fixture", defaultModel: "test" });
  db.prepare(
    "insert into runs (id, session_id, provider_id, model, status, created_at, owner_pid) values ('old', ?, ?, 'test', 'running', 1, ?)"
  ).run(session.id, provider.id, process.pid);
  db.prepare("update runs set owner_started_at = ? where id = 'old'").run(
    "Mon Jan  1 00:00:00 2001"
  );
  // The live PID now belongs to a different process instance.
  createApp({ db, agentClient: new FakeAgentClient(), authStorage: AuthStorage.inMemory() });
  expect(db.prepare("select status, error from runs where id = 'old'").get()).toEqual({
    status: "failed",
    error: "run_owner_unavailable"
  });
});

it("a real pi Session keeps unfinished tool history without replaying it on the next prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-recovery-"));
  roots.push(root);
  const db = new Database(path.join(root, "db.sqlite"));
  databases.push(db);
  migrate(db);
  const workspace = createWorkspace(db, { name: "Recovery", rootDir: root });
  const session = createSession(db, {
    workspaceId: workspace.id,
    title: "Real pi",
    origin: "desktop"
  });
  const provider = createProvider(db, {
    name: "OpenAI",
    apiKey: "fixture-only",
    defaultModel: "gpt-4o"
  });
  fs.writeFileSync(path.join(root, "note.md"), "user version");
  const manager = SessionManager.create(root, path.join(root, "history"));
  manager.appendMessage({ role: "user", content: "previous request", timestamp: 1 });
  const old: AssistantMessage = {
    role: "assistant",
    api: "openai-completions",
    provider: "openai",
    model: "gpt-4o",
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: 2,
    content: [
      {
        type: "toolCall",
        id: "unfinished-write",
        name: "write",
        arguments: { path: "note.md", content: "unwanted replay" }
      }
    ]
  };
  manager.appendMessage(old);
  const history = manager.getSessionFile()!;
  expect(fs.existsSync(history)).toBe(true);
  setAgentSessionPath(db, session.id, history);
  db.prepare(
    "insert into runs (id, session_id, provider_id, model, status, created_at) values ('old', ?, ?, 'gpt-4o', 'running', 1)"
  ).run(session.id, provider.id);
  const auth = AuthStorage.inMemory();
  auth.setRuntimeApiKey("openai", "fixture-only");
  const modelRegistry = ModelRegistry.inMemory(auth);
  const contexts: Context[] = [];
  const registry = new AgentSessionRegistry({
    authStorage: auth,
    modelRegistry,
    createSession: async (config) => {
      const result = await createAgentSession({
        ...config,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false }
        })
      } as Parameters<typeof createAgentSession>[0]);
      result.session.agent.streamFn = (_model, context) => {
        contexts.push({ ...context, messages: structuredClone(context.messages) });
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            ...old,
            content: [{ type: "text", text: "new response" }],
            stopReason: "stop",
            timestamp: 3
          }
        });
        return stream;
      };
      return result;
    }
  });
  const agent = new PiCodingAgentClient(
    registry,
    () => getModel("openai", "gpt-4o"),
    new ApprovalGateway()
  );
  const app = createApp({
    db,
    agentClient: agent,
    authStorage: auth,
    modelRegistry
  });
  try {
    expect(contexts).toHaveLength(0);
    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: provider.id, message: "继续", permission: "full" })
    });
    const events = await response.text();
    expect(events).toContain("run_completed");
    expect(events).not.toContain("tool_execution_start");
    expect(contexts).toHaveLength(1);
    expect(contexts[0].messages).toContainEqual(
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "继续" }] })
    );
    expect(contexts[0].messages).toContainEqual(
      expect.objectContaining({ role: "assistant", content: old.content })
    );
    expect(fs.readFileSync(path.join(root, "note.md"), "utf8")).toBe("user version");
    const reopened = await (await app.request(`/sessions/${session.id}/messages`)).json();
    expect(reopened).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({ role: "assistant", content: old.content })
        }),
        expect.objectContaining({
          message: expect.objectContaining({ content: [{ type: "text", text: "new response" }] })
        })
      ])
    );
  } finally {
    registry.disposeAll();
  }
});
