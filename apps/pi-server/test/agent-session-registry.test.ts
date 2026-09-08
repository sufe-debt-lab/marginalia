import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionRegistry } from "../src/agent/agent-session-registry.js";

function fakeSession(tag: string) {
  return {
    tag,
    sessionFile: `/tmp/${tag}.jsonl`,
    disposed: false,
    subscribe: vi.fn(() => () => {}),
    prompt: vi.fn(async () => {}),
    dispose() {
      this.disposed = true;
    }
  };
}

function deps() {
  const built: string[] = [];
  const createSession = vi.fn(async () => {
    const tag = `s-${built.length}`;
    built.push(tag);
    return { session: fakeSession(tag) as any };
  });
  return {
    built,
    factoryDeps: {
      authStorage: { setRuntimeApiKey: vi.fn() } as any,
      modelRegistry: {} as any,
      createSession,
      sessionManagerFor: vi.fn(() => undefined as any)
    }
  };
}

describe("AgentSessionRegistry", () => {
  it("rebuilds only when resourceRevision changes and preserves the agent session path", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    const first = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: "/tmp/persisted.jsonl",
      resourceRevision: "rev-1"
    });
    const cached = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: "/tmp/persisted.jsonl",
      resourceRevision: "rev-1"
    });
    const rebuilt = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: "/tmp/persisted.jsonl",
      resourceRevision: "rev-2"
    });

    expect(cached.session).toBe(first.session);
    expect(rebuilt.session).not.toBe(first.session);
    expect((first.session as any).disposed).toBe(true);
    expect(built).toEqual(["s-0", "s-1"]);
    expect(factoryDeps.sessionManagerFor).toHaveBeenCalledTimes(2);
    expect(factoryDeps.sessionManagerFor).toHaveBeenLastCalledWith("/tmp", "/tmp/persisted.jsonl");
    expect(first.resourceRevision).toBe("rev-1");
    expect(rebuilt.resourceRevision).toBe("rev-2");
  });

  it("returns cached session for repeated sessionId", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    const a = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    const b = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });

    expect(a.session).toBe(b.session);
    expect(built).toEqual(["s-0"]);
  });

  it("rebuilds a cached session when the canonical workspace root changes", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    const first = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/workspace/target-a",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    const rebuilt = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/workspace/target-b",
      agentSessionPath: null,
      resourceRevision: "rev"
    });

    expect(rebuilt.session).not.toBe(first.session);
    expect((first.session as any).disposed).toBe(true);
    expect(built).toEqual(["s-0", "s-1"]);
    expect(factoryDeps.sessionManagerFor).toHaveBeenLastCalledWith("/workspace/target-b", null);
  });

  it("overrides a reopened Pi session header with the current canonical workspace root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "marginalia-session-root-"));
    const oldWorkspaceRoot = path.join(root, "target-a");
    const newWorkspaceRoot = path.join(root, "target-b");
    const sessionFile = path.join(root, "session.jsonl");
    mkdirSync(oldWorkspaceRoot);
    mkdirSync(newWorkspaceRoot);
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "persisted-session",
        timestamp: new Date(0).toISOString(),
        cwd: oldWorkspaceRoot
      })}\n`
    );
    let reopenedCwd: string | undefined;
    const reg = new AgentSessionRegistry({
      authStorage: {} as any,
      modelRegistry: {} as any,
      createSession: vi.fn(async (options) => {
        reopenedCwd = options.sessionManager?.getCwd();
        return { session: fakeSession("reopened") as any };
      })
    });

    try {
      await reg.acquire({
        sessionId: "s1",
        workspaceRoot: newWorkspaceRoot,
        agentSessionPath: sessionFile,
        resourceRevision: "rev"
      });

      expect(reopenedCwd).toBe(newWorkspaceRoot);
    } finally {
      reg.disposeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("evicts least-recently-used when capacity exceeded", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    const beforeEvict = await reg.acquire({
      sessionId: "s2",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    }); // touch s1
    await reg.acquire({
      sessionId: "s3",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    }); // pushes out s2

    expect(built).toEqual(["s-0", "s-1", "s-2"]);
    expect((beforeEvict.session as any).disposed).toBe(true);
  });

  it("does not evict an active session until its run releases the pin", async () => {
    const { factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 1 });

    const first = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    const release = first.pin();
    const second = await reg.acquire({
      sessionId: "s2",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });

    expect((first.session as any).disposed).toBe(false);
    expect((second.session as any).disposed).toBe(false);

    release();

    expect((first.session as any).disposed).toBe(true);
    expect((second.session as any).disposed).toBe(false);
  });

  it("atomically reserves sessions whose concurrent creation completes together", async () => {
    const created = [fakeSession("first"), fakeSession("second")];
    const resolvers: Array<(value: { session: any }) => void> = [];
    const createSession = vi.fn(
      () =>
        new Promise<{ session: any }>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const reg = new AgentSessionRegistry({
      authStorage: {} as any,
      modelRegistry: {} as any,
      createSession,
      sessionManagerFor: vi.fn(() => undefined as any),
      maxEntries: 1
    });
    const input = (sessionId: string) => ({
      sessionId,
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });

    const firstPending = reg.acquirePinned(input("s1"));
    const secondPending = reg.acquirePinned(input("s2"));
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]!({ session: created[0] });
    resolvers[1]!({ session: created[1] });
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect(created[0].disposed).toBe(false);
    expect(created[1].disposed).toBe(false);

    first.release();
    expect(created[0].disposed).toBe(true);
    expect(created[1].disposed).toBe(false);
    second.release();
  });

  it("evict() disposes and removes the specific session", async () => {
    const { factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 5 });
    const first = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    reg.evict("s1");
    expect((first.session as any).disposed).toBe(true);
    const second = await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      agentSessionPath: null,
      resourceRevision: "rev"
    });
    expect(second.session).not.toBe(first.session);
  });

  it("sessionManagerFor falls back to create when open throws", async () => {
    const { factoryDeps } = deps();
    const calls: Array<[string, string | null]> = [];
    const reg = new AgentSessionRegistry({
      ...factoryDeps,
      sessionManagerFor: (cwd, existing) => {
        calls.push([cwd, existing]);
        return { kind: "sm" } as any;
      }
    });
    await reg.acquire({
      sessionId: "s1",
      workspaceRoot: "/root",
      agentSessionPath: "/old.jsonl",
      resourceRevision: "rev"
    });
    expect(calls).toEqual([["/root", "/old.jsonl"]]);
  });
});
