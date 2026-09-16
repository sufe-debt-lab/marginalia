import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { createProvider, createSession, createWorkspace } from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
const capability = {
  token: "secret",
  allowedOrigins: new Set(["http://127.0.0.1:5173"])
};

const cases = [
  { token: undefined, origin: undefined, status: 401 },
  { token: "wrong", origin: undefined, status: 401 },
  { token: "secret", origin: "https://evil.example", status: 403 },
  { token: "secret", origin: undefined, status: 200 },
  { token: "secret", origin: "null", status: 200 },
  { token: "secret", origin: "http://127.0.0.1:5173", status: 200 }
] as const;

function sensitiveHeaders(token?: string, origin?: string): HeadersInit {
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
  const app = createApp({ db, agentClient: new FakeAgentClient(), capability });
  return { app, provider, session };
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("run capability", () => {
  for (const testCase of cases) {
    it(`returns ${testCase.status} for token=${testCase.token ?? "missing"} origin=${testCase.origin ?? "missing"}`, async () => {
      const { app, provider, session } = setup();
      const response = await app.request(`/sessions/${session.id}/runs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...sensitiveHeaders(testCase.token, testCase.origin)
        },
        body: JSON.stringify({ providerId: provider.id, message: "hi" })
      });

      expect(response.status).toBe(testCase.status);
      if (testCase.status === 200) await response.text();
      if (testCase.status === 401)
        await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
      if (testCase.status === 403)
        await expect(response.json()).resolves.toEqual({ error: "origin_forbidden" });
    });
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
    const { app, session } = setup();
    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Authorization, Content-Type"
      }
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
