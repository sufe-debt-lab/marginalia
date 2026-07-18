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
  it("coalesces cumulative snapshots into one delivery per flush", async () => {
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

    // Both updates land inside a single flush window, so only the latest
    // cumulative snapshot is delivered — one state update per frame, not per event.
    expect(onToolProgress).toHaveBeenCalledTimes(1);
    expect(onToolProgress).toHaveBeenCalledWith("t1", "line1\nline2\n");
  });

  it("drops buffered progress once the tool result arrives", async () => {
    const onToolProgress = vi.fn();
    const onToolResultUpsert = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            partialResult: { content: [{ type: "text", text: "line1\n" }] }
          }),
          agentEvent({
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            result: "done",
            isError: false
          })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolProgress, onToolResultUpsert });

    await act(async () => {
      await result.current.send("hi", []);
    });

    // The final result supersedes the buffered snapshot: no late progress
    // delivery may resurrect a live-output area for a finished call.
    expect(onToolProgress).not.toHaveBeenCalled();
    expect(onToolResultUpsert).toHaveBeenCalledTimes(1);
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
