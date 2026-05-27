import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createWorkspace } from "../src/db/repositories.js";
import { migrate } from "../src/db/migrations.js";
import { createDocumentTools } from "../src/agent/document-tools.js";
import { readDocument } from "../src/files/document-reader.js";
import { listWorkspaceFiles, searchWorkspaceFiles } from "../src/files/file-tree.js";
import { resolveWorkspacePath } from "../src/files/path-sandbox.js";

const roots: string[] = [];
const dbs: Database.Database[] = [];

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "marginalia-files-"));
  roots.push(root);
  return root;
}

function memoryDb() {
  const db = new Database(":memory:");
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});

describe("resolveWorkspacePath", () => {
  it("resolves relative paths inside workspace", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Note");
    expect(resolveWorkspacePath(root, "docs/note.md")).toBe(path.join(root, "docs/note.md"));
  });

  it("rejects paths outside workspace", () => {
    const root = tempRoot();
    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow("Path escapes workspace");
    expect(() => resolveWorkspacePath(root, "/etc/passwd")).toThrow("Path escapes workspace");
  });

  it("rejects symlinks that resolve outside the workspace", () => {
    const root = tempRoot();
    const outside = tempRoot();
    symlinkSync(outside, path.join(root, "linked"), "dir");
    expect(() => resolveWorkspacePath(root, "linked")).toThrow("Path escapes workspace");
  });

  it("returns the candidate path for inside-workspace paths that do not exist yet", () => {
    const root = tempRoot();
    expect(resolveWorkspacePath(root, "docs/missing.md")).toBe(path.join(root, "docs/missing.md"));
  });
});

describe("workspace files", () => {
  it("lists files and ignores node_modules git large and binary files", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Note");
    writeFileSync(path.join(root, "docs/large.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, "a"));
    writeFileSync(path.join(root, "docs/image.png"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "ignored");
    writeFileSync(path.join(root, ".git/config"), "ignored");

    expect(listWorkspaceFiles(root)).toEqual([{ path: "docs/note.md", name: "note.md", kind: "file" }]);
  });

  it("searches file names and text with empty query returning candidates", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "alpha beta");

    await expect(searchWorkspaceFiles(root, "note")).resolves.toEqual([{ path: "docs/note.md", match: "name" }]);
    await expect(searchWorkspaceFiles(root, "beta")).resolves.toEqual([{ path: "docs/note.md", match: "content" }]);
    await expect(searchWorkspaceFiles(root, "")).resolves.toEqual([{ path: "docs/note.md", match: "name" }]);
  });
});

describe("document reader routes and tools", () => {
  it("reads markdown txt and pdf-like documents with stable shape", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "note.md"), "# Title");
    writeFileSync(path.join(root, "plain.txt"), "plain text");
    writeFileSync(path.join(root, "paper.pdf"), "%PDF-1.4\nPDF text");

    await expect(readDocument(root, "note.md")).resolves.toMatchObject({ path: "note.md", mime: "text/markdown", text: "# Title" });
    await expect(readDocument(root, "plain.txt")).resolves.toMatchObject({ path: "plain.txt", mime: "text/plain", text: "plain text" });
    await expect(readDocument(root, "paper.pdf")).resolves.toMatchObject({ path: "paper.pdf", mime: "application/pdf", pages: expect.any(Number) });
  });

  it("serves file APIs and rejects outside paths without leaking local paths", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "note.md"), "# Title");
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const app = createApp({ db });

    expect(await (await app.request(`/workspaces/${workspace.id}/files`)).json()).toEqual([
      { path: "note.md", name: "note.md", kind: "file" }
    ]);
    expect(await (await app.request(`/workspaces/${workspace.id}/files/content?path=note.md`)).json()).toMatchObject({
      path: "note.md",
      text: "# Title"
    });
    expect(await (await app.request(`/workspaces/${workspace.id}/files/search?q=Title`)).json()).toEqual([
      { path: "note.md", match: "content" }
    ]);

    const outside = await app.request(`/workspaces/${workspace.id}/files/content?path=../secret`);
    expect(outside.status).toBe(403);
    expect(await outside.json()).toEqual({ error: "Path escapes workspace" });
  });

  it("exposes document tools with stable shapes", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "note.md"), "# Title");
    const tools = createDocumentTools(root);

    await expect(tools.list_files()).resolves.toEqual([{ path: "note.md", name: "note.md", kind: "file" }]);
    await expect(tools.read_document({ path: "note.md" })).resolves.toMatchObject({ path: "note.md", text: "# Title" });
    await expect(tools.search_files({ q: "Title" })).resolves.toEqual([{ path: "note.md", match: "content" }]);
  });
});
