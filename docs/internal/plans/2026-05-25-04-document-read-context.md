# 文档读取与上下文实现计划

> **给 agentic worker：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 加入第一个文档读取闭环：浏览 workspace 文件、预览 Markdown/txt/PDF、用 `@` 附加文件，并把选中文档文本加入 chat run。

**架构：** pi-server 负责所有文件系统访问，并在 `workspace.root_dir` 下执行路径沙箱。Renderer 向 server 请求文件树、内容和搜索结果，再把选中的 context files 传给 chat run API。Server 在调用模型前把文档文本整理成结构化上下文交给 agent。

**技术栈：** TypeScript、Node fs/path、Hono、React、Vitest、pdf-parse、Testing Library。

---

## 文件结构

- 新建：`apps/pi-server/src/files/path-sandbox.ts` — workspace 相对路径校验。
- 新建：`apps/pi-server/src/files/file-tree.ts` — 带忽略规则的递归文件列表。
- 新建：`apps/pi-server/src/files/document-reader.ts` — Markdown/txt/PDF 文本提取。
- 新建：`apps/pi-server/src/agent/document-tools.ts` — agent 可调用的 `list_files`、`read_document`、`search_files` 工具合约。
- 新建：`apps/pi-server/src/routes/files.ts` — file tree/content/search API。
- 修改：`apps/pi-server/src/routes/runs.ts` — 接收 `contextFiles`。
- 修改：`apps/pi-server/src/app.ts` — 注册 file routes。
- 新建：`apps/pi-server/test/files.test.ts` — 文件系统和 route 测试。
- 修改：`apps/desktop/src/api/client.ts` — file APIs 和 run 中的 `contextFiles`。
- 新建：`apps/desktop/src/documents/DocumentPanel.tsx` — 右侧文档面板。
- 新建：`apps/desktop/src/documents/DocumentPanel.test.tsx` — panel 测试。
- 修改：`apps/desktop/src/chat/ChatView.tsx` — `@文件` selector 和已选 context chips。
- 修改：`apps/desktop/src/workspaces/WorkspaceShell.tsx` — 挂载 DocumentPanel 并把 attached files 传给 ChatView。

## 前置 Gate

执行本计划前必须确认第 01、02、03 份 spec/plan 的闭环已经落地，否则没有可用 workspace、session、provider run 和 ChatView。

```bash
test -f apps/pi-server/src/routes/runs.ts
test -f apps/desktop/src/chat/ChatView.tsx
pnpm --filter @marginalia/pi-server test -- health.test.ts workspace-session.test.ts provider-chat.test.ts
pnpm --filter @marginalia/desktop test -- App.test.tsx WorkspaceShell.test.tsx ChatView.test.tsx
```

预期：全部以 0 退出。失败时先回到前 3 份 plan 修复。

## TDD 覆盖矩阵

| 功能点 | 先写的失败测试 | 通过标准 |
| --- | --- | --- |
| 路径沙箱 | `files.test.ts` | 拒绝 `..`、绝对路径和 symlink escape。 |
| 文件树/搜索 | `files.test.ts` | 忽略 `.git`、`node_modules`、大文件和二进制；空 query 返回文件候选。 |
| 文档读取 | `files.test.ts` | Markdown/txt/PDF 返回 `{ path, mime, text, pages?, truncated }`，长文本会截断。 |
| 文件 routes | `files.test.ts` | workspace 外路径返回 403/400，不泄漏本机路径。 |
| agent tools | `files.test.ts` | `list_files`、`read_document`、`search_files` 返回稳定 shape。 |
| run context | `provider-chat.test.ts` | `contextFiles` 注入 agent prompt，同时工具可用。 |
| DocumentPanel wiring | `DocumentPanel.test.tsx` + `WorkspaceShell.test.tsx` | Panel 挂进 workspace shell，Attach to chat 会进入 ChatView chips。 |
| `@` 文件选择 | `ChatView.test.tsx` | 裸 `@` 有候选；chip 可点击打开 Reader；发送时透传 `contextFiles`。 |

## 任务 1：路径沙箱

**文件：**
- 新建：`apps/pi-server/src/files/path-sandbox.ts`
- 新建：`apps/pi-server/test/files.test.ts`

- [ ] **步骤 1：编写预期失败的路径沙箱测试**

```ts
// apps/pi-server/test/files.test.ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/files/path-sandbox.js";

const roots: string[] = [];
const dbs: Database.Database[] = [];

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "marginalia-files-"));
  roots.push(root);
  return root;
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
    // 没有 ENOENT，调用方 (route/file-tree) 自己负责区分 'inside but missing' (404)
    // 与 'outside workspace' (403)
    expect(resolveWorkspacePath(root, "docs/missing.md")).toBe(path.join(root, "docs/missing.md"));
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：FAIL，提示缺少路径沙箱模块。

- [ ] **步骤 3：实现路径沙箱**

```ts
// apps/pi-server/src/files/path-sandbox.ts
import { realpathSync } from "node:fs";
import path from "node:path";

export function resolveWorkspacePath(rootDir: string, requestedPath: string) {
  const root = realpathSync.native(rootDir);
  const candidate = path.resolve(root, requestedPath);
  const candidateRelative = path.relative(root, candidate);

  if (candidateRelative.startsWith("..") || path.isAbsolute(candidateRelative)) {
    throw new Error("Path escapes workspace");
  }

  // realpath 对不存在的路径会抛 ENOENT，需要单独处理：
  // - 路径不存在：用 candidate 做 symlink 沙箱检查（candidate 已经过 `..` 校验）
  // - 路径存在但解析到 workspace 外（symlink escape）：抛 Path escapes
  let target: string;
  try {
    target = realpathSync.native(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return candidate;
    throw err;
  }

  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace");
  }

  return target;
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add apps/pi-server/src/files/path-sandbox.ts apps/pi-server/test/files.test.ts
git commit -m "feat: add workspace path sandbox"
```

## 任务 2：文件树和搜索

**文件：**
- 新建：`apps/pi-server/src/files/file-tree.ts`
- 修改：`apps/pi-server/test/files.test.ts`

- [ ] **步骤 1：添加文件树测试**

追加：

```ts
import { listWorkspaceFiles, searchWorkspaceFiles } from "../src/files/file-tree.js";

describe("workspace files", () => {
  it("lists files and ignores node_modules and .git", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Note");
    writeFileSync(path.join(root, "node_modules/pkg/index.js"), "ignored");
    writeFileSync(path.join(root, ".git/config"), "ignored");

    expect(listWorkspaceFiles(root)).toEqual([{ path: "docs/note.md", name: "note.md", kind: "file" }]);
  });

  it("searches file names and text", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "alpha beta");

    await expect(searchWorkspaceFiles(root, "note")).resolves.toEqual([{ path: "docs/note.md", match: "name" }]);
    await expect(searchWorkspaceFiles(root, "beta")).resolves.toEqual([{ path: "docs/note.md", match: "content" }]);
    await expect(searchWorkspaceFiles(root, "")).resolves.toEqual([{ path: "docs/note.md", match: "name" }]);
  });

  it("skips large and binary files in lists and search", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "alpha beta");
    writeFileSync(path.join(root, "docs/large.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, "a"));
    writeFileSync(path.join(root, "docs/image.png"), Buffer.from([0, 1, 2, 3]));

    expect(listWorkspaceFiles(root)).toEqual([{ path: "docs/note.md", name: "note.md", kind: "file" }]);
    await expect(searchWorkspaceFiles(root, "alpha")).resolves.toEqual([{ path: "docs/note.md", match: "content" }]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：FAIL，提示缺少文件树模块。

- [ ] **步骤 3：实现文件树和搜索**

```ts
// apps/pi-server/src/files/file-tree.ts
// 注意：PDF 搜索功能通过动态 import("./document-reader.js") 引入，
// 这样 Task 2（先构建 file-tree）的实现不依赖 Task 3 的 document-reader。
// 当用户搜到 PDF 内容时才会触发解析。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "./path-sandbox.js";

const ignored = new Set([".git", "node_modules"]);
const textExtensions = new Set([".md", ".txt"]);
const pdfExtension = ".pdf";
const readableExtensions = new Set([".md", ".txt", ".pdf"]);
const maxReadableBytes = 5 * 1024 * 1024;

export type FileEntry = { path: string; name: string; kind: "file" };
export type SearchResult = { path: string; match: "name" | "content" };

export function listWorkspaceFiles(rootDir: string): FileEntry[] {
  const results: FileEntry[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const relativePath = path.relative(rootDir, absolute);
        if (!isReadableFile(rootDir, relativePath)) continue;
        results.push({
          path: relativePath,
          name: entry.name,
          kind: "file"
        });
      }
    }
  }

  walk(rootDir);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

// 搜索时 PDF 内容也参与匹配，但要异步（pdf-parse 是 async）。失败时静默回落到仅文件名匹配。
export async function searchWorkspaceFiles(rootDir: string, query: string): Promise<SearchResult[]> {
  const normalized = query.toLowerCase();
  const files = listWorkspaceFiles(rootDir);
  if (!normalized) return files.map((file) => ({ path: file.path, match: "name" as const }));

  const results: SearchResult[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().includes(normalized)) {
      results.push({ path: file.path, match: "name" });
      continue;
    }
    const ext = path.extname(file.path).toLowerCase();
    if (textExtensions.has(ext)) {
      const content = readFileSync(path.join(rootDir, file.path), "utf8").toLowerCase();
      if (content.includes(normalized)) results.push({ path: file.path, match: "content" });
    } else if (ext === pdfExtension) {
      try {
        // 动态 import 让 Task 2 不依赖 Task 3 的 document-reader 文件存在
        const { extractPdfText } = await import("./document-reader.js");
        const text = await extractPdfText(path.join(rootDir, file.path));
        if (text.toLowerCase().includes(normalized)) results.push({ path: file.path, match: "content" });
      } catch {
        // PDF 解析失败或 document-reader 尚未就绪时静默忽略（仅文件名匹配）
      }
    }
  }
  return results;
}

export function isReadableFile(rootDir: string, relativePath: string) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!readableExtensions.has(ext)) return false;
  const stats = statSync(resolveWorkspacePath(rootDir, relativePath));
  return stats.isFile() && stats.size <= maxReadableBytes;
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add apps/pi-server/src/files/file-tree.ts apps/pi-server/test/files.test.ts
git commit -m "feat: list and search workspace files"
```

## 任务 3：文档读取器

**文件：**
- 新建：`apps/pi-server/src/files/document-reader.ts`
- 修改：`apps/pi-server/test/files.test.ts`

- [ ] **步骤 1：添加依赖**

运行：

```bash
pnpm add --filter @marginalia/pi-server pdf-parse
pnpm add -D --filter @marginalia/pi-server @types/pdf-parse pdfkit
```

预期：安装 PDF parser 和测试用 PDF generator。

- [ ] **步骤 2：添加文档读取器测试**

追加：

```ts
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync as mkdir, writeFileSync as writeFile } from "node:fs";
import { readDocument } from "../src/files/document-reader.js";

function writeSamplePdf(filePath: string, text: string) {
  return new Promise<void>((resolve) => {
    const doc = new PDFDocument();
    doc.pipe(createWriteStream(filePath));
    doc.text(text);
    doc.end();
    doc.on("end", resolve);
  });
}

describe("readDocument", () => {
  it("reads markdown and text documents", async () => {
    const root = tempRoot();
    mkdir(path.join(root, "docs"), { recursive: true });
    writeFile(path.join(root, "docs/note.md"), "# Hello");
    writeFile(path.join(root, "docs/plain.txt"), "Plain text");

    await expect(readDocument(root, "docs/note.md")).resolves.toMatchObject({ path: "docs/note.md", mime: "text/markdown", text: "# Hello" });
    await expect(readDocument(root, "docs/plain.txt")).resolves.toMatchObject({ path: "docs/plain.txt", mime: "text/plain", text: "Plain text" });
  });

  it("reads pdf text", async () => {
    const root = tempRoot();
    mkdir(path.join(root, "docs"), { recursive: true });
    await writeSamplePdf(path.join(root, "docs/sample.pdf"), "PDF hello");

    const result = await readDocument(root, "docs/sample.pdf");

    expect(result.mime).toBe("application/pdf");
    expect(result.text).toContain("PDF hello");
    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(false);
  });

  it("truncates very long text documents", async () => {
    const root = tempRoot();
    mkdir(path.join(root, "docs"), { recursive: true });
    writeFile(path.join(root, "docs/long.txt"), "a".repeat(70_000));

    const result = await readDocument(root, "docs/long.txt");

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(60_000);
  });
});
```

- [ ] **步骤 3：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：FAIL，提示缺少文档读取器。

- [ ] **步骤 4：实现读取器**

```ts
// apps/pi-server/src/files/document-reader.ts
import { readFileSync } from "node:fs";
import path from "node:path";
// 直接从 lib/pdf-parse.js 导入，绕过 pdf-parse 顶层 entry 的
// `test/05-versions-space.pdf` 自检（pnpm 符号链接环境下该文件常常缺失，
// 顶层 import 会在加载时抛 ENOENT）。
import pdf from "pdf-parse/lib/pdf-parse.js";
import { resolveWorkspacePath } from "./path-sandbox.js";

const maxDocumentChars = 60_000;

function truncateText(text: string) {
  return text.length > maxDocumentChars
    ? { text: text.slice(0, maxDocumentChars), truncated: true }
    : { text, truncated: false };
}

export type DocumentContent = {
  path: string;
  mime: string;
  text: string;
  pages?: number;
  truncated: boolean;
};

// 供 file-tree 搜索 PDF 内容时复用，只返回文本（不做截断、不带 mime）。
export async function extractPdfText(absolutePath: string): Promise<string> {
  const parsed = await pdf(readFileSync(absolutePath));
  return parsed.text;
}

export async function readDocument(rootDir: string, relativePath: string): Promise<DocumentContent> {
  const absolute = resolveWorkspacePath(rootDir, relativePath);
  const ext = path.extname(relativePath).toLowerCase();

  if (ext === ".md") {
    return { path: relativePath, mime: "text/markdown", ...truncateText(readFileSync(absolute, "utf8")) };
  }

  if (ext === ".txt") {
    return { path: relativePath, mime: "text/plain", ...truncateText(readFileSync(absolute, "utf8")) };
  }

  if (ext === ".pdf") {
    const parsed = await pdf(readFileSync(absolute));
    return { path: relativePath, mime: "application/pdf", ...truncateText(parsed.text), pages: parsed.numpages };
  }

  throw new Error(`Unsupported document type: ${ext}`);
}
```

- [ ] **步骤 5：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add apps/pi-server/src/files apps/pi-server/test/files.test.ts package.json pnpm-lock.yaml
git commit -m "feat: read workspace documents"
```

## 任务 4：文件 routes

**文件：**
- 新建：`apps/pi-server/src/routes/files.ts`
- 修改：`apps/pi-server/src/app.ts`
- 修改：`apps/pi-server/test/files.test.ts`

- [ ] **步骤 1：添加 route 测试**

追加：

```ts
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { createWorkspace } from "../src/db/repositories.js";

describe("file routes", () => {
  it("serves file tree content and search for a workspace", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Alpha");

    const db = new Database(":memory:");
    dbs.push(db);
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const app = createApp({ db });

    expect(await (await app.request(`/workspaces/${workspace.id}/files`)).json()).toEqual([{ path: "docs/note.md", name: "note.md", kind: "file" }]);
    expect(await (await app.request(`/workspaces/${workspace.id}/files/content?path=docs/note.md`)).json()).toMatchObject({ text: "# Alpha" });
    expect(await (await app.request(`/workspaces/${workspace.id}/files/search?q=Alpha`)).json()).toEqual([{ path: "docs/note.md", match: "content" }]);
    expect(await (await app.request(`/workspaces/${workspace.id}/files/search?q=`)).json()).toEqual([{ path: "docs/note.md", match: "name" }]);
    // 注意：route 内部 await 了 searchWorkspaceFiles，所以这里直接对 JSON 做 toEqual 即可
  });

  it("rejects content paths outside the workspace", async () => {
    const root = tempRoot();
    const db = new Database(":memory:");
    dbs.push(db);
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const app = createApp({ db });

    const response = await app.request(`/workspaces/${workspace.id}/files/content?path=../secret.txt`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Path escapes workspace" });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：FAIL，文件 routes 返回 404。

- [ ] **步骤 3：添加 `getWorkspace` repository helper**

追加到 `repositories.ts`：

```ts
export function getWorkspace(db: Database.Database, id: string): Workspace | null {
  const row = db.prepare("select * from workspaces where id = ?").get(id);
  return row ? mapWorkspace(row) : null;
}
```

- [ ] **步骤 4：实现文件 routes**

```ts
// apps/pi-server/src/routes/files.ts
import { Hono } from "hono";
import type Database from "better-sqlite3";
import { getWorkspace } from "../db/repositories.js";
import { listWorkspaceFiles, searchWorkspaceFiles } from "../files/file-tree.js";
import { readDocument } from "../files/document-reader.js";

export function filesRoutes(db: Database.Database) {
  const app = new Hono();

  app.get("/:workspaceId/files", (c) => {
    const workspace = getWorkspace(db, c.req.param("workspaceId"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(listWorkspaceFiles(workspace.rootDir));
  });

  app.get("/:workspaceId/files/content", async (c) => {
    const workspace = getWorkspace(db, c.req.param("workspaceId"));
    const filePath = c.req.query("path");
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    if (!filePath) return c.json({ error: "path is required" }, 400);
    try {
      return c.json(await readDocument(workspace.rootDir, filePath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message = error instanceof Error ? error.message : "Unable to read file";
      if (message === "Path escapes workspace") return c.json({ error: message }, 403);
      if (code === "ENOENT") return c.json({ error: "file not found" }, 404);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/:workspaceId/files/search", async (c) => {
    const workspace = getWorkspace(db, c.req.param("workspaceId"));
    const q = c.req.query("q");
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(await searchWorkspaceFiles(workspace.rootDir, q ?? ""));
  });

  return app;
}
```

- [ ] **步骤 5：注册 routes**

在 `createApp` 中加入：

```ts
import { filesRoutes } from "./routes/files.js";

// inside if (options.db)
app.route("/workspaces", filesRoutes(options.db));
```

- [ ] **步骤 6：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add apps/pi-server/src apps/pi-server/test/files.test.ts
git commit -m "feat: add workspace file routes"
```

## 任务 5：Agent 文档工具合约

**文件：**
- 新建：`apps/pi-server/src/agent/document-tools.ts`
- 修改：`apps/pi-server/test/files.test.ts`

- [ ] **步骤 1：添加 agent tools 测试**

追加到 `files.test.ts`：

```ts
import { createDocumentTools } from "../src/agent/document-tools.js";

describe("document agent tools", () => {
  it("exposes list_files read_document and search_files with stable shapes", async () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "# Tool context");

    const tools = createDocumentTools(root);

    expect(await tools.list_files()).toEqual([{ path: "docs/note.md", name: "note.md", kind: "file" }]);
    await expect(tools.read_document({ path: "docs/note.md" })).resolves.toMatchObject({
      path: "docs/note.md",
      mime: "text/markdown",
      text: "# Tool context",
      truncated: false
    });
    await expect(tools.search_files({ query: "" })).resolves.toEqual([{ path: "docs/note.md", match: "name" }]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：FAIL，提示缺少 `document-tools`。

- [ ] **步骤 3：实现 document tools**

```ts
// apps/pi-server/src/agent/document-tools.ts
import { readDocument, type DocumentContent } from "../files/document-reader.js";
import { listWorkspaceFiles, searchWorkspaceFiles, type FileEntry, type SearchResult } from "../files/file-tree.js";

export type DocumentTools = {
  list_files: () => Promise<FileEntry[]>;
  read_document: (input: { path: string }) => Promise<DocumentContent>;
  search_files: (input: { query: string }) => Promise<SearchResult[]>;
};

export function createDocumentTools(rootDir: string): DocumentTools {
  return {
    list_files: async () => listWorkspaceFiles(rootDir),
    read_document: async ({ path }) => readDocument(rootDir, path),
    search_files: async ({ query }) => searchWorkspaceFiles(rootDir, query)
  };
}
```

- [ ] **步骤 4：运行测试**

运行：`pnpm --filter @marginalia/pi-server test -- files.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add apps/pi-server/src/agent/document-tools.ts apps/pi-server/test/files.test.ts
git commit -m "feat: add document agent tools"
```

## 任务 6：把上下文文件注入 Chat Run

**文件：**
- 修改：`apps/pi-server/src/routes/runs.ts`
- 修改：`apps/pi-server/test/provider-chat.test.ts`

- [ ] **步骤 1：添加 run context 测试**

追加到 `provider-chat.test.ts`：

```ts
describe("run context files", () => {
  it("adds selected document text to the agent prompt", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "marginalia-context-"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/note.md"), "Important context");

    const db = memoryDb();
    migrate(db);
    const workspace = createWorkspace(db, { name: "Docs", rootDir: root });
    const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });
    const provider = createProvider(db, { name: "openai", apiKey: "sk-test", defaultModel: "gpt-4o-mini" });
    const agent = new FakeAgentClient(["ok"]);
    const app = createApp({ db, agentClient: agent });

    await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, model: "gpt-4o-mini", content: "Use context", contextFiles: ["docs/note.md"] }),
      headers: { "content-type": "application/json" }
    });

    expect(agent.lastInput?.content).toContain("Important context");
    await expect(agent.lastInput?.documentTools?.read_document({ path: "docs/note.md" })).resolves.toMatchObject({
      path: "docs/note.md",
      mime: "text/markdown",
      text: "Important context",
      truncated: false
    });
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 2：给 fake agent 添加 `lastInput`**

```ts
// apps/pi-server/src/agent/fake-agent-client.ts
export class FakeAgentClient implements AgentClient {
  public lastInput: AgentRunInput | null = null;

  constructor(private readonly chunks: string[]) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    this.lastInput = input;
    let full = "";
    for (const chunk of this.chunks) {
      full += chunk;
      yield { type: "assistant_delta", text: chunk };
    }
    yield { type: "assistant_message", text: full };
  }
}
```

- [ ] **步骤 3：更新 run route 以读取上下文文件**

先在 `apps/pi-server/src/agent/agent-client.ts` 扩展 `AgentRunInput`：

```ts
import type { DocumentTools } from "./document-tools.js";

export type AgentRunInput = {
  sessionId: string;
  providerName: string;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  content: string;
  documentTools?: DocumentTools;
};
```

再在 `runs.ts` 中读取 `contextFiles?: string[]`，找到 session 所属 workspace，并把上下文前置到 prompt：

```ts
const body = await c.req.json<{ providerId: string; model: string; content: string; contextFiles?: string[] }>();
const sessionRow = db.prepare("select workspace_id from sessions where id = ?").get(sessionId) as { workspace_id: string } | undefined;
const workspace = sessionRow ? getWorkspace(db, sessionRow.workspace_id) : null;
let content = body.content;
const documentTools = workspace ? createDocumentTools(workspace.rootDir) : undefined;

if (workspace && body.contextFiles?.length) {
  const docs = await Promise.all(body.contextFiles.map((filePath) => readDocument(workspace.rootDir, filePath)));
  const context = docs.map((doc) => `File: ${doc.path}\n${doc.text}`).join("\n\n");
  content = `Use the following workspace context:\n\n${context}\n\nUser request:\n${body.content}`;
}
```

调用 `agentClient.run` 时传入 `content` 和 `documentTools`，不要传 `body.content`；持久化用户消息时仍保存原始 `body.content`。

- [ ] **步骤 4：添加 imports**

加入：

```ts
import { getWorkspace } from "../db/repositories.js";
import { createDocumentTools } from "../agent/document-tools.js";
import { readDocument } from "../files/document-reader.js";
```

- [ ] **步骤 5：运行测试**

运行：

```bash
pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts
pnpm --filter @marginalia/pi-server test -- files.test.ts
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add apps/pi-server/src apps/pi-server/test
git commit -m "feat: inject document context into chat runs"
```

## 任务 7：文档面板和 @ 文件选择器

**文件：**
- 修改：`apps/desktop/src/api/client.ts`
- 新建：`apps/desktop/src/documents/DocumentPanel.tsx`
- 新建：`apps/desktop/src/documents/DocumentPanel.test.tsx`
- 修改：`apps/desktop/src/chat/ChatView.tsx`

- [ ] **步骤 1：添加 DocumentPanel 测试**

```tsx
// apps/desktop/src/documents/DocumentPanel.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentPanel } from "./DocumentPanel";

describe("DocumentPanel", () => {
  it("lists files opens a document and attaches it to chat", async () => {
    const onAttach = vi.fn();
    const api = {
      listFiles: vi.fn().mockResolvedValue([{ path: "docs/note.md", name: "note.md", kind: "file" }]),
      readFile: vi.fn().mockResolvedValue({ path: "docs/note.md", mime: "text/markdown", text: "# Note", truncated: false })
    };

    render(<DocumentPanel api={api} workspaceId="w1" onAttach={onAttach} />);
    await userEvent.click(await screen.findByText("docs/note.md"));

    expect(await screen.findByText("# Note")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Attach to chat" }));
    expect(onAttach).toHaveBeenCalledWith("docs/note.md");
  });

  it("opens the document specified by initialPath without needing a click", async () => {
    const api = {
      listFiles: vi.fn().mockResolvedValue([{ path: "docs/note.md", name: "note.md", kind: "file" }]),
      readFile: vi.fn().mockResolvedValue({ path: "docs/note.md", mime: "text/markdown", text: "# From chip", truncated: false })
    };

    render(<DocumentPanel api={api} workspaceId="w1" initialPath="docs/note.md" onAttach={vi.fn()} />);

    expect(await screen.findByText("# From chip")).toBeInTheDocument();
    expect(api.readFile).toHaveBeenCalledWith("w1", "docs/note.md");
  });
});
```

追加到 `apps/desktop/src/workspaces/WorkspaceShell.test.tsx`：

```tsx
it("mounts the document panel and passes attached files into chat", async () => {
  const api = createApi({
    listWorkspaces: vi.fn().mockResolvedValue([{ id: "w1", name: "Docs", rootDir: "/tmp/docs" }]),
    listFiles: vi.fn().mockResolvedValue([{ path: "docs/note.md", name: "note.md", kind: "file" }]),
    readFile: vi.fn().mockResolvedValue({ path: "docs/note.md", mime: "text/markdown", text: "# Note", truncated: false }),
    listProviders: vi.fn().mockResolvedValue([{ id: "p1", name: "openai", defaultModel: "gpt-4o-mini" }]),
    runSession: vi.fn().mockImplementation(async function* () {
      yield { run_id: "r1", session_id: "s1", type: "run_completed", payload: {}, created_at: "2026-05-25T00:00:00.000Z" };
    })
  });

  render(<WorkspaceShell api={api} pickWorkspaceDirectory={vi.fn()} />);

  await userEvent.click(await screen.findByRole("button", { name: "Docs" }));
  await userEvent.click(await screen.findByRole("button", { name: "docs/note.md" }));
  await userEvent.click(await screen.findByRole("button", { name: "Attach to chat" }));

  expect(await screen.findByText("@docs/note.md")).toBeInTheDocument();
});
```

追加到 `apps/desktop/src/chat/ChatView.test.tsx`：

```tsx
it("suggests files for bare @, opens chips, and sends contextFiles", async () => {
  const api = {
    listMessages: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([{ id: "p1", name: "openai", defaultModel: "gpt-4o-mini" }]),
    searchFiles: vi.fn().mockResolvedValue([{ path: "docs/note.md", match: "name" }]),
    runSession: vi.fn().mockImplementation(async function* () {
      yield { run_id: "r1", session_id: "s1", type: "run_completed", payload: {}, created_at: "2026-05-25T00:00:00.000Z" };
    })
  };
  const onOpenDocument = vi.fn();

  render(<ChatView api={api} session={{ id: "s1", model: "gpt-4o-mini", workspaceId: "w1" }} onOpenDocument={onOpenDocument} />);

  await userEvent.type(await screen.findByLabelText("Message"), "@");
  await userEvent.click(await screen.findByRole("button", { name: "@docs/note.md" }));
  await userEvent.click(screen.getByText("@docs/note.md"));
  await userEvent.type(screen.getByLabelText("Message"), " summarize");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));

  expect(api.searchFiles).toHaveBeenCalledWith("w1", "");
  expect(onOpenDocument).toHaveBeenCalledWith("docs/note.md");
  expect(api.runSession).toHaveBeenCalledWith("s1", {
    providerId: "p1",
    model: "gpt-4o-mini",
    content: "@ summarize",
    contextFiles: ["docs/note.md"]
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @marginalia/desktop test -- DocumentPanel.test.tsx`

预期：FAIL，提示缺少 `DocumentPanel`。

- [ ] **步骤 3：扩展 API client**

在 `createApiClient` 内加入：

```ts
listFiles: (workspaceId: string) => request<any[]>(baseUrl, `/workspaces/${workspaceId}/files`),
readFile: (workspaceId: string, path: string) =>
  request<any>(baseUrl, `/workspaces/${workspaceId}/files/content?path=${encodeURIComponent(path)}`),
searchFiles: (workspaceId: string, q: string) =>
  request<any[]>(baseUrl, `/workspaces/${workspaceId}/files/search?q=${encodeURIComponent(q)}`)
```

更新 `runSession` 的输入类型，加入 `contextFiles?: string[]`，并在 JSON 中透传。

- [ ] **步骤 4：实现 DocumentPanel**

```tsx
// apps/desktop/src/documents/DocumentPanel.tsx
import { useEffect, useState } from "react";

type FileEntry = { path: string; name: string; kind: "file" };
type DocumentContent = { path: string; mime: string; text: string; pages?: number; truncated: boolean };

export function DocumentPanel({
  api,
  workspaceId,
  initialPath,
  onAttach
}: {
  api: any;
  workspaceId: string;
  initialPath?: string | null;
  onAttach: (path: string) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [document, setDocument] = useState<DocumentContent | null>(null);

  useEffect(() => {
    api.listFiles(workspaceId).then(setFiles);
  }, [api, workspaceId]);

  useEffect(() => {
    if (initialPath) open(initialPath);
  }, [initialPath]);

  async function open(path: string) {
    setDocument(await api.readFile(workspaceId, path));
  }

  return (
    <aside>
      <h2>Files</h2>
      {files.map((file) => (
        <button key={file.path} type="button" onClick={() => open(file.path)}>
          {file.path}
        </button>
      ))}
      {document && (
        <section>
          <button type="button" onClick={() => onAttach(document.path)}>Attach to chat</button>
          <pre>{document.text}</pre>
        </section>
      )}
    </aside>
  );
}
```

- [ ] **步骤 5：给 ChatView 添加选中文件上下文和 `@` 选择器**

把 `ChatView` props 扩展为 session 对象、初始附加文件和打开文档回调：

```ts
type Session = { id: string; model?: string | null; workspaceId?: string };

export function ChatView({
  api,
  session,
  attachedFiles = [],
  onOpenDocument
}: {
  api: any;
  session: Session;
  attachedFiles?: string[];
  onOpenDocument?: (path: string) => void;
}) {
  const [contextFiles, setContextFiles] = useState<string[]>(attachedFiles);
}
```

当 composer 中包含 `@` 时搜索文件。裸 `@` 必须调用 `searchFiles(workspaceId, "")`，用于展示候选：

```ts
async function updateContent(value: string) {
  setContent(value);
  const match = value.match(/@([^\s]*)$/);
  if (!match || !session.workspaceId) {
    setFileMatches([]);
    return;
  }
  setFileMatches(await api.searchFiles(session.workspaceId, match[1] ?? ""));
}
```

附加选中的文件，并避免重复：

```ts
function attachFile(path: string) {
  setContextFiles((current) => current.includes(path) ? current : [...current, path]);
  setFileMatches([]);
}
```

发送时把 `contextFiles` 透传给 run：

```ts
api.runSession(session.id, {
  providerId: provider.id,
  model: selectedModel,
  content: userContent,
  contextFiles
})
```

在 composer 上方渲染可点击 chips：

```tsx
{contextFiles.map((file) => (
  <button key={file} type="button" onClick={() => onOpenDocument?.(file)}>
    @{file}
  </button>
))}
```

在 composer 下方渲染文件匹配结果：

```tsx
{fileMatches.length > 0 && (
  <div>
    {fileMatches.map((file) => (
      <button key={file.path} type="button" onClick={() => attachFile(file.path)}>
        @{file.path}
      </button>
    ))}
  </div>
)}
```

- [ ] **步骤 5.1：把 DocumentPanel 挂入 WorkspaceShell**

> **类型扩展（必须）：** Plan 02 的 `WorkspaceShell` 通过 `Pick<ApiClient, ...>` 显式列举可用方法，因此需要在 `WorkspaceShell.tsx` 的 props 类型里追加 `"listFiles" | "readFile" | "searchFiles"`，否则 typecheck 会因 DocumentPanel 接收到的 `api` 缺少这些方法而失败。

```ts
api: Pick<
  ApiClient,
  | "listWorkspaces"
  | "createWorkspace"
  | "markWorkspaceOpened"
  | "listSessions"
  | "createSession"
  | "listMessages"
  | "createMessage"
  | "startQuickChat"
  | "listProviders"
  | "updateSession"
  | "runSession"
  | "listFiles"
  | "readFile"
  | "searchFiles"
>;
```

在 `WorkspaceShell.tsx` 中维护附加文件和 Reader 打开状态：

```tsx
const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
const [documentToOpen, setDocumentToOpen] = useState<string | null>(null);

function attachFile(path: string) {
  setAttachedFiles((current) => current.includes(path) ? current : [...current, path]);
}
```

在 active workspace 区域渲染：

```tsx
{activeWorkspace && (
  <DocumentPanel
    api={api}
    workspaceId={activeWorkspace.id}
    initialPath={documentToOpen}
    onAttach={attachFile}
  />
)}
{activeSession && (
  <ChatView
    api={api}
    session={{ ...activeSession, workspaceId: activeWorkspace?.id }}
    attachedFiles={attachedFiles}
    onOpenDocument={setDocumentToOpen}
  />
)}
```

- [ ] **步骤 6：运行测试**

运行：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server test
pnpm typecheck
```

预期：全部通过。

- [ ] **步骤 7：手动验证**

运行：`pnpm dev`

预期：创建一个 root 目录包含 `docs/note.md` 的 workspace，在右侧面板打开文件，附加到 chat，提问后看到 assistant 基于文件内容回答。

- [ ] **步骤 8：提交**

```bash
git add apps/desktop apps/pi-server package.json pnpm-lock.yaml
git commit -m "feat: add document reading context"
```

## 自检

- 规格覆盖：覆盖文件树、沙箱读取、Markdown/txt/PDF 提取、搜索、Reader panel、文件附加流程，以及文档上下文注入 chat。
- 占位符扫描：没有未指定 parser、route 或 UI 行为。
- 类型一致性：server route 名称与 API client 方法一致；`contextFiles` 在 renderer 和 server 中用法一致。
