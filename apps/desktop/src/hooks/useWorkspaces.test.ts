import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useWorkspaces } from "./useWorkspaces.js";

function fakeApi(workspaces: Workspace[]): ApiClient {
  return {
    listWorkspaces: vi.fn(async () => workspaces),
    createWorkspace: vi.fn(async (input) => ({ id: "new", ...input }))
  } as unknown as ApiClient;
}

describe("useWorkspaces", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads workspaces on mount", async () => {
    const api = fakeApi([{ id: "a", name: "A", rootDir: "/a" }]);
    const { result } = renderHook(() => useWorkspaces(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data).toMatchObject([{ name: "A" }]);
    expect(result.current.loading).toBe(false);
  });

  it("creates a workspace and prepends to list", async () => {
    const api = fakeApi([{ id: "a", name: "A", rootDir: "/a" }]);
    const { result } = renderHook(() => useWorkspaces(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.create({ name: "B", rootDir: "/b" });
    });
    expect(result.current.data.map((w) => w.name)).toEqual(["B", "A"]);
  });
});
