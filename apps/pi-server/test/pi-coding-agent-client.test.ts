import { describe, expect, it, vi } from "vitest";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";
import type { AgentSessionEvent } from "../src/agent/agent-client.js";
import type { AgentSessionRegistry, SessionHandle } from "../src/agent/agent-session-registry.js";

function fakeSession(events: AgentSessionEvent[]) {
  const listeners: Array<(e: AgentSessionEvent) => void> = [];
  return {
    sessionFile: "/tmp/fake.jsonl",
    subscribe(fn: (e: AgentSessionEvent) => void) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    async prompt() {
      for (const event of events) {
        for (const fn of listeners) fn(event);
      }
    },
    dispose: vi.fn()
  };
}

describe("PiCodingAgentClient", () => {
  it("streams pi-native events and resolves sessionFile", async () => {
    const events: AgentSessionEvent[] = [
      { type: "agent_start" } as AgentSessionEvent,
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } } as unknown as AgentSessionEvent,
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

    const client = new PiCodingAgentClient(registry, () => ({ id: "MiniMax-M2.7" }));
    const result = await client.run({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7",
      message: "hello"
    });
    expect(result.sessionFile).toBe("/tmp/fake.jsonl");

    const collected: AgentSessionEvent[] = [];
    for await (const e of result.events) collected.push(e);
    expect(collected).toEqual(events);
  });

  it("throws when the resolver cannot find the model", async () => {
    const registry = { acquire: vi.fn() } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => null);
    await expect(
      client.run({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "unknown",
        modelId: "nope",
        message: "x"
      })
    ).rejects.toThrow(/unknown\/nope/);
  });
});
