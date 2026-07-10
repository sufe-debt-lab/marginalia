import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiClient approvals", () => {
  it("lists approvals", async () => {
    const fetchMock = stubFetch([{ id: "a", toolCallId: "t", status: "pending" }]);
    const api = new ApiClient("http://x");
    const list = await api.listApprovals("s1");
    expect(fetchMock).toHaveBeenCalledWith("http://x/sessions/s1/approvals", expect.anything());
    expect(list[0]?.id).toBe("a");
  });

  it("posts a decision", async () => {
    const fetchMock = stubFetch({ ok: true });
    const api = new ApiClient("http://x");
    await api.resolveApproval("s1", "ap-1", { approved: false, reason: "换个方式" });
    const call = fetchMock.mock.calls[0] as unknown[];
    const [url, init] = call;
    expect(url).toBe("http://x/sessions/s1/approvals/ap-1");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      approved: false,
      reason: "换个方式"
    });
  });
});
