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
  it("returns cached session for repeated sessionId", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    const a = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null });
    const b = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null });

    expect(a.session).toBe(b.session);
    expect(built).toEqual(["s-0"]);
  });

  it("evicts least-recently-used when capacity exceeded", async () => {
    const { built, factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 2 });

    await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null });
    const beforeEvict = await reg.acquire({ sessionId: "s2", workspaceRoot: "/tmp", agentSessionPath: null });
    await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null }); // touch s1
    await reg.acquire({ sessionId: "s3", workspaceRoot: "/tmp", agentSessionPath: null }); // pushes out s2

    expect(built).toEqual(["s-0", "s-1", "s-2"]);
    expect((beforeEvict.session as any).disposed).toBe(true);
  });

  it("evict() disposes and removes the specific session", async () => {
    const { factoryDeps } = deps();
    const reg = new AgentSessionRegistry({ ...factoryDeps, maxEntries: 5 });
    const first = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null });
    reg.evict("s1");
    expect((first.session as any).disposed).toBe(true);
    const second = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null });
    expect(second.session).not.toBe(first.session);
  });

  it("sessionManagerFor falls back to create when open throws", async () => {
    const { factoryDeps } = deps();
    let calls: Array<[string, string | null]> = [];
    const reg = new AgentSessionRegistry({
      ...factoryDeps,
      sessionManagerFor: (cwd, existing) => {
        calls.push([cwd, existing]);
        return { kind: "sm" } as any;
      }
    });
    await reg.acquire({ sessionId: "s1", workspaceRoot: "/root", agentSessionPath: "/old.jsonl" });
    expect(calls).toEqual([["/root", "/old.jsonl"]]);
  });
});
