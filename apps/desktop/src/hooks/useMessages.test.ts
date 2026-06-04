import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatEntry } from "@marginalia/chat-core";
import type { ApiClient } from "@/api/client.js";
import { useMessages } from "./useMessages.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

const user = (id: string, content: string): ChatEntry => ({
  id,
  message: { role: "user", content, timestamp: 1 }
});

const assistant = (id: string, text = ""): ChatEntry => ({
  id,
  message: {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "anthropic-messages",
    provider: "minimax-cn",
    model: "MiniMax-M2.7",
    usage,
    stopReason: "stop",
    timestamp: 2
  }
});

describe("useMessages", () => {
  it("loads messages for session", async () => {
    const api = {
      listMessages: vi.fn(async () => [user("m1", "hi")])
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
      result.current.append(user("x", "u"));
      result.current.append(assistant("y"));
    });
    act(() => {
      result.current.appendToLast("hello");
      result.current.appendToLast(" world");
    });
    expect(result.current.data[1]?.message).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "hello world" }]
    });
  });

  it("removeMessage drops a message by id", () => {
    const api = { listMessages: vi.fn(async () => []) } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    act(() => {
      result.current.append(user("x", "u"));
      result.current.append(assistant("y"));
    });
    act(() => {
      result.current.removeMessage("y");
    });
    expect(result.current.data.map((m) => m.id)).toEqual(["x"]);
  });

  it("does not overwrite optimistic messages when initial load resolves late", async () => {
    let resolveMessages: (messages: ChatEntry[]) => void = () => {};
    const api = {
      listMessages: vi.fn(
        () =>
          new Promise<ChatEntry[]>((resolve) => {
            resolveMessages = resolve;
          })
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));

    act(() => {
      result.current.append(user("local-u", "hi"));
      result.current.append(assistant("local-a"));
    });
    act(() => {
      resolveMessages([]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((m) => m.id)).toEqual(["local-u", "local-a"]);
  });

  it("merges loaded history with optimistic messages appended while loading", async () => {
    let resolveMessages: (messages: ChatEntry[]) => void = () => {};
    const api = {
      listMessages: vi.fn(
        () =>
          new Promise<ChatEntry[]>((resolve) => {
            resolveMessages = resolve;
          })
      )
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));

    act(() => {
      result.current.append(user("local-user-1", "hi"));
      result.current.append(assistant("local-assistant-1"));
    });
    act(() => {
      resolveMessages([user("hist", "old")]);
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
        sessionId === "s1" ? [user("s1-m", "one")] : [user("s2-m", "two")]
      )
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(({ sessionId }) => useMessages(api, sessionId), {
      initialProps: { sessionId: "s1" }
    });

    await waitFor(() => expect(result.current.data.map((m) => m.id)).toEqual(["s1-m"]));
    rerender({ sessionId: "s2" });
    await waitFor(() => expect(result.current.data.map((m) => m.id)).toEqual(["s2-m"]));
  });

  it("upserts assistant tool calls and tool results by toolCallId", () => {
    const api = { listMessages: vi.fn(async () => []) } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    act(() => {
      result.current.append(assistant("a1"));
      result.current.upsertToolCall({
        type: "toolCall",
        id: "tc1",
        name: "read",
        arguments: { path: "package.json" }
      });
      result.current.upsertToolResult({
        id: "local-tool-tc1",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read",
          content: [{ type: "text", text: "done" }],
          isError: false,
          timestamp: 3
        }
      });
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0]?.message).toMatchObject({
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read" }]
    });
    expect(result.current.data[1]?.message).toMatchObject({
      role: "toolResult",
      toolCallId: "tc1"
    });
  });
});
