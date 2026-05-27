import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useDocumentContent } from "./useDocumentContent.js";

describe("useDocumentContent", () => {
  it("reads content via api and caches per path", async () => {
    const api = {
      readDocument: vi.fn(async (_w, p) => ({
        path: p,
        mime: "text/plain",
        text: `content of ${p}`,
        truncated: false
      }))
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(({ path }: { path: string | null }) =>
      useDocumentContent(api, "w", path),
      { initialProps: { path: "a.txt" as string | null } }
    );
    await waitFor(() => expect(result.current.content?.text).toBe("content of a.txt"));
    rerender({ path: "a.txt" });
    expect(api.readDocument).toHaveBeenCalledTimes(1);
  });

  it("returns null when path is null", () => {
    const api = { readDocument: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useDocumentContent(api, "w", null));
    expect(result.current.content).toBeNull();
  });

  it("captures errors", async () => {
    const api = {
      readDocument: vi.fn(async () => {
        throw new Error("boom");
      })
    } as unknown as ApiClient;
    const { result } = renderHook(() => useDocumentContent(api, "w", "x.txt"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
  });
});
