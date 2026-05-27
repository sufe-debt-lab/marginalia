import { describe, expect, it } from "vitest";
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
    const stream = await api.runChat("s1", { providerId: "p1", model: "MiniMax-M2.7", message: "hi" });
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "run_started", payload: { model: "MiniMax-M2.7" } },
      { type: "assistant_delta", payload: { text: "hi" } },
      { type: "run_completed", payload: {} }
    ]);
  });
});
