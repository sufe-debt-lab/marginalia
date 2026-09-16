import { describe, expect, it, vi } from "vitest";
import { createLoopbackProxyHandler, probeLoopbackAccess } from "./loopback-proxy.js";

const access = {
  url: "http://127.0.0.1:4312",
  bearer: "process-secret",
  origin: "null"
};

describe("loopback proxy", () => {
  it("forwards an allowed request with main-owned authorization", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const handler = createLoopbackProxyHandler({ getAccess: () => access, fetch });

    const response = await handler(
      new Request("marginalia://pi-server/workspaces?recent=true", {
        method: "POST",
        headers: {
          authorization: "Bearer renderer-controlled",
          cookie: "renderer-cookie",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Lab" })
      })
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4312/workspaces?recent=true", {
      method: "POST",
      headers: {
        authorization: "Bearer process-secret",
        origin: "null",
        "content-type": "application/json"
      },
      body: expect.any(ArrayBuffer),
      signal: expect.any(AbortSignal)
    });
  });

  it.each([
    ["wrong host", "marginalia://attacker/workspaces", "GET"],
    ["wrong scheme", "https://pi-server/workspaces", "GET"],
    ["unexpected port", "marginalia://pi-server:4312/workspaces", "GET"],
    ["fragment", "marginalia://pi-server/workspaces#hidden", "GET"],
    ["malformed URL", "not a URL", "GET"],
    ["unsupported method", "marginalia://pi-server/workspaces", "TRACE"]
  ])("rejects %s", async (_label, url, method) => {
    const fetch = vi.fn();
    const handler = createLoopbackProxyHandler({ getAccess: () => access, fetch });

    const response = await handler({ url, method, headers: new Headers(), arrayBuffer: vi.fn() });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "transport_forbidden" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps scheme-relative-looking paths on the configured loopback host", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const handler = createLoopbackProxyHandler({ getAccess: () => access, fetch });

    await handler(new Request("marginalia://pi-server//attacker.test/workspaces"));

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4312//attacker.test/workspaces",
      expect.any(Object)
    );
  });

  it("returns a stable error while pi-server is unavailable", async () => {
    const fetch = vi.fn();
    const handler = createLoopbackProxyHandler({ getAccess: () => null, fetch });

    const response = await handler(new Request("marginalia://pi-server/workspaces"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "pi_server_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards only safe CORS preflight declarations", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const handler = createLoopbackProxyHandler({ getAccess: () => access, fetch });

    await handler(
      new Request("marginalia://pi-server/workspaces", {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
          cookie: "renderer-cookie"
        }
      })
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4312/workspaces",
      expect.objectContaining({
        headers: {
          authorization: "Bearer process-secret",
          origin: "null",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type"
        }
      })
    );
  });
});

describe("packaged loopback smoke probe", () => {
  it("checks public health and direct unauthenticated rejection without exposing the bearer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    const result = await probeLoopbackAccess(access, fetch);

    expect(result).toEqual({ healthStatus: 200, unauthenticatedStatus: 401 });
    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:4312/health");
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:4312/workspaces", {
      headers: { origin: "null" }
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("process-secret");
  });
});
