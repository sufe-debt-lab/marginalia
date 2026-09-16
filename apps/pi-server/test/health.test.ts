import Database from "better-sqlite3";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const dbs: Database.Database[] = [];
function fixtureOptions() {
  const db = new Database(":memory:");
  dbs.push(db);
  return { db, authStorage: AuthStorage.inMemory() };
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("GET /health", () => {
  it("returns server health metadata", async () => {
    const app = createApp({ ...fixtureOptions(), startedAt: new Date("2026-05-25T00:00:00.000Z") });

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
    const app = createApp({
      ...fixtureOptions(),
      startedAt: new Date("2026-05-25T00:00:00.000Z"),
      capability: {
        token: null,
        allowedOrigins: new Set(["http://127.0.0.1:5173"])
      }
    });

    const response = await app.request("/health", {
      headers: { origin: "http://127.0.0.1:5173" }
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });
});
