import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp as createApp } from "./test-app.js";
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
  it("lists previewable text and media files while ignoring protected and oversized files", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Note");
    writeFileSync(path.join(root, "docs/large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, "a"));
    writeFileSync(path.join(root, "docs/image.png"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root, "docs/report.docx"), Buffer.from([80, 75, 3, 4]));
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "ignored");
    writeFileSync(path.join(root, ".git/config"), "ignored");

    expect(listWorkspaceFiles(root)).toEqual([
      { path: "docs/image.png", name: "image.png", kind: "file" },
      { path: "docs/note.md", name: "note.md", kind: "file" },
      { path: "docs/report.docx", name: "report.docx", kind: "file" }
    ]);
  });

  it("searches file names and text with empty query returning candidates", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "alpha beta");

    await expect(searchWorkspaceFiles(root, "note")).resolves.toEqual([
      { path: "docs/note.md", match: "name" }
    ]);
    await expect(searchWorkspaceFiles(root, "beta")).resolves.toEqual([
      { path: "docs/note.md", match: "content" }
    ]);
    await expect(searchWorkspaceFiles(root, "")).resolves.toEqual([
      { path: "docs/note.md", match: "name" }
    ]);
  });
});

describe("document reader routes and tools", () => {
  it("reads text previews with CodePilot-style metadata and media as raw-only metadata", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "note.md"), "# Title");
    writeFileSync(path.join(root, "plain.txt"), "plain text");
    writeFileSync(path.join(root, "paper.pdf"), "%PDF-1.4\nPDF text");
    writeFileSync(path.join(root, "report.docx"), Buffer.from([80, 75, 3, 4]));

    await expect(readDocument(root, "note.md")).resolves.toMatchObject({
      path: "note.md",
      mime: "text/markdown",
      text: "# Title",
      language: "markdown",
      lineCount: 1,
      lineCountExact: true,
      truncated: false,
      bytesTotal: 7
    });
    await expect(readDocument(root, "plain.txt")).resolves.toMatchObject({
      path: "plain.txt",
      mime: "text/plain",
      text: "plain text",
      language: "plaintext"
    });
    await expect(readDocument(root, "paper.pdf")).resolves.toMatchObject({
      path: "paper.pdf",
      mime: "application/pdf",
      text: "",
      language: "pdf",
      rawOnly: true
    });
    await expect(readDocument(root, "report.docx")).resolves.toMatchObject({
      path: "report.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: "",
      language: "word",
      rawOnly: true
    });
  });

  it("rejects oversized and non-media binary files for text preview", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "binary.txt"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root, "large.txt"), Buffer.alloc(10 * 1024 * 1024 + 1, "a"));

    await expect(readDocument(root, "binary.txt")).rejects.toMatchObject({
      code: "binary_not_previewable"
    });
    await expect(readDocument(root, "large.txt")).rejects.toMatchObject({
      code: "file_too_large"
    });
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
    expect(
      await (await app.request(`/workspaces/${workspace.id}/files/content?path=note.md`)).json()
    ).toMatchObject({
      path: "note.md",
      text: "# Title"
    });
    expect(
      await (await app.request(`/workspaces/${workspace.id}/files/search?q=Title`)).json()
    ).toEqual([{ path: "note.md", match: "content" }]);

    const outside = await app.request(`/workspaces/${workspace.id}/files/content?path=../secret`);
    expect(outside.status).toBe(403);
    expect(await outside.json()).toEqual({ error: "Path escapes workspace" });
  });

  it("serves raw PDFs inline and keeps raw file access sandboxed", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "paper.pdf"), "%PDF-1.4\nPDF text");
    writeFileSync(path.join(root, "note.md"), "# Title");
    writeFileSync(path.join(root, "report.docx"), Buffer.from([80, 75, 3, 4]));
    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const app = createApp({ db });

    const pdf = await app.request(`/workspaces/${workspace.id}/files/raw?path=paper.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(await pdf.text()).toContain("%PDF-1.4");

    const text = await app.request(`/workspaces/${workspace.id}/files/raw?path=note.md`);
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toBe("text/markdown");
    expect(await text.text()).toBe("# Title");

    const docx = await app.request(`/workspaces/${workspace.id}/files/raw?path=report.docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    const outside = await app.request(`/workspaces/${workspace.id}/files/raw?path=../secret.pdf`);
    expect(outside.status).toBe(403);
    expect(await outside.json()).toEqual({ error: "Path escapes workspace" });
  });

  it("exposes document tools with stable shapes", async () => {
    const root = tempRoot();
    writeFileSync(path.join(root, "note.md"), "# Title");
    const tools = createDocumentTools(root);

    await expect(tools.list_files()).resolves.toEqual([
      { path: "note.md", name: "note.md", kind: "file" }
    ]);
    await expect(tools.read_document({ path: "note.md" })).resolves.toMatchObject({
      path: "note.md",
      text: "# Title"
    });
    await expect(tools.search_files({ q: "Title" })).resolves.toEqual([
      { path: "note.md", match: "content" }
    ]);
  });
});
