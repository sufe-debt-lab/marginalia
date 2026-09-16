import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/** Resolve a caller-supplied relative path; never grant authority to a symlink. */
export function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  if (
    path.isAbsolute(requestedPath) ||
    path.win32.isAbsolute(requestedPath) ||
    requestedPath.includes("\0") ||
    requestedPath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("Path escapes workspace");
  }
  const root = realpathSync.native(rootDir);
  let candidate = root;
  for (const part of requestedPath
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== ".")) {
    candidate = path.join(candidate, part);
    try {
      if (lstatSync(candidate).isSymbolicLink()) throw new Error("Path escapes workspace");
      const canonical = realpathSync.native(candidate);
      const relative = path.relative(root, canonical);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("Path escapes workspace");
      }
      candidate = canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return candidate;
}
