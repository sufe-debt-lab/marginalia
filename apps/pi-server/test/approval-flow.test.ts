import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createProvider,
  createSession,
  createWorkspace,
  listApprovals
} from "../src/db/repositories.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, ApprovalRequestedEvent } from "../src/agent/agent-client.js";

const dbs: Database.Database[] = [];
const runHeaders = {
  authorization: "Bearer test-token",
  "content-type": "application/json"
};
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const ws = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
  const session = createSession(db, { workspaceId: ws.id, title: "S", origin: "desktop" });
  const provider = createProvider(db, { name: "openai", apiKey: "k", defaultModel: "gpt" });
  const fake = new FakeAgentClient();
  const app = createApp({
    db,
    agentClient: fake,
    capability: { token: "test-token", allowedOrigins: new Set<string>() }
  });
  return { db, session, provider, fake, app };
}

function approvalEvent(sessionId: string): ApprovalRequestedEvent {
  return {
    type: "approval_requested",
    approvalId: "ap-1",
    sessionId,
    toolCallId: "t1",
    toolName: "bash",
    payload: { kind: "command", command: "python x.py", cwd: "/tmp/w" }
  };
}

async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line)
        yield JSON.parse(line.slice("data: ".length)) as {
          type: string;
          payload?: Record<string, unknown>;
        };
    }
  }
}

describe("approval flow over SSE", () => {
  it("emits approval envelopes, persists rows, and resumes after the decision", async () => {
    const { db, session, provider, fake, app } = setup();
    fake.enqueueEvents([approvalEvent(session.id) as AgentRunEvent]);

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, message: "hi", permission: "ask" }),
      headers: runHeaders
    });
    expect(response.status).toBe(200);
    const events = readSse(response.body!);

    const seen: string[] = [];
    for await (const event of events) {
      seen.push(event.type);
      if (event.type === "approval_requested") {
        expect(listApprovals(db, session.id)[0]?.status).toBe("pending");
        const decide = await app.request(`/sessions/${session.id}/approvals/ap-1`, {
          method: "POST",
          body: JSON.stringify({ approved: true }),
          headers: { "content-type": "application/json" }
        });
        expect(decide.status).toBe(200);
      }
      if (event.type === "run_completed") break;
    }
    expect(seen).toEqual([
      "run_started",
      "approval_requested",
      "approval_resolved",
      "run_completed"
    ]);
    expect(listApprovals(db, session.id)[0]?.status).toBe("approved");
  });

  it("returns 404 for unknown approval ids", async () => {
    const { session, app } = setup();
    const res = await app.request(`/sessions/${session.id}/approvals/nope`, {
      method: "POST",
      body: JSON.stringify({ approved: true }),
      headers: { "content-type": "application/json" }
    });
    expect(res.status).toBe(404);
  });

  it("expires pending approvals and releases the run lease when the client disconnects", async () => {
    const { db, session, provider, fake, app } = setup();
    fake.enqueueEvents([approvalEvent(session.id) as AgentRunEvent]);
    const controller = new AbortController();
    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, message: "hi", permission: "ask" }),
      headers: runHeaders,
      signal: controller.signal
    });
    const events = readSse(response.body!);
    for await (const event of events) {
      if (event.type === "approval_requested") {
        controller.abort();
        break;
      }
    }
    // Give the abort handler a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(listApprovals(db, session.id)[0]?.status).toBe("expired");

    const retry = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, message: "retry" }),
      headers: runHeaders
    });
    expect(retry.status).toBe(200);
    await retry.text();
  });

  it("lists persisted approvals for reopen", async () => {
    const { db, session, app } = setup();
    const { createApproval, decideApproval } = await import("../src/db/repositories.js");
    createApproval(db, {
      id: "x",
      sessionId: session.id,
      runId: "r",
      toolCallId: "t",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "x", cwd: "/" }
    });
    decideApproval(db, "x", "denied", "no");
    const res = await app.request(`/sessions/${session.id}/approvals`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([{ id: "x", status: "denied", reason: "no" }]);
  });
});
