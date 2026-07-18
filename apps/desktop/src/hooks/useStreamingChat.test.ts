import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAssistantMessage, ChatToolResult } from "@marginalia/chat-core";
import { ApiError, type ApiClient, type RunEvent } from "@/api/client.js";
import { useStreamingChat } from "./useStreamingChat.js";

async function* makeEvents(events: RunEvent[]) {
  for (const e of events) {
    yield e;
  }
}

/** Wrap a raw pi event in the SSE `agent_event` envelope the server now emits. */
const agentEvent = (event: unknown): RunEvent => ({ type: "agent_event", payload: { event } });
const textDelta = (delta: string) =>
  agentEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
const messageStart = () => agentEvent({ type: "message_start", message: { role: "assistant" } });
const messageEnd = (stopReason = "stop") =>
  agentEvent({ type: "message_end", message: { stopReason } });

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function assistantMessage(
  content: ChatAssistantMessage["content"] = [],
  stopReason: ChatAssistantMessage["stopReason"] = "stop"
): ChatAssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "minimax-cn",
    model: "MiniMax-M2.7",
    usage,
    stopReason,
    timestamp: 1
  };
}

function toolResultMessage(isError = false): ChatToolResult {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [{ type: "text", text: isError ? "failed-result" : "done-result" }],
    isError,
    timestamp: 2
  };
}

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
      onToolCallUpsert: vi.fn(),
      onToolResultUpsert: vi.fn(),
      onComplete: vi.fn(),
      ...overrides
    })
  );
}

describe("useStreamingChat", () => {
  beforeEach(() => vi.useRealTimers());

  it("accumulates assistant text deltas from agent_event", async () => {
    const onAssistantDelta = vi.fn();
    const onUserAppend = vi.fn();
    const onAssistantStart = vi.fn();
    const onComplete = vi.fn();
    const api = {
      runChat: vi.fn(async () => makeEvents([textDelta("hel"), textDelta("lo")]))
    } as unknown as ApiClient;
    const { result } = makeHook(api, {
      onAssistantDelta,
      onUserAppend,
      onAssistantStart,
      onComplete
    });

    await act(async () => {
      await result.current.send("hi", []);
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const total = onAssistantDelta.mock.calls.reduce((acc, [s]) => acc + s, "");
    expect(total).toBe("hello");
    expect(onUserAppend).toHaveBeenCalled();
    expect(onAssistantStart).toHaveBeenCalled();
  });

  it("opens a fresh assistant bubble per pi message (split on message_start)", async () => {
    const onAssistantStart = vi.fn();
    const onAssistantDelta = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          messageStart(),
          textDelta("a"),
          messageEnd("toolUse"),
          messageStart(),
          textDelta("b"),
          messageEnd("stop")
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onAssistantStart, onAssistantDelta });

    await act(async () => {
      await result.current.send("hi", []);
    });

    expect(onAssistantStart).toHaveBeenCalledTimes(2);
    const deltas = onAssistantDelta.mock.calls.map(([s]) => s);
    expect(deltas).toEqual(["a", "b"]);
  });

  it("attaches each message's tool to its own bubble, matching a reopened session", async () => {
    const onAssistantStart = vi.fn();
    const toolBubbles: Array<[string, number]> = [];
    const onToolCallUpsert = vi.fn((tc: { id: string }) => {
      toolBubbles.push([tc.id, onAssistantStart.mock.calls.length]);
    });
    const toolStart = (id: string, name: string) =>
      agentEvent({ type: "tool_execution_start", toolCallId: id, toolName: name, args: {} });
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          messageStart(),
          messageEnd("toolUse"),
          toolStart("read1", "read"),
          messageStart(),
          messageEnd("toolUse"),
          toolStart("bash1", "bash"),
          messageStart(),
          textDelta("answer"),
          messageEnd("stop")
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onAssistantStart, onToolCallUpsert });

    await act(async () => {
      await result.current.send("hi", []);
    });

    // read tool opened bubble #1, bash tool opened bubble #2, answer opened bubble #3.
    expect(toolBubbles).toEqual([
      ["read1", 1],
      ["bash1", 2]
    ]);
    expect(onAssistantStart).toHaveBeenCalledTimes(3);
  });

  it("sends when text is empty but context files are attached", async () => {
    const runChat = vi.fn(async () => makeEvents([textDelta("ok")]));
    const { result } = makeHook({ runChat } as unknown as ApiClient);
    await act(async () => {
      await result.current.send("", ["a.ts"]);
    });
    expect(runChat).toHaveBeenCalled();
  });

  it("does not send when both text and context files are empty", async () => {
    const runChat = vi.fn();
    const { result } = makeHook({ runChat } as unknown as ApiClient);
    await act(async () => {
      await result.current.send("   ", []);
    });
    expect(runChat).not.toHaveBeenCalled();
  });

  it("sets error on run_failed and stops", async () => {
    const onError = vi.fn();
    const api = {
      runChat: vi.fn(async () => makeEvents([{ type: "run_failed", payload: { error: "boom" } }]))
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onError });
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });

  it("surfaces a typed API error message without creating an assistant bubble", async () => {
    const onError = vi.fn();
    const onAssistantStart = vi.fn();
    const api = {
      runChat: vi.fn(async () => {
        throw new ApiError("Selections changed", 409, "skill_precondition_failed", {
          invalidSelections: [{ name: "pdf", path: "/old", reason: "missing" }]
        });
      })
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onError, onAssistantStart });

    await act(async () => {
      await result.current.send("hi", []);
    });

    expect(onError).toHaveBeenCalledWith("Selections changed");
    expect(onAssistantStart).not.toHaveBeenCalled();
  });

  it("appends a toolResult entry matched by toolCallId", async () => {
    const onToolResultUpsert = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({
            type: "tool_execution_start",
            toolCallId: "t1",
            toolName: "read",
            args: { path: "a.ts" }
          }),
          agentEvent({
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "read",
            result: "done-result",
            isError: false
          })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolResultUpsert });
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() =>
      expect(onToolResultUpsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            role: "toolResult",
            toolCallId: "t1",
            toolName: "read",
            isError: false
          })
        })
      )
    );
  });

  it("ignores tool execution events that have no toolCallId", async () => {
    const onToolCallUpsert = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({ type: "tool_execution_update", toolName: "read", partialResult: "x" })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolCallUpsert });
    await act(async () => {
      await result.current.send("hi", []);
    });
    expect(onToolCallUpsert).not.toHaveBeenCalled();
  });

  it("uses pi assistant toolCall content and toolResult messages for live parity", async () => {
    const onAssistantReplace = vi.fn();
    const onToolResultUpsert = vi.fn();
    const finalResult = toolResultMessage();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({ type: "message_start", message: assistantMessage([], "toolUse") }),
          agentEvent({
            type: "message_update",
            message: assistantMessage(
              [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }],
              "toolUse"
            ),
            assistantMessageEvent: { type: "toolcall_end" }
          }),
          agentEvent({
            type: "message_start",
            message: finalResult
          }),
          agentEvent({
            type: "message_end",
            message: finalResult
          })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onAssistantReplace, onToolResultUpsert });

    await act(async () => {
      await result.current.send("hi", []);
    });

    expect(onAssistantReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([expect.objectContaining({ type: "toolCall", id: "t1" })])
        })
      })
    );
    expect(onToolResultUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ role: "toolResult", toolCallId: "t1" })
      })
    );
  });

  it("creates no assistant bubble when the run fails before any content", async () => {
    const onAssistantStart = vi.fn();
    const api = {
      runChat: vi.fn(async () => makeEvents([{ type: "run_failed", payload: { error: "boom" } }]))
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onAssistantStart, onError: vi.fn() });
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(onAssistantStart).not.toHaveBeenCalled();
  });

  it("keeps the streamed assistant bubble when the run fails after some text", async () => {
    const onAssistantStart = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([textDelta("partial"), { type: "run_failed", payload: { error: "boom" } }])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onAssistantStart, onError: vi.fn() });
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(onAssistantStart).toHaveBeenCalledTimes(1);
  });

  it("can abort an active run and clear sending state", async () => {
    let seenSignal: AbortSignal | undefined;
    const api = {
      runChat: vi.fn(async (_sid, _input, options?: { signal?: AbortSignal }) => {
        seenSignal = options?.signal;
        return (async function* () {
          await new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          });
        })();
      })
    } as unknown as ApiClient;

    const { result } = makeHook(api);

    await act(async () => {
      void result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.sending).toBe(true));

    await act(async () => {
      result.current.stop();
    });

    expect(seenSignal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.sending).toBe(false));
  });
});
