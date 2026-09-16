import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createTestApp as createApp } from "./test-app.js";
import { migrate } from "../src/db/migrations.js";
import { CredentialStore } from "../src/credentials/store.js";
import { MemoryCredentialAdapter } from "./helpers/memory-credentials.js";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentClient } from "../src/agent/agent-client.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "marginalia-credentials-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let db = new Database(path.join(root, "db.sqlite"));
  cleanup.push(() => db.close());
  db.pragma("foreign_keys = ON");
  migrate(db);
  const adapter = new MemoryCredentialAdapter();
  const credentialStore = new CredentialStore(adapter);
  const reopen = () => {
    db.close();
    db = new Database(path.join(root, "db.sqlite"));
    db.pragma("foreign_keys = ON");
    return db;
  };
  return { root, db, adapter, credentialStore, reopen };
}

it("creates a Provider without recoverable secrets in the database or HTTP response", async () => {
  const { root, db, credentialStore } = fixture();
  const app = createApp({ db, credentialStore });
  const response = await app.request("/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "OpenAI",
      apiKey: "unique-provider-secret",
      defaultModel: "gpt-4o"
    })
  });
  expect(response.status).toBe(201);
  const provider = await response.json();
  expect(JSON.stringify(provider)).not.toContain("unique-provider-secret");
  expect(credentialStore.read(provider.apiKeyRef)).toBe("unique-provider-secret");
  for (const file of readdirSync(root)) {
    expect(
      readFileSync(path.join(root, file)).includes(Buffer.from("unique-provider-secret"))
    ).toBe(false);
  }
});

function legacyProvider(db: Database.Database) {
  db.prepare(
    "insert into env_vars (id, key, value, created_at) values ('legacy', 'OPENAI_API_KEY', 'legacy-secret-marker', 1)"
  ).run();
  db.prepare(
    "insert into providers (id, name, api_key_ref, default_model, created_at, updated_at) values ('old-provider', 'OpenAI', 'legacy', 'gpt-4o', 1, 1)"
  ).run();
}

it.each([false, true])(
  "migrates orphaned keys from failed legacy creates (prior success marker: %s)",
  (alreadyMarked) => {
    const { root, db, credentialStore } = fixture();
    db.pragma("journal_mode = WAL");
    // Legacy createProvider committed these two statements independently.
    db.prepare(
      "insert into env_vars (id,key,value,created_at) values ('orphan','OPENAI_API_KEY','orphan-secret-marker',1)"
    ).run();
    expect(() =>
      db
        .prepare(
          "insert into providers (id,name,api_key_ref,default_model,created_at,updated_at) values ('failed','OpenAI','orphan',NULL,1,1)"
        )
        .run()
    ).toThrow(/NOT NULL/);
    if (alreadyMarked)
      db.prepare("insert into schema_migrations (version,applied_at) values (4,1)").run();
    createApp({ db, credentialStore });
    expect(credentialStore.read("orphan")).toBe("orphan-secret-marker");
    expect(
      db.prepare("select value,credential_store from env_vars where id='orphan'").get()
    ).toEqual({ value: "", credential_store: 1 });
    for (const file of readdirSync(root)) {
      expect(
        readFileSync(path.join(root, file)).includes(Buffer.from("orphan-secret-marker"))
      ).toBe(false);
    }
    credentialStore.replace("orphan", "rotated");
    createApp({ db, credentialStore });
    expect(credentialStore.read("orphan")).toBe("rotated");
  }
);

it("retains an orphaned legacy key if the credential store refuses access and retries", () => {
  const { db, adapter, credentialStore } = fixture();
  db.prepare(
    "insert into env_vars (id,key,value,created_at) values ('orphan','OPENAI_API_KEY','orphan-secret-marker',1)"
  ).run();
  adapter.failure = "get";
  expect(() => createApp({ db, credentialStore })).toThrow("credential_store_unavailable");
  expect(db.prepare("select value,credential_store from env_vars where id='orphan'").get()).toEqual(
    { value: "orphan-secret-marker", credential_store: 0 }
  );
  expect(db.prepare("select 1 from schema_migrations where version=4").get()).toBeUndefined();
  adapter.failure = null;
  createApp({ db, credentialStore });
  expect(credentialStore.read("orphan")).toBe("orphan-secret-marker");
});

it("keeps the original migration source if a WAL reader prevents cleanup, then retries", () => {
  const { root, db, credentialStore } = fixture();
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 1");
  legacyProvider(db);
  const reader = new Database(path.join(root, "db.sqlite"));
  try {
    reader.exec("BEGIN");
    reader.prepare("select * from env_vars").all();
    expect(() => createApp({ db, credentialStore })).toThrow("credential_store_unavailable");
    expect(
      db.prepare("select value, credential_store from env_vars where id = 'legacy'").get()
    ).toEqual({ value: "legacy-secret-marker", credential_store: 0 });
    expect(db.prepare("select 1 from schema_migrations where version = 4").get()).toBeUndefined();
  } finally {
    reader.close();
  }
  expect(() => createApp({ db, credentialStore })).not.toThrow();
  expect(credentialStore.read("legacy")).toBe("legacy-secret-marker");
});

it("migrates legacy credentials once and removes plaintext from SQLite and WAL", () => {
  const { root, db, credentialStore } = fixture();
  db.pragma("journal_mode = WAL");
  legacyProvider(db);
  createApp({ db, credentialStore });
  expect(credentialStore.read("legacy")).toBe("legacy-secret-marker");
  for (const file of readdirSync(root)) {
    expect(readFileSync(path.join(root, file)).includes(Buffer.from("legacy-secret-marker"))).toBe(
      false
    );
  }
  credentialStore.replace("legacy", "rotated");
  createApp({ db, credentialStore });
  expect(credentialStore.read("legacy")).toBe("rotated");
});

it.each(["set", "get"] as const)(
  "keeps legacy data on migration %s failure, then retries",
  (failure) => {
    const { db, adapter, credentialStore } = fixture();
    legacyProvider(db);
    adapter.failure = failure;
    expect(() => createApp({ db, credentialStore })).toThrow("credential_store_unavailable");
    expect(
      db.prepare("select value, credential_store from env_vars where id = 'legacy'").get()
    ).toEqual({ value: "legacy-secret-marker", credential_store: 0 });
    adapter.failure = null;
    expect(() => createApp({ db, credentialStore })).not.toThrow();
    expect(credentialStore.read("legacy")).toBe("legacy-secret-marker");
  }
);

function json(app: ReturnType<typeof createApp>, route: string, body: unknown, method = "POST") {
  return app.request(route, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
      origin: "null"
    },
    body: JSON.stringify(body)
  });
}

it.each(["disabled", "missing", "busy-run", "missing-run", "invalid-skills"] as const)(
  "a %s request does not change the credentials of an active run",
  async (state) => {
    const { root, db, credentialStore } = fixture();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = modelRegistry.find("openai", "gpt-4o")!;
    const keys: Array<string | undefined> = [];
    let entered!: () => void;
    let resume!: () => void;
    let settled!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resumePromise = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const settledPromise = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const readCredential = async () => {
      // This is the same lookup used by pi's streamFn for every model request.
      const result = await modelRegistry.getApiKeyAndHeaders(model);
      keys.push(result.ok ? result.apiKey : undefined);
    };
    const agentClient: AgentClient = {
      resolveApproval: () => false,
      cancelPending: () => 0,
      prepare: async () => ({
        sessionFile: null,
        release() {},
        start: () => ({
          abort: resume,
          settled: settledPromise,
          events: {
            async *[Symbol.asyncIterator]() {
              try {
                await readCredential();
                entered();
                await resumePromise;
                await readCredential();
                yield { type: "agent_start" };
              } finally {
                settled();
              }
            }
          }
        })
      })
    };
    const app = createApp({
      db,
      credentialStore,
      authStorage,
      modelRegistry,
      agentClient
    });
    const create = async (key: string) =>
      (
        await json(app, "/providers", {
          name: "OpenAI",
          apiKey: key,
          defaultModel: "gpt-4o"
        })
      ).json();
    const a = await create("account-A");
    const b = await create("account-B");
    const probing = state === "disabled" || state === "missing";
    if (probing) await json(app, `/providers/${b.id}`, { enabled: false }, "PATCH");
    if (state === "missing" || state === "missing-run") credentialStore.delete(b.apiKeyRef);
    await json(app, `/providers/${a.id}`, { enabled: true }, "PATCH");
    const workspace = await (
      await json(app, "/workspaces", { name: "Test", rootDir: root })
    ).json();
    const session = await (
      await json(app, "/sessions", { workspaceId: workspace.id, title: "Test" })
    ).json();
    const run = await json(app, `/sessions/${session.id}/runs`, {
      providerId: a.id,
      message: "hello"
    });
    const body = run.text();
    try {
      await enteredPromise;
      expect(db.prepare("select status from runs").get()).toEqual({ status: "running" });
      if (probing) {
        const probe = await (await json(app, `/providers/${b.id}/test`, {})).json();
        expect(probe).toMatchObject({ ok: state === "disabled" });
      } else {
        const target =
          state === "invalid-skills"
            ? await (
                await json(app, "/sessions", { workspaceId: workspace.id, title: "Other" })
              ).json()
            : session;
        const rejected = await json(app, `/sessions/${target.id}/runs`, {
          providerId: b.id,
          message: "rejected",
          ...(state === "invalid-skills" ? { skills: "invalid" } : {})
        });
        expect(rejected.status).toBe(state === "invalid-skills" ? 500 : 409);
      }
    } finally {
      resume();
    }
    expect(await body).toContain("run_completed");
    expect(keys).toEqual(["account-A", "account-A"]);
  }
);

it.each(["rotated-key", ""])(
  "uses current credentials after preparation (%s)",
  async (replacement) => {
    const { root, db, credentialStore } = fixture();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = modelRegistry.find("openai", "gpt-4o")!;
    let entered!: () => void;
    let resume!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resumePromise = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const keys: Array<string | undefined> = [];
    const fake = new FakeAgentClient();
    const agentClient: AgentClient = {
      resolveApproval: () => false,
      cancelPending: () => 0,
      prepare: async (input) => {
        entered();
        await resumePromise;
        const prepared = await fake.prepare(input);
        return {
          ...prepared,
          start: (message) => {
            const execution = prepared.start(message);
            return {
              ...execution,
              events: {
                async *[Symbol.asyncIterator]() {
                  const result = await modelRegistry.getApiKeyAndHeaders(model);
                  keys.push(result.ok ? result.apiKey : undefined);
                  yield* execution.events;
                }
              }
            };
          }
        };
      }
    };
    const app = createApp({
      db,
      credentialStore,
      authStorage,
      modelRegistry,
      agentClient
    });
    const provider = await (
      await json(app, "/providers", { name: "OpenAI", apiKey: "old-key", defaultModel: "gpt-4o" })
    ).json();
    const workspace = await (
      await json(app, "/workspaces", { name: "Test", rootDir: root })
    ).json();
    const session = await (
      await json(app, "/sessions", { workspaceId: workspace.id, title: "Test" })
    ).json();
    const request = json(app, `/sessions/${session.id}/runs`, {
      providerId: provider.id,
      message: "hello"
    });
    await enteredPromise;
    try {
      expect(
        (await json(app, `/providers/${provider.id}`, { apiKey: replacement }, "PATCH")).status
      ).toBe(200);
    } finally {
      resume();
    }
    const body = await (await request).text();
    expect(keys).toEqual(replacement ? [replacement] : []);
    expect(body).toContain(replacement ? "run_completed" : "credential_missing");
    expect(db.prepare("select status from runs").get()).toEqual({
      status: replacement ? "completed" : "failed"
    });
  }
);

it("preserves Provider lifecycle and uses the stored key after reopening; missing credentials reject before a run", async () => {
  const { root, db, credentialStore, reopen } = fixture();
  const authStorage = AuthStorage.inMemory();
  const options = {
    db,
    credentialStore,
    authStorage,
    agentClient: new FakeAgentClient()
  };
  let app = createApp(options);
  const provider = await (
    await json(app, "/providers", { name: "OpenAI", apiKey: "original", defaultModel: "gpt-4o" })
  ).json();
  const url = `/providers/${provider.id}`;
  expect((await json(app, url, { apiKey: "replacement" }, "PATCH")).status).toBe(200);
  expect((await json(app, url, { enabled: false }, "PATCH")).status).toBe(200);
  expect(credentialStore.read(provider.apiKeyRef)).toBe("replacement");
  expect((await json(app, url, { enabled: true }, "PATCH")).status).toBe(200);
  const reopenedAuth = AuthStorage.inMemory();
  app = createApp({ ...options, db: reopen(), authStorage: reopenedAuth });
  expect(await reopenedAuth.getApiKey("openai")).toBe("replacement");
  const workspace = await (await json(app, "/workspaces", { name: "Test", rootDir: root })).json();
  const session = await (
    await json(app, "/sessions", { workspaceId: workspace.id, title: "Test" })
  ).json();
  const run = () =>
    json(app, `/sessions/${session.id}/runs`, { providerId: provider.id, message: "hello" });
  expect(await (await run()).text()).toContain("run_completed");
  credentialStore.delete(provider.apiKeyRef);
  expect((await run()).status).toBe(409);
  const probe = await json(app, `${url}/test`, {});
  expect(await probe.json()).toMatchObject({ ok: false, message: "credential_missing" });
  expect((await json(app, url, { apiKey: "repaired" }, "PATCH")).status).toBe(200);
  expect(await (await run()).text()).toContain("run_completed");
  expect((await app.request(url, { method: "DELETE" })).status).toBe(204);
  expect(credentialStore.read(provider.apiKeyRef)).toBeNull();
});

it("returns redacted credential failures and retains Provider data for retry", async () => {
  const { db, adapter, credentialStore } = fixture();
  const app = createApp({ db, credentialStore });
  adapter.failure = "set";
  const create = () =>
    json(app, "/providers", { name: "OpenAI", apiKey: "sensitive-value", defaultModel: "gpt-4o" });
  expect(await (await create()).json()).toEqual({ error: "credential_store_unavailable" });
  expect(await (await app.request("/providers")).json()).toEqual([]);
  adapter.failure = null;
  const provider = await (await create()).json();
  adapter.failure = "set";
  expect(
    (
      await json(
        app,
        `/providers/${provider.id}`,
        { name: "Changed", apiKey: "new-secret" },
        "PATCH"
      )
    ).status
  ).toBe(503);
  adapter.failure = "delete";
  expect((await app.request(`/providers/${provider.id}`, { method: "DELETE" })).status).toBe(503);
  adapter.failure = null;
  expect(credentialStore.read(provider.apiKeyRef)).toBe("sensitive-value");
  expect(await (await app.request("/providers")).json()).toMatchObject([{ name: "OpenAI" }]);
});

it("compensates credential writes when SQLite rejects create, update or delete", async () => {
  const { db, adapter, credentialStore } = fixture();
  const app = createApp({ db, credentialStore });
  const input = { name: "OpenAI", apiKey: "sensitive-value", defaultModel: "gpt-4o" };
  db.exec(
    "create trigger reject_create before insert on providers begin select raise(ABORT, 'sensitive-value'); end"
  );
  expect(await (await json(app, "/providers", input)).json()).toEqual({ error: "internal_error" });
  expect(adapter.values.size).toBe(0);
  db.exec("drop trigger reject_create");
  const provider = await (await json(app, "/providers", input)).json();
  db.exec(
    "create trigger reject_update before update on providers begin select raise(ABORT, 'failure'); end"
  );
  expect(
    (await json(app, `/providers/${provider.id}`, { apiKey: "replacement" }, "PATCH")).status
  ).toBe(500);
  expect(credentialStore.read(provider.apiKeyRef)).toBe("sensitive-value");
  db.exec("drop trigger reject_update");
  db.exec(
    "create trigger reject_delete before delete on providers begin select raise(ABORT, 'failure'); end"
  );
  expect((await app.request(`/providers/${provider.id}`, { method: "DELETE" })).status).toBe(500);
  expect(credentialStore.read(provider.apiKeyRef)).toBe("sensitive-value");
  expect(await (await app.request("/providers")).json()).toMatchObject([{ id: provider.id }]);
  db.exec("drop trigger reject_delete");
  expect((await app.request(`/providers/${provider.id}`, { method: "DELETE" })).status).toBe(204);
});

it("allows reopening settings when a migrated credential store is locked and recovers after unlock", async () => {
  const { db, adapter, credentialStore } = fixture();
  let app = createApp({ db, credentialStore });
  const provider = await (
    await json(app, "/providers", {
      name: "OpenAI",
      apiKey: "sensitive-value",
      defaultModel: "gpt-4o"
    })
  ).json();
  adapter.failure = "get";
  app = createApp({ db, credentialStore });
  expect((await app.request("/providers")).status).toBe(200);
  expect((await json(app, `/providers/${provider.id}/test`, {})).status).toBe(503);
  adapter.failure = null;
  expect(await (await json(app, `/providers/${provider.id}/test`, {})).json()).toMatchObject({
    ok: true
  });
});

it("does not expose model exception details in SSE or persisted run errors", async () => {
  const { root, db, credentialStore } = fixture();
  const agentClient = new FakeAgentClient();
  agentClient.prepare = async () => ({
    sessionFile: null,
    release() {},
    start() {
      throw new Error("sensitive-value rejected by provider");
    }
  });
  const app = createApp({
    db,
    credentialStore,
    agentClient
  });
  const provider = await (
    await json(app, "/providers", {
      name: "OpenAI",
      apiKey: "sensitive-value",
      defaultModel: "gpt-4o"
    })
  ).json();
  const workspace = await (await json(app, "/workspaces", { name: "Test", rootDir: root })).json();
  const session = await (
    await json(app, "/sessions", { workspaceId: workspace.id, title: "Test" })
  ).json();
  const result = await json(app, `/sessions/${session.id}/runs`, {
    providerId: provider.id,
    message: "hello"
  });
  const text = await result.text();
  expect(text).toContain("run_failed");
  expect(text).not.toContain("sensitive-value");
  expect(JSON.stringify(db.prepare("select * from runs").all())).not.toContain("sensitive-value");
});
