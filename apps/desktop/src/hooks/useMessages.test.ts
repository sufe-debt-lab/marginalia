import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, Message } from "@/api/client.js";
import { useMessages } from "./useMessages.js";

describe("useMessages", () => {
  it("loads messages for session", async () => {
    const api = {
      listMessages: vi.fn(async () => [
        { id: "m1", role: "user", content: "hi" }
      ] as Message[])
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
    expect(result.current.data[1].content).toBe("hello world");
  });
});
