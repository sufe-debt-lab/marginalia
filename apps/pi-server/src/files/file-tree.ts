import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "./path-sandbox.js";

const ignored = new Set([".git", "node_modules"]);
const maxReadableBytes = 5 * 1024 * 1024;
const readableExtensions = new Set([".md", ".txt", ".pdf"]);
const textExtensions = new Set([".md", ".txt"]);

export type FileEntry = { path: string; name: string; kind: "file" };
export type SearchResult = { path: string; match: "name" | "content" };

export function listWorkspaceFiles(rootDir: string): FileEntry[] {
  const files: FileEntry[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const relative = path.relative(rootDir, absolute);
      if (entry.isFile() && isReadableFile(rootDir, relative)) {
        files.push({ path: relative, name: entry.name, kind: "file" });
      }
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function searchWorkspaceFiles(rootDir: string, query: string): Promise<SearchResult[]> {
  const normalized = query.trim().toLowerCase();
  const results: SearchResult[] = [];

  for (const file of listWorkspaceFiles(rootDir)) {
    if (!normalized || file.path.toLowerCase().includes(normalized)) {
      results.push({ path: file.path, match: "name" });
      continue;
    }
    if (textExtensions.has(path.extname(file.path).toLowerCase())) {
      const text = readFileSync(resolveWorkspacePath(rootDir, file.path), "utf8").toLowerCase();
      if (text.includes(normalized)) results.push({ path: file.path, match: "content" });
    }
  }

  return results;
}

function isReadableFile(rootDir: string, relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!readableExtensions.has(extension)) return false;
  const stat = statSync(resolveWorkspacePath(rootDir, relativePath));
  return stat.size <= maxReadableBytes;
}
