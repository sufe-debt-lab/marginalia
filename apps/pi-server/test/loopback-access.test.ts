import { AuthStorage } from "@earendil-works/pi-coding-agent";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { createProvider, createSession, createWorkspace } from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
const loopbackAccess = {
  bearer: "secret",
  allowedOrigins: new Set(["null", "http://127.0.0.1:5173"])
};

const cases = [
  { token: "secret", origin: undefined, status: 403 },
  { token: undefined, origin: "http://127.0.0.1:5173", status: 401 },
  { token: "wrong", origin: "http://127.0.0.1:5173", status: 401 },
  { token: "secret", origin: "https://evil.example", status: 403 },
  { token: "secret", origin: "null", status: 200 },
  { token: "secret", origin: "http://127.0.0.1:5173", status: 200 }
] as const;

function requestHeaders(token?: string, origin?: string): HeadersInit {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(origin ? { origin } : {})
  };
}

function setup() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const workspace = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
  const session = createSession(db, { workspaceId: workspace.id, title: "S", origin: "desktop" });
  const provider = createProvider(db, {
    name: "openai",
    apiKey: "test-key",
    defaultModel: "gpt-4.1"
  });
  const app = createApp({
    authStorage: AuthStorage.inMemory(),
    db,
    agentClient: new FakeAgentClient(),
    loopbackAccess
  });
  return { app, provider, session };
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("loopback access", () => {
  it("keeps health public", async () => {
    const { app } = setup();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("fails closed when a configured policy has no bearer", async () => {
    const db = new Database(":memory:");
    dbs.push(db);
    const app = createApp({
      authStorage: AuthStorage.inMemory(),
      db,
      agentClient: new FakeAgentClient(),
      loopbackAccess: {
        bearer: null,
        allowedOrigins: new Set(["http://127.0.0.1:5173"])
      }
    });

    const response = await app.request("/workspaces", {
      headers: { origin: "http://127.0.0.1:5173" }
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  for (const testCase of cases) {
    it.each([
      { method: "GET", path: "/workspaces", body: undefined },
      {
        method: "POST",
        path: "/workspaces",
        body: JSON.stringify({ name: "Another", rootDir: "/tmp/another" })
      }
    ])(
      `returns ${testCase.status} for $method token=${testCase.token ?? "missing"} origin=${testCase.origin ?? "missing"}`,
      async ({ method, path, body }) => {
        const { app } = setup();
        const response = await app.request(path, {
          method,
          headers: {
            "content-type": "application/json",
            ...requestHeaders(testCase.token, testCase.origin)
          },
          body
        });

        const expectedStatus = testCase.status === 200 && method === "POST" ? 201 : testCase.status;
        expect(response.status).toBe(expectedStatus);
        if (testCase.status === 401)
          await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
        if (testCase.status === 403)
          await expect(response.json()).resolves.toEqual({ error: "origin_forbidden" });
      }
    );
  }

  it("allows an exact-origin preflight without bearer authorization", async () => {
    const { app, session } = setup();
    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Authorization, Content-Type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(response.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });

  it("does not allow an untrusted origin in preflight", async () => {
    const { app } = setup();
    const response = await app.request("/workspaces", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Authorization, Content-Type"
      }
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "origin_forbidden" });
  });

  it("returns machine-readable authorization errors to an allowed renderer Origin", async () => {
    const { app } = setup();

    const response = await app.request("/workspaces", {
      headers: requestHeaders("wrong", "http://127.0.0.1:5173")
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
