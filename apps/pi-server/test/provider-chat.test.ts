import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createSession,
  createWorkspace,
  listSessions,
  setAgentSessionPath
} from "../src/db/repositories.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, AgentSessionEvent } from "../src/agent/agent-client.js";

const dbs: Database.Database[] = [];
const capability = { token: "test-token", allowedOrigins: new Set<string>() };
const runHeaders = {
  authorization: "Bearer test-token",
  "content-type": "application/json"
};
function memoryDb() {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
}

function preparedRun(events: AgentRunEvent[], sessionFile = "/tmp/test.jsonl") {
  return {
    sessionFile,
    start() {
      return {
        events: (async function* () {
          yield* events;
        })(),
        abort() {},
        settled: Promise.resolve()
      };
    }
  };
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("provider chat migrations", () => {
  it("creates provider env var and run tables and agent_session_path column", () => {
    const db = memoryDb();
    migrate(db);

    const names = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row: any) => row.name);

    expect(names).toContain("providers");
    expect(names).toContain("env_vars");
    expect(names).toContain("runs");

    const sessionColumns = db
      .prepare("pragma table_info(sessions)")
      .all()
      .map((row: any) => row.name);
    expect(sessionColumns).toContain("model");
    expect(sessionColumns).toContain("agent_session_path");
  });

  it("persists session model selection", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop"
    });

    const app = createApp({ db });
    const response = await app.request(`/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ model: "gpt-4.1" }),
      headers: { "content-type": "application/json" }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: session.id, model: "gpt-4.1" });
    expect(listSessions(db, workspace.id)[0]?.model).toBe("gpt-4.1");
  });
});

describe("provider API", () => {
  it("returns provider availability via injected checker", async () => {
    const db = memoryDb();
    migrate(db);
    const availabilityChecker = {
      check({ piProviderId }: { piProviderId: string }) {
        return {
          ok: piProviderId === "minimax-cn",
          message: piProviderId === "minimax-cn" ? "ok" : "missing"
        };
      }
    } as any;
    const app = createApp({ db, availabilityChecker });

    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const res = await app.request(`/providers/${provider.id}/test`, { method: "POST" });
    expect(await res.json()).toEqual({ ok: true, message: "ok" });
  });
});

describe("chat runs", () => {
  it("streams run envelopes via real SSE and emits assistant text", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-run" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop",
      model: "MiniMax-M2.7"
    });

    const fake = new FakeAgentClient();
    fake.enqueueEvents([
      { type: "agent_start" } as unknown as AgentSessionEvent,
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hel" }
      } as unknown as AgentSessionEvent,
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "lo" }
      } as unknown as AgentSessionEvent,
      {
        type: "message_end",
        message: { stopReason: "end", content: "hello" }
      } as unknown as AgentSessionEvent
    ]);

    const app = createApp({ db, agentClient: fake, capability });
    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId: provider.id, message: "hi" })
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"type":"run_started"');
    // Single source of truth: only the raw agent_event stream carries content.
    expect(text).toContain('"type":"agent_event"');
    expect(text).toContain('"delta":"hel"');
    expect(text).toContain('"delta":"lo"');
    expect(text).not.toContain('"type":"assistant_delta"');
    expect(text).toContain('"type":"run_completed"');
  });

  it("forwards pi tool-execution events only as raw agent_event SSE", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-tool" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop",
      model: "MiniMax-M2.7"
    });

    const fake = new FakeAgentClient();
    fake.enqueueEvents([
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { path: "docs/spec.md" }
      } as unknown as AgentSessionEvent,
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read",
        result: {},
        isError: false
      } as unknown as AgentSessionEvent,
      {
        type: "message_end",
        message: { stopReason: "end", content: "done" }
      } as unknown as AgentSessionEvent
    ]);

    const app = createApp({ db, agentClient: fake, capability });
    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId: provider.id, message: "read it" })
    });
    const text = await response.text();
    expect(text).toContain('"type":"agent_event"');
    expect(text).toContain('"tool_execution_start"');
    expect(text).toContain('"toolName":"read"');
    expect(text).toContain('"path":"docs/spec.md"');
    expect(text).toContain('"tool_execution_end"');
    expect(text).not.toContain('"type":"tool_started"');
  });

  it("aborts an execution when the request aborts during start", async () => {
    let abortCalls = 0;
    const controller = new AbortController();
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-abort" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop"
    });
    const stubClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/abort.jsonl",
          start() {
            controller.abort();
            return {
              events: (async function* () {})(),
              abort() {
                abortCalls += 1;
              },
              settled: Promise.resolve()
            };
          }
        };
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient: stubClient, capability });
    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId: provider.id, message: "stop" }),
      signal: controller.signal
    });
    await response.text();

    expect(abortCalls).toBe(1);
  });

  it("passes run configuration to prepare and the message to start", async () => {
    let seen: any = null;
    let startedMessage: string | null = null;
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-pi" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop"
    });

    const stubClient = {
      async prepare(input: any) {
        seen = input;
        const prepared = preparedRun([
          { type: "message_end", message: { stopReason: "end", content: "ok" } } as any
        ]);
        return {
          ...prepared,
          start(message: string) {
            startedMessage = message;
            return prepared.start();
          }
        };
      }
    };

    const app = createApp({ db, agentClient: stubClient as any, capability });
    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId: provider.id, message: "ping" })
    });
    await response.text(); // drain stream so the streamSSE callback runs to completion

    expect(seen).toMatchObject({
      sessionId: session.id,
      workspaceRoot: "/tmp/docs-pi",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7"
    });
    expect(startedMessage).toBe("ping");
  });

  it("includes selected context file contents in the agent message", async () => {
    let startedMessage = "";
    const db = memoryDb();
    migrate(db);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-context-"));
    fs.writeFileSync(path.join(root, "note.md"), "# Note\nattached context");
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop"
    });

    const stubClient = {
      async prepare() {
        const prepared = preparedRun([
          { type: "message_end", message: { stopReason: "end", content: "ok" } } as any
        ]);
        return {
          ...prepared,
          start(message: string) {
            startedMessage = message;
            return prepared.start();
          }
        };
      }
    };

    const app = createApp({ db, agentClient: stubClient as any, capability });
    const provider = await (
      await app.request("/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
      })
    ).json();

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({
        providerId: provider.id,
        message: "summarize",
        contextFiles: ["note.md"]
      })
    });
    await response.text();

    expect(startedMessage).toContain("summarize");
    expect(startedMessage).toContain('<attached_file path="note.md"');
    expect(startedMessage).toContain("# Note\nattached context");
  });

  it("serves messages from the pi session file when present", async () => {
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-msg" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "Chat",
      origin: "desktop"
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-msg-"));
    const sessionFile = path.join(tmpDir, "s.jsonl");
    fs.writeFileSync(
      sessionFile,
      [
        {
          type: "session",
          version: 3,
          id: "abc",
          cwd: "/tmp",
          timestamp: "2026-05-26T00:00:00.000Z"
        },
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-05-26T00:00:01.000Z",
          message: { role: "user", content: "hi", timestamp: 1748390401000 }
        },
        {
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-05-26T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "yo" }],
            api: "anthropic-messages",
            provider: "minimax-cn",
            model: "MiniMax-M2.7",
            stopReason: "stop",
            timestamp: 1748390402000
          }
        }
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n"
    );
    setAgentSessionPath(db, session.id, sessionFile);

    const app = createApp({ db });
    const response = await app.request(`/sessions/${session.id}/messages`);
    expect(await response.json()).toEqual([
      { id: "u1", message: { role: "user", content: "hi", timestamp: 1748390401000 } },
      {
        id: "a1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "yo" }],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
          stopReason: "stop",
          timestamp: 1748390402000
        }
      }
    ]);
  });
});
