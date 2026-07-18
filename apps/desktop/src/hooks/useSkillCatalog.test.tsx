import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, SkillCandidate, SkillCatalogSnapshot } from "@/api/client.js";
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

function candidate(path: string, enabled = true): SkillCandidate {
  return {
    name: "pdf",
    description: "Read PDFs",
    discoveredPath: path,
    canonicalPath: path,
    source: "user_marginalia",
    scope: "user",
    status: enabled ? "effective" : "disabled",
    enabled,
    effective: enabled,
    explicitOnly: false,
    explicitEligible: true,
    shadowedBy: null,
    bytesTotal: 12,
    diagnostics: []
  };
}

function snapshot(
  workspaceId: string | null,
  catalogRevision: string,
  candidates: SkillCandidate[] = []
): SkillCatalogSnapshot {
  return {
    workspaceId,
    catalogRevision,
    effectiveRevision: `effective-${catalogRevision}`,
    refreshedAt: 1,
    candidates,
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

  it("keeps the old snapshot until a toggle returns its authoritative replacement", async () => {
    const toggled = deferred<SkillCatalogSnapshot>();
    const before = snapshot("w1", "before", [candidate("/skills/pdf/SKILL.md")]);
    const after = snapshot("w1", "after", [candidate("/skills/pdf/SKILL.md", false)]);
    const api = {
      listSkills: vi.fn(async () => before),
      setSkillEnabled: vi.fn(() => toggled.promise)
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("before"));

    let pending!: Promise<SkillCatalogSnapshot | null>;
    act(() => {
      pending = result.current.setEnabled("/skills/pdf/SKILL.md", false);
    });
    expect(result.current.snapshot?.candidates[0]?.enabled).toBe(true);
    expect(api.setSkillEnabled).toHaveBeenCalledWith({
      path: "/skills/pdf/SKILL.md",
      enabled: false,
      workspaceId: "w1"
    });

    await act(async () => toggled.resolve(after));
    await expect(pending).resolves.toEqual(after);
    expect(result.current.snapshot?.catalogRevision).toBe("after");
    expect(result.current.snapshot?.candidates[0]?.enabled).toBe(false);
  });

  it("retains the last snapshot and exposes a retryable toggle failure", async () => {
    const failure = new Error("toggle failed");
    const before = snapshot("w1", "before", [candidate("/skills/pdf/SKILL.md")]);
    const api = {
      listSkills: vi.fn(async () => before),
      setSkillEnabled: vi.fn(async () => {
        throw failure;
      })
    } as unknown as ApiClient;
    const { result } = renderHook(() => useSkillCatalog(api, "w1"));
    await waitFor(() => expect(result.current.snapshot?.catalogRevision).toBe("before"));

    let response!: SkillCatalogSnapshot | null;
    await act(async () => {
      response = await result.current.setEnabled("/skills/pdf/SKILL.md", false);
    });

    expect(response).toBeNull();
    expect(result.current.snapshot?.catalogRevision).toBe("before");
    expect(result.current.snapshot?.candidates[0]?.enabled).toBe(true);
    expect(result.current.error).toBe(failure);
  });

  it("rejects stale toggle responses by request, workspace, and path", async () => {
    const first = deferred<SkillCatalogSnapshot>();
    const second = deferred<SkillCatalogSnapshot>();
    const initial = snapshot("w1", "initial", [
      candidate("/skills/a/SKILL.md"),
      candidate("/skills/b/SKILL.md")
    ]);
    const api = {
      listSkills: vi.fn(async (workspaceId: string | null) =>
        snapshot(workspaceId, `${workspaceId}-initial`, initial.candidates)
      ),
      setSkillEnabled: vi
        .fn<ApiClient["setSkillEnabled"]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSkillCatalog(api, workspaceId),
      { initialProps: { workspaceId: "w1" as string | null } }
    );
    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe("w1"));

    let stale!: Promise<SkillCatalogSnapshot | null>;
    act(() => {
      stale = result.current.setEnabled("/skills/a/SKILL.md", false);
    });
    let latest!: Promise<SkillCatalogSnapshot | null>;
    act(() => {
      latest = result.current.setEnabled("/skills/b/SKILL.md", false);
    });
    const newest = snapshot("w1", "newest", [candidate("/skills/b/SKILL.md", false)]);
    await act(async () => second.resolve(newest));
    await expect(latest).resolves.toEqual(newest);
    await act(async () => first.resolve(snapshot("w1", "stale-path")));
    await expect(stale).resolves.toBeNull();
    expect(result.current.snapshot?.catalogRevision).toBe("newest");

    const workspaceToggle = deferred<SkillCatalogSnapshot>();
    (api.setSkillEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(workspaceToggle.promise);
    act(() => {
      void result.current.setEnabled("/skills/b/SKILL.md", true);
    });
    rerender({ workspaceId: "w2" });
    await waitFor(() => expect(result.current.snapshot?.workspaceId).toBe("w2"));
    await act(async () => workspaceToggle.resolve(snapshot("w1", "stale-workspace")));
    expect(result.current.snapshot?.workspaceId).toBe("w2");
  });
});
