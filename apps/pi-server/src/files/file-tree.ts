import path from "node:path";
import { readableExtensions, textExtensions } from "./document-reader.js";
import { WorkspaceFiles } from "./workspace-files.js";

const maxReadableBytes = 10 * 1024 * 1024;

export type FileEntry = { path: string; name: string; kind: "file" };
export type SearchResult = { path: string; match: "name" | "content" };

export async function listWorkspaceFiles(rootDir: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const workspace = await WorkspaceFiles.open(rootDir);
  for await (const entry of workspace.walk()) {
    if (entry.kind !== "file" || entry.size > maxReadableBytes) continue;
    if (!readableExtensions.has(path.extname(entry.relativePath).toLowerCase())) continue;
    files.push({
      path: entry.relativePath,
      name: path.posix.basename(entry.relativePath),
      kind: "file"
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function searchWorkspaceFiles(
  rootDir: string,
  query: string
): Promise<SearchResult[]> {
  const normalized = query.trim().toLowerCase();
  const results: SearchResult[] = [];
  const workspace = await WorkspaceFiles.open(rootDir);

  for (const file of await listWorkspaceFiles(rootDir)) {
    if (!normalized || file.path.toLowerCase().includes(normalized)) {
      results.push({ path: file.path, match: "name" });
      continue;
    }
    if (textExtensions.has(path.extname(file.path).toLowerCase())) {
      const text = (await workspace.read(file.path)).toString("utf8").toLowerCase();
      if (text.includes(normalized)) results.push({ path: file.path, match: "content" });
    }
  }

  return results;
}
