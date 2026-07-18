import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createProvider,
  createSession,
  createWorkspace,
  listSessions,
  setAgentSessionPath
} from "../src/db/repositories.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, AgentSessionEvent } from "../src/agent/agent-client.js";
import type {
  SkillCandidate,
  SkillCatalogService,
  SkillCatalogSnapshot
} from "../src/skills/types.js";

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runCount(db: Database.Database) {
  return (db.prepare("select count(*) as count from runs").get() as { count: number }).count;
}

function runStatuses(db: Database.Database) {
  return db
    .prepare("select status from runs order by created_at")
    .all()
    .map((row) => (row as { status: string }).status);
}

function catalogSnapshot(overrides: Partial<SkillCatalogSnapshot> = {}): SkillCatalogSnapshot {
  return {
    workspaceId: null,
    workspaceRoot: null,
    catalogRevision: "catalog-1",
    effectiveRevision: "effective-1",
    refreshedAt: 1,
    candidates: [],
    effectiveSkills: [],
    diagnostics: [],
    ...overrides
  };
}

function fixedCatalog(
  current: SkillCatalogSnapshot = catalogSnapshot()
): SkillCatalogService & { refresh: ReturnType<typeof vi.fn> } {
  return {
    refresh: vi.fn(async () => current),
    current: vi.fn(() => current),
    setEnabled: vi.fn(async () => current)
  };
}

function setupRun(rootDir = "/tmp/docs-run-transaction") {
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir });
  const session = createSession(db, {
    workspaceId: workspace.id,
    title: "Chat",
    origin: "desktop"
  });
  const provider = createProvider(db, {
    name: "Minimax",
    apiKey: "sk-test",
    defaultModel: "MiniMax-M2.7"
  });
  return { db, workspace, session, providerId: provider.id };
}

function runRequest(
  app: ReturnType<typeof createApp>,
  sessionId: string,
  providerId: string,
  input: Record<string, unknown> = {}
) {
  return app.request(`/sessions/${sessionId}/runs`, {
    method: "POST",
    headers: runHeaders,
    body: JSON.stringify({ providerId, message: "hello", ...input })
  });
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("provider chat migrations", () => {
  it("creates the current schema and records every migration", () => {
    const db = memoryDb();
    migrate(db);

    const names = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row: any) => row.name);

    expect(names).toContain("providers");
    expect(names).toContain("env_vars");
    expect(names).toContain("runs");
    expect(names).toContain("skill_preferences");

    expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
      { version: 1 },
      { version: 2 }
    ]);

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
  it("rejects an overlapping run for the same session until execution settles", async () => {
    const { db, session, providerId } = setupRun();
    const settled = deferred();
    let starts = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/lease.jsonl",
          start() {
            starts += 1;
            return {
              events: (async function* () {})(),
              abort() {},
              settled: settled.promise
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
    const skillCatalog = fixedCatalog();
    const app = createApp({ db, agentClient, capability, skillCatalog });

    const first = await runRequest(app, session.id, providerId);
    const firstBody = first.text();
    await vi.waitFor(() => expect(starts).toBe(1));

    const overlap = await runRequest(app, session.id, providerId);
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toEqual({ error: "session_busy" });
    expect(runCount(db)).toBe(1);
    expect(skillCatalog.refresh).toHaveBeenCalledTimes(1);

    settled.resolve();
    await firstBody;

    const next = await runRequest(app, session.id, providerId);
    settled.resolve();
    await next.text();
    expect(next.status).toBe(200);
    expect(runCount(db)).toBe(2);
  });

  it("refreshes skills and pins the runtime even when the run selects zero skills", async () => {
    const { db, workspace, session, providerId } = setupRun();
    const skillCatalog = fixedCatalog(
      catalogSnapshot({ workspaceId: workspace.id, workspaceRoot: workspace.rootDir })
    );
    let preparedInput: any;
    const agentClient = {
      async prepare(input: any) {
        preparedInput = input;
        return preparedRun([]);
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability, skillCatalog });

    const response = await runRequest(app, session.id, providerId, { skills: [] });
    await response.text();

    expect(response.status).toBe(200);
    expect(skillCatalog.refresh).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootDir
    });
    expect(preparedInput.runtimeSkills).toEqual({
      effectiveRevision: "effective-1",
      loadResult: { skills: [], diagnostics: [] }
    });
    expect(runCount(db)).toBe(1);
  });

  it("returns skill 409/413 failures before prepare and before creating a run", async () => {
    const { db, session, providerId } = setupRun();
    const skillCatalog = fixedCatalog();
    const prepare = vi.fn(async () => preparedRun([]));
    const agentClient = {
      prepare,
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability, skillCatalog });

    const invalid = await runRequest(app, session.id, providerId, {
      skills: [{ name: "missing", path: "/tmp/missing/SKILL.md" }]
    });
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toEqual({
      error: "skill_precondition_failed",
      catalogRevision: "catalog-1",
      invalidSelections: [{ name: "missing", path: "/tmp/missing/SKILL.md", reason: "missing" }]
    });

    const tooMany = await runRequest(app, session.id, providerId, {
      skills: Array.from({ length: 17 }, () => ({
        name: "duplicate",
        path: "/tmp/duplicate/SKILL.md"
      }))
    });
    expect(tooMany.status).toBe(413);
    expect(await tooMany.json()).toEqual({ error: "skill_payload_too_large" });
    expect(prepare).not.toHaveBeenCalled();
    expect(runCount(db)).toBe(0);
  });

  it("includes the current winner path for a shadowed Skill 409", async () => {
    const { db, session, providerId } = setupRun();
    const loserPath = "/tmp/loser/SKILL.md";
    const winnerPath = "/tmp/winner/SKILL.md";
    const shadowed = {
      discoveredPath: loserPath,
      sourceRoot: "/tmp",
      relativePath: "loser/SKILL.md",
      source: "workspace_marginalia",
      scope: "workspace",
      mode: "pi",
      sourcePriority: 0,
      ancestorDepth: 0,
      canonicalPath: loserPath,
      canonicalBaseDir: "/tmp/loser",
      skill: {
        name: "duplicate",
        description: "duplicate description",
        filePath: loserPath,
        baseDir: "/tmp/loser",
        sourceInfo: {
          path: loserPath,
          source: "local",
          scope: "project",
          origin: "test"
        },
        disableModelInvocation: false
      },
      diagnostics: [],
      bytesTotal: 4,
      contentHash: "loser-hash",
      explicitEligible: true,
      explicitOnly: false,
      rawContent: "Body",
      previewContent: "Body",
      previewTruncated: false,
      enabled: true,
      effective: false,
      status: "shadowed",
      shadowedBy: winnerPath
    } satisfies SkillCandidate;
    const prepare = vi.fn(async () => preparedRun([]));
    const app = createApp({
      db,
      capability,
      skillCatalog: fixedCatalog(catalogSnapshot({ candidates: [shadowed] })),
      agentClient: {
        prepare,
        resolveApproval: () => false,
        cancelPending: () => 0
      }
    });

    const response = await runRequest(app, session.id, providerId, {
      skills: [{ name: "duplicate", path: loserPath }]
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "skill_precondition_failed",
      catalogRevision: "catalog-1",
      invalidSelections: [{ name: "duplicate", path: loserPath, reason: "shadowed", winnerPath }]
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(runCount(db)).toBe(0);
  });

  it("rejects oversized Skill fields before preparation or run creation", async () => {
    const { db, session, providerId } = setupRun();
    const skillCatalog = fixedCatalog();
    const prepare = vi.fn(async () => preparedRun([]));
    const agentClient = {
      prepare,
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability, skillCatalog });

    for (const selection of [
      { name: "n".repeat(16 * 1024 + 1), path: "/tmp/name/SKILL.md" },
      { name: "path", path: `/tmp/${"p".repeat(16 * 1024)}é` }
    ]) {
      const response = await runRequest(app, session.id, providerId, { skills: [selection] });
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "skill_payload_too_large" });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(runCount(db)).toBe(0);
  });

  it("caps declared and streamed run bodies after authorization and before JSON decode", async () => {
    const { db, session } = setupRun();
    const prepare = vi.fn(async () => preparedRun([]));
    const agentClient = {
      prepare,
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability, skillCatalog: fixedCatalog() });

    const declared = await app.request(
      new Request(`http://localhost/sessions/${session.id}/runs`, {
        method: "POST",
        headers: { ...runHeaders, "content-length": String(4 * 1024 * 1024 + 1) },
        body: "{}"
      })
    );
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "skill_payload_too_large" });

    const encoder = new TextEncoder();
    const streamedRequest = new Request(`http://localhost/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: new ReadableStream({
        start(controller) {
          const chunk = encoder.encode("x".repeat(1024 * 1024));
          for (let index = 0; index < 5; index += 1) controller.enqueue(chunk);
          controller.close();
        }
      }),
      duplex: "half"
    } as RequestInit & { duplex: "half" });
    const streamed = await app.request(streamedRequest);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: "skill_payload_too_large" });

    const unauthorized = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(4 * 1024 * 1024 + 1)
      },
      body: "{}"
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(prepare).not.toHaveBeenCalled();
    expect(runCount(db)).toBe(0);
  });

  it("leaves no run when catalog refresh or request body processing fails", async () => {
    const { db, session, providerId } = setupRun();
    const prepare = vi.fn(async () => preparedRun([]));
    const agentClient = {
      prepare,
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const refresh = vi
      .fn<SkillCatalogService["refresh"]>()
      .mockRejectedValueOnce(
        new Error("refresh failed at /private/skills/secret/SKILL.md (8192 bytes)")
      )
      .mockResolvedValue(catalogSnapshot());
    const skillCatalog: SkillCatalogService = {
      refresh,
      current: () => null,
      setEnabled: async () => catalogSnapshot()
    };
    const app = createApp({ db, agentClient, capability, skillCatalog });

    const refreshFailure = await runRequest(app, session.id, providerId);
    expect(refreshFailure.status).toBe(500);
    const refreshFailureBody = await refreshFailure.text();
    expect(JSON.parse(refreshFailureBody)).toEqual({ error: "run_preparation_failed" });
    expect(refreshFailureBody).not.toContain("/private/skills/secret/SKILL.md");
    expect(refreshFailureBody).not.toContain("8192");
    expect(runCount(db)).toBe(0);
    expect(prepare).not.toHaveBeenCalled();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const badBody = await app.request(`/sessions/${session.id}/runs`, {
        method: "POST",
        headers: runHeaders,
        body: "{"
      });
      expect(badBody.status).toBe(500);
      expect(runCount(db)).toBe(0);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }

    const retry = await runRequest(app, session.id, providerId);
    await retry.text();
    expect(retry.status).toBe(200);
    expect(runCount(db)).toBe(1);
  });

  it("aborts on disconnect but keeps the session busy until execution settles", async () => {
    const { db, session, providerId } = setupRun();
    const settled = deferred();
    const controller = new AbortController();
    let abortCalls = 0;
    let cancelPendingCalls = 0;
    let starts = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/disconnect.jsonl",
          start() {
            starts += 1;
            return {
              events: (async function* () {
                await settled.promise;
              })(),
              abort() {
                abortCalls += 1;
              },
              settled: settled.promise
            };
          }
        };
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        cancelPendingCalls += 1;
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability });
    const first = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId, message: "hello" }),
      signal: controller.signal
    });
    const firstBody = first.text().catch(() => "");
    await vi.waitFor(() => expect(starts).toBe(1));

    controller.abort();
    await vi.waitFor(() => expect(abortCalls).toBeGreaterThan(0));
    expect(cancelPendingCalls).toBe(1);
    const overlap = await runRequest(app, session.id, providerId);
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toEqual({ error: "session_busy" });

    settled.resolve();
    await firstBody;
    const next = await runRequest(app, session.id, providerId);
    await next.text();
    expect(next.status).toBe(200);
  });

  it("observes disconnects after events end while execution is still settling", async () => {
    const { db, session, providerId } = setupRun();
    const eventsEnded = deferred();
    const settled = deferred();
    const controller = new AbortController();
    let abortCalls = 0;
    let cancelPendingCalls = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/settlement-window.jsonl",
          start() {
            return {
              events: (async function* () {
                eventsEnded.resolve();
              })(),
              abort() {
                abortCalls += 1;
              },
              settled: settled.promise
            };
          }
        };
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        cancelPendingCalls += 1;
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability });

    const first = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: runHeaders,
      body: JSON.stringify({ providerId, message: "hello" }),
      signal: controller.signal
    });
    const firstBody = first.text().catch(() => "");
    await eventsEnded.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();
    expect(abortCalls).toBe(1);
    expect(cancelPendingCalls).toBe(1);

    const overlap = await runRequest(app, session.id, providerId);
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toEqual({ error: "session_busy" });

    settled.resolve();
    await firstBody;
    const retry = await runRequest(app, session.id, providerId);
    expect(retry.status).toBe(200);
    await retry.text();
  });

  it("fails the run and retains the lease until settlement when events throw", async () => {
    const { db, session, providerId } = setupRun();
    const settled = deferred();
    let abortCalls = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/event-failure.jsonl",
          start() {
            return {
              events: (async function* () {
                throw new Error("events failed");
              })(),
              abort() {
                abortCalls += 1;
              },
              settled: settled.promise
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
    const app = createApp({ db, agentClient, capability });

    const first = await runRequest(app, session.id, providerId);
    const firstBody = first.text();
    await vi.waitFor(() => expect(abortCalls).toBe(1));
    expect(runStatuses(db)).toEqual(["running"]);

    const overlap = await runRequest(app, session.id, providerId);
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toEqual({ error: "session_busy" });

    settled.resolve();
    expect(await firstBody).toContain('"type":"run_failed"');
    expect(abortCalls).toBe(1);
    expect(runStatuses(db)).toEqual(["failed"]);

    const retry = await runRequest(app, session.id, providerId);
    expect(retry.status).toBe(200);
    await retry.text();
  });

  it("allows different sessions to run concurrently", async () => {
    const { db, workspace, session, providerId } = setupRun();
    const other = createSession(db, {
      workspaceId: workspace.id,
      title: "Other",
      origin: "desktop"
    });
    const settled = deferred();
    let starts = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/concurrent.jsonl",
          start() {
            starts += 1;
            return {
              events: (async function* () {})(),
              abort() {},
              settled: settled.promise
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
    const app = createApp({ db, agentClient, capability });

    const first = await runRequest(app, session.id, providerId);
    const firstBody = first.text();
    const second = await runRequest(app, other.id, providerId);
    const secondBody = second.text();
    await vi.waitFor(() => expect(starts).toBe(2));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(runCount(db)).toBe(2);
    settled.resolve();
    await Promise.all([firstBody, secondBody]);
  });

  it("does not create a run and releases the lease when message building fails", async () => {
    const { db, session, providerId } = setupRun();
    const agentClient = {
      async prepare() {
        return preparedRun([]);
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability });

    const failed = await runRequest(app, session.id, providerId, { contextFiles: 42 });
    expect(failed.status).toBe(500);
    expect(runCount(db)).toBe(0);

    const retry = await runRequest(app, session.id, providerId);
    await retry.text();
    expect(retry.status).toBe(200);
    expect(runCount(db)).toBe(1);
  });

  it("does not create a run and releases the lease when prepare fails", async () => {
    const { db, session, providerId } = setupRun();
    let shouldFail = true;
    const start = vi.fn(() => preparedRun([]).start());
    const agentClient = {
      async prepare() {
        if (shouldFail) {
          throw new Error("prepare failed at /private/sessions/secret.jsonl (4096 bytes)");
        }
        return { sessionFile: "/tmp/retry.jsonl", start };
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability });

    const failed = await runRequest(app, session.id, providerId);
    expect(failed.status).toBe(500);
    const failureBody = await failed.text();
    expect(JSON.parse(failureBody)).toEqual({ error: "run_preparation_failed" });
    expect(failureBody).not.toContain("/private/sessions/secret.jsonl");
    expect(failureBody).not.toContain("4096");
    expect(runCount(db)).toBe(0);
    expect(start).not.toHaveBeenCalled();

    shouldFail = false;
    const retry = await runRequest(app, session.id, providerId);
    await retry.text();
    expect(retry.status).toBe(200);
    expect(runCount(db)).toBe(1);
    expect(start).toHaveBeenCalledOnce();
  });

  it("does not retain a run or lease when run creation fails", async () => {
    const { db, session, providerId } = setupRun();
    const agentClient = {
      async prepare() {
        return preparedRun([]);
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
      }
    };
    const app = createApp({ db, agentClient, capability });
    db.exec(
      "create trigger reject_run before insert on runs begin select raise(abort, 'create run failed'); end"
    );

    const failed = await runRequest(app, session.id, providerId);
    expect(failed.status).toBe(500);
    expect(runCount(db)).toBe(0);

    db.exec("drop trigger reject_run");
    const retry = await runRequest(app, session.id, providerId);
    await retry.text();
    expect(retry.status).toBe(200);
    expect(runCount(db)).toBe(1);
  });

  it("marks a created run failed when start throws", async () => {
    const { db, session, providerId } = setupRun();
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/start-failure.jsonl",
          start() {
            throw new Error("start failed");
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
    const app = createApp({ db, agentClient: agentClient as any, capability });

    const response = await runRequest(app, session.id, providerId);
    expect(await response.text()).toContain('"type":"run_failed"');
    expect(runStatuses(db)).toEqual(["failed"]);
  });

  it("does not abort an execution after normal event completion", async () => {
    const { db, session, providerId } = setupRun();
    let abortCalls = 0;
    const agentClient = {
      async prepare() {
        return {
          sessionFile: "/tmp/normal.jsonl",
          start() {
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
    const app = createApp({ db, agentClient, capability });

    const response = await runRequest(app, session.id, providerId);
    await response.text();

    expect(abortCalls).toBe(0);
    expect(runStatuses(db)).toEqual(["completed"]);
  });

  it("releases the session lease when final approval cleanup throws", async () => {
    const { db, session, providerId } = setupRun();
    const agentClient = {
      async prepare() {
        return preparedRun([]);
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        throw new Error("cleanup failed");
      }
    };
    const app = createApp({ db, agentClient, capability });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const first = await runRequest(app, session.id, providerId);
      await first.text().catch(() => "");

      const retry = await runRequest(app, session.id, providerId);
      expect(retry.status).toBe(200);
      await retry.text().catch(() => "");
      expect(runCount(db)).toBe(2);
    } finally {
      consoleError.mockRestore();
    }
  });

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
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
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
      },
      resolveApproval() {
        return false;
      },
      cancelPending() {
        return 0;
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
