import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
import { useStreamingChat } from "./useStreamingChat.js";

async function* makeEvents(events: RunEvent[]) {
  for (const e of events) {
    yield e;
  }
}

describe("useStreamingChat", () => {
  beforeEach(() => vi.useRealTimers());

  it("sends a message and accumulates assistant deltas", async () => {
    const onUserAppend = vi.fn();
    const onAssistantStart = vi.fn();
    const onAssistantDelta = vi.fn();
    const onComplete = vi.fn();

    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          { type: "assistant_delta", payload: { text: "hel" } },
          { type: "assistant_delta", payload: { text: "lo" } }
        ])
      ),
      createMessage: vi.fn(async (_sid, input) => ({
        id: "u",
        role: input.role,
        content: input.content
      }))
    } as unknown as ApiClient;

    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend,
        onAssistantStart,
        onAssistantDelta,
        onComplete
      })
    );

    await act(async () => {
      await result.current.send("hi", []);
    });

    await waitFor(() => expect(onAssistantDelta).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const total = onAssistantDelta.mock.calls.reduce((acc, [s]) => acc + s, "");
    expect(total).toBe("hello");
    expect(onUserAppend).toHaveBeenCalled();
    expect(onAssistantStart).toHaveBeenCalled();
  });

  it("sends when text is empty but context files are attached", async () => {
    const runChat = vi.fn(async () =>
      makeEvents([{ type: "assistant_delta", payload: { text: "ok" } }])
    );
    const api = { runChat } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn()
      })
    );
    await act(async () => {
      await result.current.send("", ["a.ts"]);
    });
    expect(runChat).toHaveBeenCalled();
  });

  it("does not send when both text and context files are empty", async () => {
    const runChat = vi.fn();
    const api = { runChat } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn()
      })
    );
    await act(async () => {
      await result.current.send("   ", []);
    });
    expect(runChat).not.toHaveBeenCalled();
  });

  it("sets error on run_failed and stops", async () => {
    const onError = vi.fn();
    const api = {
      runChat: vi.fn(async () => makeEvents([{ type: "run_failed", payload: { error: "boom" } }])),
      createMessage: vi.fn(async () => ({ id: "u", role: "user", content: "" }))
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn(),
        onError
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });

  it("transitions a tool call to done matched by toolCallId", async () => {
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          {
            type: "tool_started",
            payload: { toolCallId: "t1", toolName: "read", args: { path: "a.ts" } }
          },
          { type: "tool_completed", payload: { toolCallId: "t1", result: "done-result" } }
        ])
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn()
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() =>
      expect(result.current.toolCalls).toEqual([
        { id: "t1", name: "read", subtitle: "a.ts", status: "done", result: "done-result" }
      ])
    );
  });

  it("does not propagate a tool_updated event that has no toolCallId", async () => {
    const onToolCallUpdate = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([{ type: "tool_updated", payload: { toolName: "read", partialResult: "x" } }])
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onToolCallUpdate,
        onComplete: vi.fn()
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    expect(onToolCallUpdate).not.toHaveBeenCalled();
  });

  it("removes the empty assistant bubble when the run fails before any text", async () => {
    let assistantId = "";
    const onAssistantRemove = vi.fn();
    const api = {
      runChat: vi.fn(async () => makeEvents([{ type: "run_failed", payload: { error: "boom" } }]))
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: (m) => {
          assistantId = m.id;
        },
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAssistantRemove
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(onAssistantRemove).toHaveBeenCalledWith(assistantId));
  });

  it("keeps the assistant bubble when some text streamed before failure", async () => {
    const onAssistantRemove = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          { type: "assistant_delta", payload: { text: "partial" } },
          { type: "run_failed", payload: { error: "boom" } }
        ])
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onAssistantRemove
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(result.current.sending).toBe(false));
    expect(onAssistantRemove).not.toHaveBeenCalled();
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

    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn()
      })
    );

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
