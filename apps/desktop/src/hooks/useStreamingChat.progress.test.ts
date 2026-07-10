import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
import { useStreamingChat } from "./useStreamingChat.js";

async function* makeEvents(events: RunEvent[]) {
  for (const e of events) {
    yield e;
  }
}

/** Wrap a raw pi event in the SSE `agent_event` envelope the server now emits. */
const agentEvent = (event: unknown): RunEvent => ({ type: "agent_event", payload: { event } });

function makeHook(api: ApiClient, overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useStreamingChat({
      api,
      sessionId: "s",
      providerId: "p",
      model: "m",
      onUserAppend: vi.fn(),
      onAssistantStart: vi.fn(),
      onAssistantDelta: vi.fn(),
      onAssistantReplace: vi.fn(),
      onComplete: vi.fn(),
      ...overrides
    })
  );
}

describe("useStreamingChat tool progress", () => {
  it("forwards accumulated partialResult text per update", async () => {
    const onToolProgress = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({
            type: "tool_execution_start",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" }
          }),
          agentEvent({
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            partialResult: { content: [{ type: "text", text: "line1\n" }] }
          }),
          agentEvent({
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            partialResult: { content: [{ type: "text", text: "line1\nline2\n" }] }
          })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolProgress });

    await act(async () => {
      await result.current.send("hi", []);
    });

    expect(onToolProgress).toHaveBeenNthCalledWith(1, "t1", "line1\n");
    expect(onToolProgress).toHaveBeenNthCalledWith(2, "t1", "line1\nline2\n");
  });

  it("ignores updates without textual partialResult", async () => {
    const onToolProgress = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: {}
          })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolProgress });

    await act(async () => {
      await result.current.send("hi", []);
    });

    expect(onToolProgress).not.toHaveBeenCalled();
  });
});
