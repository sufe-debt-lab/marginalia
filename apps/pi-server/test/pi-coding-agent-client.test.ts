import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";
import type { AgentRunEvent, AgentSessionEvent } from "../src/agent/agent-client.js";
import type { AgentSessionRegistry, SessionHandle } from "../src/agent/agent-session-registry.js";
import { AgentSessionRegistry as RealAgentSessionRegistry } from "../src/agent/agent-session-registry.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";

function fakeSession(events: AgentSessionEvent[]) {
  const listeners: Array<(e: AgentSessionEvent) => void> = [];
  const prompt = vi.fn(async (_message?: string, _promptOptions?: unknown) => {
    for (const event of events) {
      for (const fn of listeners) fn(event);
    }
  });
  return {
    sessionFile: "/tmp/fake.jsonl",
    subscribe(fn: (e: AgentSessionEvent) => void) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    prompt,
    abort: vi.fn(),
    setThinkingLevel: vi.fn(),
    dispose: vi.fn()
  };
}

async function collect(events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("PiCodingAgentClient", () => {
  it("does not prompt during prepare", async () => {
    const session = fakeSession([]);
    const registry = {
      acquire: vi.fn(async () => ({
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        dispose() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());

    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m"
    });

    expect(session.prompt).not.toHaveBeenCalled();
    const execution = prepared.start("hello");
    expect(session.prompt).toHaveBeenCalledWith("hello", undefined);
    await execution.settled;
  });

  it("settles after a synchronous prompt failure", async () => {
    const session = fakeSession([]);
    session.prompt.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const registry = {
      acquire: vi.fn(async () => ({
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        dispose() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());

    const execution = (
      await client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m"
      })
    ).start("hello");

    await expect(execution.settled).resolves.toBeUndefined();
    await expect(collect(execution.events)).rejects.toThrow("sync boom");
  });

  it("abort delegates to the prepared session", async () => {
    const session = fakeSession([]);
    const registry = {
      acquire: vi.fn(async () => ({
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        dispose() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const execution = (
      await client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m"
      })
    ).start("hello");

    execution.abort();

    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("starts a prepared run only once", async () => {
    const session = fakeSession([]);
    const registry = {
      acquire: vi.fn(async () => ({
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        dispose() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m"
    });

    const execution = prepared.start("first");

    expect(() => prepared.start("second")).toThrow("prepared run already started");
    await execution.settled;
  });

  it("streams pi-native events and resolves sessionFile", async () => {
    const events: AgentSessionEvent[] = [
      { type: "agent_start" } as AgentSessionEvent,
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hi" }
      } as unknown as AgentSessionEvent,
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ];
    const session = fakeSession(events);
    const handle: SessionHandle = {
      sessionId: "s1",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      dispose: () => session.dispose()
    };

    const registry = {
      acquire: vi.fn(async () => handle)
    } as unknown as AgentSessionRegistry;

    const client = new PiCodingAgentClient(
      registry,
      () => ({ id: "MiniMax-M2.7" }),
      new ApprovalGateway()
    );
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7"
    });
    expect(prepared.sessionFile).toBe("/tmp/fake.jsonl");
    const execution = prepared.start("hello");

    const collected: AgentSessionEvent[] = [];
    for await (const e of execution.events) collected.push(e as AgentSessionEvent);
    expect(collected).toEqual(events);
    await execution.settled;
  });

  it("maps readonly permission to a tool allowlist and applies reasoning", async () => {
    const session = fakeSession([
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ]);
    const handle: SessionHandle = {
      sessionId: "s1",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      dispose: () => session.dispose()
    };
    const acquire = vi.fn(async () => handle);
    const registry = { acquire } as unknown as AgentSessionRegistry;

    const client = new PiCodingAgentClient(
      registry,
      () => ({ id: "MiniMax-M2.7" }),
      new ApprovalGateway()
    );
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7",
      permission: "readonly",
      reasoning: "high"
    });
    const execution = prepared.start("hello");
    for await (const _e of execution.events) void _e;

    const config = acquire.mock.calls[0][0].config as Record<string, unknown>;
    expect(config.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(config.thinkingLevel).toBe("high");
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("leaves tools unset for full permission", async () => {
    const session = fakeSession([
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ]);
    const handle: SessionHandle = {
      sessionId: "s1",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      dispose: () => session.dispose()
    };
    const acquire = vi.fn(async () => handle);
    const registry = { acquire } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "m",
      permission: "full"
    });
    const config = acquire.mock.calls[0][0].config as Record<string, unknown>;
    expect(config.tools).toBeUndefined();
  });

  it("throws when the resolver cannot find the model", async () => {
    const registry = { acquire: vi.fn() } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => null, new ApprovalGateway());
    await expect(
      client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "unknown",
        modelId: "nope"
      })
    ).rejects.toThrow(/unknown\/nope/);
  });
});

function fakeSessionFactory() {
  let subscriber: ((event: unknown) => void) | null = null;
  let finishPrompt: (() => void) | null = null;
  const session = {
    sessionFile: "/tmp/fake-session.jsonl",
    subscribe(fn: (event: unknown) => void) {
      subscriber = fn;
      return () => {};
    },
    prompt() {
      return new Promise<void>((resolve) => {
        finishPrompt = resolve;
      });
    },
    dispose() {}
  };
  return {
    session,
    emit: (event: unknown) => subscriber?.(event),
    finish: () => finishPrompt?.()
  };
}

describe("PiCodingAgentClient approval merge", () => {
  it("merges gateway approval events into the run event stream and resolves via resolveApproval", async () => {
    // Real DefaultResourceLoader.reload() runs inside run(), so workspaceRoot must be a real directory.
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "pi-client-approval-"));
    const fake = fakeSessionFactory();
    const registry = new RealAgentSessionRegistry({
      authStorage: {} as never,
      modelRegistry: {} as never,
      createSession: async () => ({ session: fake.session as never }),
      sessionManagerFor: () => ({}) as never
    });
    const gateway = new ApprovalGateway({ fileExists: () => true });
    const client = new PiCodingAgentClient(registry, () => ({}) as never, gateway);

    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot,
      piProviderId: "openai",
      modelId: "gpt",
      permission: "ask"
    });
    const execution = prepared.start("hi");
    // Policy was registered for the session by prepare().
    expect(gateway.policyFor("s1")).toEqual({ permission: "ask", workspaceRoot });

    const iterator = execution.events[Symbol.asyncIterator]();
    const decisionPromise = gateway.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect((await iterator.next()).value).toMatchObject({ type: "approval_requested" });

    const approvalId = gateway.pendingIds("s1")[0]!;
    expect(client.resolveApproval("s1", approvalId, { approved: true })).toBe(true);
    await expect(decisionPromise).resolves.toEqual({ approved: true });
    expect((await iterator.next()).value).toMatchObject({
      type: "approval_resolved",
      approved: true
    });

    fake.emit({ type: "message_end", message: {} });
    expect((await iterator.next()).value).toMatchObject({ type: "message_end" });
    fake.finish();
    await execution.settled;
    expect((await iterator.next()).done).toBe(true);
  });
});
