import fs, { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp as createApp } from "./test-app.js";
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
    const conflict = await put(app, ws.id, { path: "a.md", content: "new" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "file exists" });
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

it("rejects absolute workspace paths and in-workspace symlink parents without writing", async () => {
  const { app, ws, root } = setup();
  writeFileSync(path.join(root, "a.md"), "original");
  symlinkSync(root, path.join(root, "alias"), "dir");
  for (const target of [path.join(root, "a.md"), "alias/a.md"]) {
    const response = await put(app, ws.id, { path: target, content: "changed", overwrite: true });
    expect(response.status).toBe(403);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("original");
  }
});

it("accepts Windows relative separators through the file API", async () => {
  const { app, ws, root } = setup();
  const response = await put(app, ws.id, { path: "docs\\note.md", content: "portable" });
  expect(response.status).toBe(201);
  expect(readFileSync(path.join(root, "docs/note.md"), "utf8")).toBe("portable");
});

it("accepts alternate casing when the filesystem identifies the same file", async () => {
  const { app, ws, root } = setup();
  writeFileSync(path.join(root, "Readme.md"), "original");
  if (!existsSync(path.join(root, "README.md"))) return;
  const response = await put(app, ws.id, {
    path: "README.md",
    content: "updated",
    overwrite: true
  });
  expect(response.status).toBe(200);
  expect(readFileSync(path.join(root, "Readme.md"), "utf8")).toBe("updated");
});

it("never overwrites a competing create-only request", async () => {
  const { app, ws, root } = setup();
  const responses = await Promise.all(
    ["first", "second"].map((content) => put(app, ws.id, { path: "race.md", content }))
  );
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const winner = responses[0]!.status === 201 ? "first" : "second";
  expect(readFileSync(path.join(root, "race.md"), "utf8")).toBe(winner);
});

it("keeps the original file and removes staging bytes after an IO failure", async () => {
  const { app, ws, root } = setup();
  writeFileSync(path.join(root, "a.md"), "original");
  const realWrite = fs.write;
  let writes = 0;
  const fail = vi.spyOn(fs, "write").mockImplementation(((...args: unknown[]) => {
    if (writes++ === 0) {
      args[3] = 3;
      return Reflect.apply(realWrite, fs, args);
    }
    const callback = args[args.length - 1] as (error: Error) => void;
    callback(Object.assign(new Error("injected disk failure"), { code: "ENOSPC" }));
  }) as typeof fs.write);
  try {
    const response = await put(app, ws.id, {
      path: "a.md",
      content: "replacement",
      overwrite: true
    });
    expect(response.status).toBe(500);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("original");
    expect(fs.readdirSync(root)).toEqual(["a.md"]);
  } finally {
    fail.mockRestore();
    expect(fs.write).toBe(realWrite);
  }
  const retry = await put(app, ws.id, { path: "a.md", content: "retry", overwrite: true });
  expect(retry.status).toBe(200);
});

it("rejects a parent swap during staging without touching the outside target", async () => {
  const { app, ws, root } = setup();
  const outside = mkdtempSync(path.join(os.tmpdir(), "workspace-outside-"));
  fs.mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs/a.md"), "inside");
  writeFileSync(path.join(outside, "a.md"), "outside");
  const realWrite = fs.write;
  let swapped = false;
  const race = vi.spyOn(fs, "write").mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as (...result: unknown[]) => void;
    args[args.length - 1] = (...result: unknown[]) => {
      if (!swapped) {
        swapped = true;
        fs.renameSync(path.join(root, "docs"), path.join(root, "old-docs"));
        symlinkSync(outside, path.join(root, "docs"), "dir");
      }
      callback(...result);
    };
    return Reflect.apply(realWrite, fs, args);
  }) as typeof fs.write);
  try {
    const response = await put(app, ws.id, {
      path: "docs/a.md",
      content: "replacement",
      overwrite: true
    });
    expect(swapped).toBe(true);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("outside");
    expect(readFileSync(path.join(root, "old-docs/a.md"), "utf8")).toBe("inside");
    expect(fs.readdirSync(path.join(root, "old-docs"))).toEqual(["a.md"]);
  } finally {
    race.mockRestore();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

it("respects a private process umask when publishing a new file", async () => {
  if (process.platform === "win32") return;
  const { app, ws, root } = setup();
  const previous = process.umask(0o077);
  try {
    expect((await put(app, ws.id, { path: "private.md", content: "private" })).status).toBe(201);
    expect(fs.statSync(path.join(root, "private.md")).mode & 0o777).toBe(0o600);
  } finally {
    process.umask(previous);
  }
});
