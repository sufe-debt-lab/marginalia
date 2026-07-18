import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiClient file write", () => {
  it("writes a new file", async () => {
    const fetchMock = stubFetch({ path: "notes/test.md" }, 201);
    const api = new ApiClient("http://x", "token");
    const result = await api.writeWorkspaceFile("ws-1", {
      path: "notes/test.md",
      content: "# Test"
    });
    expect(result).toEqual({ path: "notes/test.md" });
    const call = fetchMock.mock.calls[0] as unknown[];
    const [url, init] = call;
    expect(url).toBe("http://x/workspaces/ws-1/files/content");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      path: "notes/test.md",
      content: "# Test"
    });
  });

  it("rejects 409 with 'file exists' error", async () => {
    stubFetch({ error: "file exists" }, 409);
    const api = new ApiClient("http://x", "token");
    await expect(api.writeWorkspaceFile("ws-1", { path: "a.md", content: "new" })).rejects.toThrow(
      "file exists"
    );
  });

  it("sends overwrite flag when specified", async () => {
    const fetchMock = stubFetch({ path: "a.md" }, 200);
    const api = new ApiClient("http://x", "token");
    await api.writeWorkspaceFile("ws-1", {
      path: "a.md",
      content: "new",
      overwrite: true
    });
    const call = fetchMock.mock.calls[0] as unknown[];
    const [, init] = call;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      path: "a.md",
      content: "new",
      overwrite: true
    });
  });
});
