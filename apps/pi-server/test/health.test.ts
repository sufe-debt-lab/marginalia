import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns server health metadata", async () => {
    const app = createApp({ startedAt: new Date("2026-05-25T00:00:00.000Z") });

    const response = await app.request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "pi-server",
      version: "0.1.0",
      startedAt: "2026-05-25T00:00:00.000Z"
    });
  });

  it("allows the desktop renderer origin to call health", async () => {
    const app = createApp({ startedAt: new Date("2026-05-25T00:00:00.000Z") });

    const response = await app.request("/health", {
      headers: { origin: "http://127.0.0.1:5173" }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });
});
