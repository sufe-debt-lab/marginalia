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
      createMessage: vi.fn(async (_sid, input) => ({ id: "u", role: input.role, content: input.content }))
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

  it("sets error on run_failed and stops", async () => {
    const onError = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([{ type: "run_failed", payload: { error: "boom" } }])
      ),
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
});
