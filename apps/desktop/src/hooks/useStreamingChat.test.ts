import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
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
const thinkingDelta = (delta: string) =>
  agentEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta } });

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
    const onToolCallUpdate = vi.fn((tc: { id: string; status: string }) => {
      if (tc.status === "running") toolBubbles.push([tc.id, onAssistantStart.mock.calls.length]);
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
    const { result } = makeHook(api, { onAssistantStart, onToolCallUpdate });

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

  it("accumulates reasoning text from thinking deltas", async () => {
    const api = {
      runChat: vi.fn(async () => makeEvents([thinkingDelta("ab"), thinkingDelta("cd")]))
    } as unknown as ApiClient;
    const { result } = makeHook(api);
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.reasoning).toBe("abcd"));
  });

  it("clears reasoning once the answer starts streaming", async () => {
    const api = {
      runChat: vi.fn(async () => makeEvents([thinkingDelta("x"), textDelta("y")]))
    } as unknown as ApiClient;
    const { result } = makeHook(api);
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.reasoning).toBe(""));
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

  it("transitions a tool call to done matched by toolCallId", async () => {
    const onToolCallUpdate = vi.fn();
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
    const { result } = makeHook(api, { onToolCallUpdate });
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() =>
      expect(onToolCallUpdate).toHaveBeenLastCalledWith({
        id: "t1",
        name: "read",
        status: "done",
        result: "done-result"
      })
    );
  });

  it("ignores tool execution events that have no toolCallId", async () => {
    const onToolCallUpdate = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          agentEvent({ type: "tool_execution_update", toolName: "read", partialResult: "x" })
        ])
      )
    } as unknown as ApiClient;
    const { result } = makeHook(api, { onToolCallUpdate });
    await act(async () => {
      await result.current.send("hi", []);
    });
    expect(onToolCallUpdate).not.toHaveBeenCalled();
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
