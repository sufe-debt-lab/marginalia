import { describe, expect, it } from "vitest";
import { streamSse } from "./sse-stream.js";

function chunked(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
}

describe("streamSse", () => {
  it("yields parsed events split across chunks", async () => {
    const stream = chunked([
      'data: {"type":"run_started"',
      ',"run_id":"r1"}\n\n',
      'data: {"type":"assistant_delta","payload":{"text":"hi"}}\n\n'
    ]);
    const events: unknown[] = [];
    for await (const event of streamSse(stream)) events.push(event);
    expect(events).toEqual([
      { type: "run_started", run_id: "r1" },
      { type: "assistant_delta", payload: { text: "hi" } }
    ]);
  });

  it("ignores keep-alive empty data lines", async () => {
    const stream = chunked(["data: \n\n", 'data: {"type":"x"}\n\n']);
    const events: unknown[] = [];
    for await (const event of streamSse(stream)) events.push(event);
    expect(events).toEqual([{ type: "x" }]);
  });
});
