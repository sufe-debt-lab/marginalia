import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Session } from "@/api/client.js";
import { useSessions } from "./useSessions.js";

function fakeApi(sessions: Session[]): ApiClient {
  return {
    listSessions: vi.fn(async () => sessions),
    createSession: vi.fn(async (input) => ({
      id: "new",
      workspaceId: input.workspaceId,
      title: input.title,
      origin: "ui",
      model: null
    }))
  } as unknown as ApiClient;
}

describe("useSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads sessions for workspaceId", async () => {
    const api = fakeApi([{ id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null }]);
    const { result } = renderHook(() => useSessions(api, "w"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("returns empty list when workspaceId is null", async () => {
    const api = fakeApi([]);
    const { result } = renderHook(() => useSessions(api, null));
    expect(result.current.data).toEqual([]);
    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it("creates a session and prepends", async () => {
    const api = fakeApi([{ id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null }]);
    const { result } = renderHook(() => useSessions(api, "w"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.create("new title");
    });
    expect(result.current.data.map((s) => s.title)).toEqual(["new title", "first"]);
  });
});
