import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";
import {
  createApproval,
  createRun,
  createSession,
  createWorkspace,
  createProvider,
  decideApproval,
  expirePendingApprovals,
  listApprovals
} from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function seeded() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const ws = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
  const session = createSession(db, { workspaceId: ws.id, title: "S", origin: "desktop" });
  const provider = createProvider(db, { name: "openai", apiKey: "k", defaultModel: "gpt" });
  const run = createRun(db, { sessionId: session.id, providerId: provider.id, model: "gpt" });
  return { db, session, run };
}

describe("approvals repository", () => {
  it("creates, decides and lists approvals with parsed payload", () => {
    const { db, session, run } = seeded();
    createApproval(db, {
      id: "ap-1",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t1",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "python x.py", cwd: "/tmp/w" }
    });
    const decided = decideApproval(db, "ap-1", "denied", "改用只读");
    expect(decided?.status).toBe("denied");
    const rows = listApprovals(db, session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ kind: "command", command: "python x.py", cwd: "/tmp/w" });
    expect(rows[0]?.reason).toBe("改用只读");
  });

  it("expires only pending approvals of the given run", () => {
    const { db, session, run } = seeded();
    createApproval(db, {
      id: "a",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t1",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "x", cwd: "/" }
    });
    createApproval(db, {
      id: "b",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t2",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "y", cwd: "/" }
    });
    decideApproval(db, "a", "approved");
    expect(expirePendingApprovals(db, run.id)).toBe(1);
    const byId = Object.fromEntries(listApprovals(db, session.id).map((r) => [r.id, r.status]));
    expect(byId).toEqual({ a: "approved", b: "expired" });
  });
});
