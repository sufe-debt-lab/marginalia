import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";

it("rejects workspace reads without a process bearer", async () => {
  const db = new Database(":memory:");
  try {
    const app = createApp({
      db,
      authStorage: AuthStorage.inMemory(),
      loopbackAccess: {
        bearer: "boundary-test-secret",
        allowedOrigins: new Set(["null"])
      }
    });
    const response = await app.request("/workspaces", { headers: { origin: "null" } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  } finally {
    db.close();
  }
});

it("fails closed when the application is created without an access policy", async () => {
  const db = new Database(":memory:");
  try {
    const app = createApp({ db, authStorage: AuthStorage.inMemory() });
    const response = await app.request("/workspaces", { headers: { origin: "null" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_forbidden" });
  } finally {
    db.close();
  }
});

const protectedRoutes = [
  ["GET", "/skills"],
  ["PATCH", "/skills/state"],
  ["GET", "/skills/content"],
  ["GET", "/workspaces"],
  ["POST", "/workspaces"],
  ["PATCH", "/workspaces/w/open"],
  ["DELETE", "/workspaces/w"],
  ["GET", "/workspaces/w/sessions"],
  ["GET", "/workspaces/w/files"],
  ["GET", "/workspaces/w/files/content"],
  ["GET", "/workspaces/w/files/raw"],
  ["GET", "/workspaces/w/files/search"],
  ["PUT", "/workspaces/w/files/content"],
  ["POST", "/sessions"],
  ["PATCH", "/sessions/s"],
  ["GET", "/sessions/s/messages"],
  ["POST", "/sessions/s/messages"],
  ["POST", "/sessions/s/approvals/a"],
  ["GET", "/sessions/s/approvals"],
  ["POST", "/quick-chat"],
  ["GET", "/providers"],
  ["POST", "/providers"],
  ["POST", "/providers/p/test"],
  ["PATCH", "/providers/p"],
  ["DELETE", "/providers/p"],
  ["POST", "/sessions/s/runs"],
  ["POST", "/health"],
  ["GET", "/future-route"]
] as const;

it.each(protectedRoutes)(
  "protects %s %s before parsing input or accessing state",
  async (method, route) => {
    const db = new Database(":memory:");
    try {
      const app = createApp({
        db,
        authStorage: AuthStorage.inMemory(),
        loopbackAccess: {
          bearer: "boundary-test-secret",
          allowedOrigins: new Set(["null"])
        }
      });
      for (const [headers, status, error] of [
        [{ origin: "null" }, 401, "unauthorized"],
        [{ origin: "null", authorization: "Bearer wrong" }, 401, "unauthorized"],
        [
          { origin: "https://evil.example", authorization: "Bearer boundary-test-secret" },
          403,
          "origin_forbidden"
        ]
      ] as const) {
        const response = await app.request(route, { method, headers });
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error });
      }
    } finally {
      db.close();
    }
  }
);

it("preserves workspaces and local files across bearer rotation, rejecting stale credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "loopback-recovery-"));
  const dbPath = path.join(root, "state.sqlite");
  let db = new Database(dbPath);
  const start = (bearer: string) =>
    createApp({
      db,
      authStorage: AuthStorage.inMemory(),
      loopbackAccess: {
        bearer,
        allowedOrigins: new Set(["null"])
      }
    });
  const headers = (bearer: string) => ({
    origin: "null",
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json"
  });
  try {
    const first = start("first-process-secret");
    const created = await first.request("/workspaces", {
      method: "POST",
      headers: headers("first-process-secret"),
      body: JSON.stringify({ name: "Local documents", rootDir: root })
    });
    expect(created.status).toBe(201);
    const workspace = await created.json();
    writeFileSync(path.join(root, "note.md"), "# Local authority");
    const denied = await first.request(`/workspaces/${workspace.id}`, {
      method: "DELETE",
      headers: headers("wrong")
    });
    expect(denied.status).toBe(401);
    db.close();
    db = new Database(dbPath);
    const restarted = start("second-process-secret");
    expect(
      (await restarted.request("/workspaces", { headers: headers("first-process-secret") })).status
    ).toBe(401);
    const restored = await restarted.request("/workspaces", {
      headers: headers("second-process-secret")
    });
    expect(await restored.json()).toMatchObject([{ id: workspace.id, name: "Local documents" }]);
    const document = await restarted.request(`/workspaces/${workspace.id}/files/raw?path=note.md`, {
      headers: headers("second-process-secret")
    });
    expect(await document.text()).toBe("# Local authority");
    db.close();
    const databaseBytes = readFileSync(dbPath).toString();
    expect(databaseBytes).not.toContain("first-process-secret");
    expect(databaseBytes).not.toContain("second-process-secret");
  } finally {
    if (db.open) db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
