import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

describe("ApiClient.runChat", () => {
  it("returns an async iterator of run events", async () => {
    global.fetch = (async () =>
      new Response(
        'data: {"type":"run_started","payload":{"model":"MiniMax-M2.7"}}\n\n' +
          'data: {"type":"assistant_delta","payload":{"text":"hi"}}\n\n' +
          'data: {"type":"run_completed","payload":{}}\n\n',
        { headers: { "content-type": "text/event-stream" } }
      )) as typeof fetch;

    const api = new ApiClient("http://server");
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
  });

  it("getBranch returns null on non-200", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 }));
    const api = new ApiClient("http://x");
    await expect(api.getBranch("w")).resolves.toBeNull();
  });

  it("getBranch returns branch name on success", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ branch: "main" }), {
          headers: { "content-type": "application/json" }
        })
    );
    const api = new ApiClient("http://x");
    await expect(api.getBranch("w")).resolves.toBe("main");
  });

  it("deleteWorkspace returns void on 204", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const api = new ApiClient("http://x");
    await expect(api.deleteWorkspace("w")).resolves.toBeUndefined();
  });

  it("deleteWorkspace throws on non-2xx", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
    );
    const api = new ApiClient("http://x");
    await expect(api.deleteWorkspace("w")).rejects.toThrow(/not found/);
  });
});
