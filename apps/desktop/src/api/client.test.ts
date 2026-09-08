import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

describe("ApiClient.runChat", () => {
  it("returns an async iterator of run events", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          'data: {"type":"run_started","payload":{"model":"MiniMax-M2.7"}}\n\n' +
            'data: {"type":"assistant_delta","payload":{"text":"hi"}}\n\n' +
            'data: {"type":"run_completed","payload":{}}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        )
    ) as typeof fetch;

    const api = new ApiClient("http://server", "secret-token");
    const events: unknown[] = [];
    const stream = await api.runChat("s1", {
      providerId: "p1",
      model: "MiniMax-M2.7",
      message: "hi"
    });
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "run_started", payload: { model: "MiniMax-M2.7" } },
      { type: "assistant_delta", payload: { text: "hi" } },
      { type: "run_completed", payload: {} }
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://server/sessions/s1/runs",
      expect.objectContaining({
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json"
        }
      })
    );
  });

  it("does not send the capability token to ordinary APIs", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const api = new ApiClient("http://server", "secret-token");

    await api.listWorkspaces();

    expect(fetchMock).toHaveBeenCalledWith("http://server/workspaces", {
      headers: { "content-type": "application/json" }
    });
  });

  it("preserves JSON error details from ordinary requests", async () => {
    const body = {
      error: "unauthorized",
      message: "Capability required",
      requestId: "request-1"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status: 401 }))
    );
    const api = new ApiClient("http://server", "secret-token");

    await expect(api.listWorkspaces()).rejects.toMatchObject({
      name: "ApiError",
      message: "Capability required",
      status: 401,
      code: "unauthorized",
      details: body
    });
  });

  it("uses a stable error for a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream failed", { status: 502 }))
    );
    const api = new ApiClient("http://server", "secret-token");

    await expect(api.listWorkspaces()).rejects.toMatchObject({
      name: "ApiError",
      message: "http_error",
      status: 502,
      code: "http_error",
      details: {}
    });
  });

  it("getBranch returns null on non-200", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 }));
    const api = new ApiClient("http://x", "token");
    await expect(api.getBranch("w")).resolves.toBeNull();
  });

  it("getBranch returns branch name on success", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ branch: "main" }), {
          headers: { "content-type": "application/json" }
        })
    );
    const api = new ApiClient("http://x", "token");
    await expect(api.getBranch("w")).resolves.toBe("main");
  });

  it("deleteWorkspace returns void on 204", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const api = new ApiClient("http://x", "token");
    await expect(api.deleteWorkspace("w")).resolves.toBeUndefined();
  });

  it("deleteWorkspace throws on non-2xx", async () => {
    const body = { error: "workspace_conflict", blockers: ["active_run"] };
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 409,
          headers: { "content-type": "application/json" }
        })
    );
    const api = new ApiClient("http://x", "token");
    await expect(api.deleteWorkspace("w")).rejects.toMatchObject({
      name: "ApiError",
      message: "workspace_conflict",
      status: 409,
      code: "workspace_conflict",
      details: body
    });
  });
});
