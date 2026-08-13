import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { createWorkspace } from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const root = mkdtempSync(path.join(os.tmpdir(), "files-write-"));
  const ws = createWorkspace(db, { name: "W", rootDir: root });
  return { app: createApp({ db }), ws, root };
}

function put(app: ReturnType<typeof createApp>, wsId: string, body: unknown) {
  return app.request(`/workspaces/${wsId}/files/content`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

describe("PUT /workspaces/:id/files/content", () => {
  it("creates a new file with parent dirs (201)", async () => {
    const { app, ws, root } = setup();
    const res = await put(app, ws.id, { path: "notes/结论.md", content: "# 结论\n" });
    expect(res.status).toBe(201);
    expect(readFileSync(path.join(root, "notes/结论.md"), "utf8")).toBe("# 结论\n");
  });

  it("rejects an existing target without overwrite (409), overwrites with the flag (200)", async () => {
    const { app, ws, root } = setup();
    writeFileSync(path.join(root, "a.md"), "old");
    expect((await put(app, ws.id, { path: "a.md", content: "new" })).status).toBe(409);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("old");
    const ok = await put(app, ws.id, { path: "a.md", content: "new", overwrite: true });
    expect(ok.status).toBe(200);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("new");
  });

  it("blocks path escapes (403) and unknown workspaces (404)", async () => {
    const { app, ws } = setup();
    expect((await put(app, ws.id, { path: "../out.md", content: "x" })).status).toBe(403);
    expect((await put(app, "nope", { path: "a.md", content: "x" })).status).toBe(404);
  });

  it("blocks new files beneath a symlinked parent outside the workspace", async () => {
    const { app, ws, root } = setup();
    const outside = mkdtempSync(path.join(os.tmpdir(), "files-write-outside-"));
    symlinkSync(outside, path.join(root, "linked"), "dir");

    const res = await put(app, ws.id, { path: "linked/new.md", content: "outside" });

    expect(res.status).toBe(403);
    expect(existsSync(path.join(outside, "new.md"))).toBe(false);
  });
});
