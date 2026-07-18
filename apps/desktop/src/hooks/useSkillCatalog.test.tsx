import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, SkillCatalogSnapshot } from "@/api/client.js";
import { useSkillCatalog } from "./useSkillCatalog.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(workspaceId: string | null, catalogRevision: string): SkillCatalogSnapshot {
  return {
    workspaceId,
    catalogRevision,
    effectiveRevision: `effective-${catalogRevision}`,
    refreshedAt: 1,
    candidates: [],
    diagnostics: []
  };
}

describe("useSkillCatalog", () => {
  it("ignores a response from the previous workspace", async () => {
    const w1 = deferred<SkillCatalogSnapshot>();
    const w2 = deferred<SkillCatalogSnapshot>();
    const api = {
      listSkills: vi.fn((workspaceId: string | null) =>
        workspaceId === "w1" ? w1.promise : w2.promise
      )
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSkillCatalog(api, workspaceId),
      { initialProps: { workspaceId: "w1" as string | null } }
    );

    rerender({ workspaceId: "w2" });
    expect(result.current.snapshot).toBeNull();
    await act(async () => w2.resolve(snapshot("w2", "new")));
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("new"));
    await act(async () => w1.resolve(snapshot("w1", "old")));

    expect(result.current.snapshot?.workspaceId).toBe("w2");
    expect(result.current.snapshot?.catalogRevision).toBe("new");
  });

  it("accepts only the latest request for the same workspace", async () => {
    const first = deferred<SkillCatalogSnapshot>();
    const second = deferred<SkillCatalogSnapshot>();
    const api = {
      listSkills: vi
        .fn<ApiClient["listSkills"]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));

    let latest!: Promise<SkillCatalogSnapshot | null>;
    act(() => {
      latest = result.current.refresh();
    });
    await act(async () => second.resolve(snapshot("w1", "second")));
    await latest;
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("second"));
    await act(async () => first.resolve(snapshot("w1", "first")));

    expect(result.current.snapshot?.catalogRevision).toBe("second");
  });

  it("keeps the last snapshot but returns null and exposes an error after refresh fails", async () => {
    const failure = new Error("offline");
    const api = {
      listSkills: vi
        .fn<ApiClient["listSkills"]>()
        .mockResolvedValueOnce(snapshot("w1", "good"))
        .mockRejectedValueOnce(failure)
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("good"));

    let refreshed!: SkillCatalogSnapshot | null;
    await act(async () => {
      refreshed = await result.current.refresh();
    });

    expect(refreshed).toBeNull();
    expect(result.current.snapshot?.catalogRevision).toBe("good");
    expect(result.current.error).toBe(failure);
    expect(result.current.loading).toBe(false);
  });

  it("does not accept a snapshot for a different workspace", async () => {
    const api = {
      listSkills: vi.fn(async () => snapshot("w2", "wrong-workspace"))
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot).toBeNull();
  });

  it("keeps the last snapshot but exposes an error when refresh returns another workspace", async () => {
    const api = {
      listSkills: vi
        .fn<ApiClient["listSkills"]>()
        .mockResolvedValueOnce(snapshot("w1", "good"))
        .mockResolvedValueOnce(snapshot("w2", "mismatched"))
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("good"));

    let refreshed!: SkillCatalogSnapshot | null;
    await act(async () => {
      refreshed = await result.current.refresh();
    });

    expect(refreshed).toBeNull();
    expect(result.current.snapshot?.catalogRevision).toBe("good");
    expect(result.current.error).toEqual(expect.any(Error));
    expect(result.current.loading).toBe(false);
  });
});
