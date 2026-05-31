import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, Message } from "@/api/client.js";
import { useMessages } from "./useMessages.js";

describe("useMessages", () => {
  it("loads messages for session", async () => {
    const api = {
      listMessages: vi.fn(async () => [{ id: "m1", role: "user", content: "hi" }] as Message[])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("returns empty when sessionId is null", () => {
    const api = { listMessages: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, null));
    expect(result.current.data).toEqual([]);
    expect(api.listMessages).not.toHaveBeenCalled();
  });

  it("append + appendToLast support streaming updates", () => {
    const api = { listMessages: vi.fn(async () => []) } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    act(() => {
      result.current.append({ id: "x", role: "user", content: "u" });
      result.current.append({ id: "y", role: "assistant", content: "" });
    });
    act(() => {
      result.current.appendToLast("hello");
      result.current.appendToLast(" world");
    });
    expect(result.current.data[1]?.content).toBe("hello world");
  });

  it("removeMessage drops a message by id", () => {
    const api = { listMessages: vi.fn(async () => []) } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    act(() => {
      result.current.append({ id: "x", role: "user", content: "u" });
      result.current.append({ id: "y", role: "assistant", content: "" });
    });
    act(() => {
      result.current.removeMessage("y");
    });
    expect(result.current.data.map((m) => m.id)).toEqual(["x"]);
  });

  it("does not overwrite optimistic messages when initial load resolves late", async () => {
    let resolveMessages: (messages: Message[]) => void = () => {};
    const api = {
      listMessages: vi.fn(
        () =>
          new Promise<Message[]>((resolve) => {
            resolveMessages = resolve;
          })
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));

    act(() => {
      result.current.append({ id: "local-u", role: "user", content: "hi" });
      result.current.append({ id: "local-a", role: "assistant", content: "" });
    });
    act(() => {
      resolveMessages([]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((m) => m.id)).toEqual(["local-u", "local-a"]);
  });

  it("merges loaded history with optimistic messages appended while loading", async () => {
    let resolveMessages: (messages: Message[]) => void = () => {};
    const api = {
      listMessages: vi.fn(
        () =>
          new Promise<Message[]>((resolve) => {
            resolveMessages = resolve;
          })
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));

    act(() => {
      result.current.append({ id: "local-user-1", role: "user", content: "hi" });
      result.current.append({ id: "local-assistant-1", role: "assistant", content: "" });
    });
    act(() => {
      resolveMessages([{ id: "hist", role: "user", content: "old" }]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((m) => m.id)).toEqual([
      "hist",
      "local-user-1",
      "local-assistant-1"
    ]);
  });

  it("loads the next session after a session switch", async () => {
    const api = {
      listMessages: vi.fn(async (sessionId: string) =>
        sessionId === "s1"
          ? ([{ id: "s1-m", role: "user", content: "one" }] as Message[])
          : ([{ id: "s2-m", role: "user", content: "two" }] as Message[])
      )
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(({ sessionId }) => useMessages(api, sessionId), {
      initialProps: { sessionId: "s1" }
    });

    await waitFor(() => expect(result.current.data.map((m) => m.id)).toEqual(["s1-m"]));
    rerender({ sessionId: "s2" });
    await waitFor(() => expect(result.current.data.map((m) => m.id)).toEqual(["s2-m"]));
  });
});
