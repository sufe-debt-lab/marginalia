import Database from "better-sqlite3";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createProvider,
  createRun,
  createSession,
  createWorkspace,
  deleteProvider,
  getProvider,
  listProviders,
  updateProvider
} from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
function memoryDb() {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function spiedAuthStorage() {
  const authStorage = AuthStorage.inMemory();
  return {
    authStorage,
    setRuntimeApiKey: vi.spyOn(authStorage, "setRuntimeApiKey"),
    removeRuntimeApiKey: vi.spyOn(authStorage, "removeRuntimeApiKey")
  };
}

async function createMinimax(app: ReturnType<typeof createApp>) {
  return (
    await app.request("/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
    })
  ).json();
}

describe("updateProvider", () => {
  it("updates fields and keeps the stored api key when none is supplied", () => {
    const db = memoryDb();
    migrate(db);
    const created = createProvider(db, {
      name: "MiniMax",
      apiKey: "sk-original",
      baseUrl: "https://api.minimaxi.com/anthropic",
      defaultModel: "MiniMax-M2.7"
    });

    const updated = updateProvider(db, created.id, {
      defaultModel: "MiniMax-M3",
      enabled: false
    });

    expect(updated).toMatchObject({ defaultModel: "MiniMax-M3", enabled: false });
    expect(getProvider(db, created.id)?.apiKey).toBe("sk-original");
  });

  it("renames the env var key and rotates the value on rename + new key", () => {
    const db = memoryDb();
    migrate(db);
    const created = createProvider(db, {
      name: "GLM",
      apiKey: "sk-old",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      defaultModel: "glm-4.6"
    });

    updateProvider(db, created.id, { name: "GLM Pro", apiKey: "sk-new" });

    const row = db
      .prepare("select key, value from env_vars where id = ?")
      .get(created.apiKeyRef) as { key: string; value: string };
    expect(row.key).toBe("GLM PRO_API_KEY");
    expect(row.value).toBe("sk-new");
  });

  it("returns null for an unknown id", () => {
    const db = memoryDb();
    migrate(db);
    expect(updateProvider(db, "missing", { defaultModel: "x" })).toBeNull();
  });
});

describe("deleteProvider", () => {
  it("deletes a provider that still has run history (FK enforced)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    dbs.push(db);
    migrate(db);
    const workspace = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "C",
      origin: "desktop"
    });
    const created = createProvider(db, {
      name: "OpenAI",
      apiKey: "sk-x",
      defaultModel: "gpt-5.1"
    });
    createRun(db, { sessionId: session.id, providerId: created.id, model: "gpt-5.1" });

    expect(() => deleteProvider(db, created.id)).not.toThrow();
    expect(getProvider(db, created.id)).toBeNull();
    expect(db.prepare("select count(*) as n from runs").get()).toEqual({ n: 0 });
  });

  it("removes the provider row and its env var", () => {
    const db = memoryDb();
    migrate(db);
    const created = createProvider(db, {
      name: "OpenAI",
      apiKey: "sk-x",
      defaultModel: "gpt-5.1"
    });

    const removed = deleteProvider(db, created.id);

    expect(removed?.name).toBe("OpenAI");
    expect(getProvider(db, created.id)).toBeNull();
    expect(listProviders(db)).toHaveLength(0);
    expect(db.prepare("select count(*) as n from env_vars").get()).toEqual({ n: 0 });
  });

  it("returns null for an unknown id", () => {
    const db = memoryDb();
    migrate(db);
    expect(deleteProvider(db, "missing")).toBeNull();
  });
});

describe("PATCH /providers/:id", () => {
  it("updates the provider, hides the api key, and re-syncs the runtime key on rename", async () => {
    const db = memoryDb();
    migrate(db);
    const authStorage = spiedAuthStorage();
    const app = createApp({ db, authStorage: authStorage.authStorage });

    const created = await createMinimax(app);

    const res = await app.request(`/providers/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minimax Global", defaultModel: "MiniMax-M3" })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: "Minimax Global", defaultModel: "MiniMax-M3" });
    expect(body.apiKey).toBeUndefined();
    // rename: minimax-cn -> minimax (per piProviderId)
    expect(authStorage.removeRuntimeApiKey).toHaveBeenCalledWith("minimax-cn");
    expect(authStorage.setRuntimeApiKey).toHaveBeenLastCalledWith("minimax", "sk-test");
  });

  it("removes the runtime key when the provider is disabled", async () => {
    const db = memoryDb();
    migrate(db);
    const authStorage = spiedAuthStorage();
    const app = createApp({ db, authStorage: authStorage.authStorage });

    const created = await createMinimax(app);

    await app.request(`/providers/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });

    expect(authStorage.removeRuntimeApiKey).toHaveBeenCalledWith("minimax-cn");
  });

  it("clears the runtime key when the api key is explicitly blanked", async () => {
    const db = memoryDb();
    migrate(db);
    const authStorage = spiedAuthStorage();
    const app = createApp({ db, authStorage: authStorage.authStorage });

    const created = await createMinimax(app);
    authStorage.setRuntimeApiKey.mockClear();
    authStorage.removeRuntimeApiKey.mockClear();

    await app.request(`/providers/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "" })
    });

    expect(authStorage.removeRuntimeApiKey).toHaveBeenCalledWith("minimax-cn");
    expect(authStorage.setRuntimeApiKey).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown id", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });
    const res = await app.request("/providers/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultModel: "x" })
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /providers/:id", () => {
  it("deletes the provider and clears the runtime key", async () => {
    const db = memoryDb();
    migrate(db);
    const authStorage = spiedAuthStorage();
    const app = createApp({ db, authStorage: authStorage.authStorage });

    const created = await createMinimax(app);

    const res = await app.request(`/providers/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(listProviders(db)).toHaveLength(0);
    expect(authStorage.removeRuntimeApiKey).toHaveBeenCalledWith("minimax-cn");
  });

  it("returns 404 for an unknown id", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({ db });
    const res = await app.request("/providers/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("POST /sessions/:id/runs with a disabled provider", () => {
  it("rejects the run instead of failing on missing credentials", async () => {
    const db = memoryDb();
    migrate(db);
    const app = createApp({
      db,
      capability: { token: "test-token", allowedOrigins: new Set<string>() }
    });
    const workspace = createWorkspace(db, { name: "W", rootDir: "/tmp/w-run" });
    const session = createSession(db, {
      workspaceId: workspace.id,
      title: "C",
      origin: "desktop"
    });
    const created = await createMinimax(app);
    await app.request(`/providers/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });

    const res = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ providerId: created.id, message: "hi" })
    });
    expect(res.status).toBe(409);
  });
});
