import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useFileTree } from "./useFileTree.js";

describe("useFileTree", () => {
  it("loads paths for a workspace", async () => {
    const api = {
      listFiles: vi.fn(async () => [
        { path: "README.md", name: "README.md", kind: "file" as const },
        { path: "src/App.tsx", name: "App.tsx", kind: "file" as const }
      ])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useFileTree(api, "w"));
    await waitFor(() => expect(result.current.paths).toEqual(["README.md", "src/App.tsx"]));
  });

  it("returns empty when workspaceId is null", () => {
    const api = { listFiles: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useFileTree(api, null));
    expect(result.current.paths).toEqual([]);
    expect(api.listFiles).not.toHaveBeenCalled();
  });
});
