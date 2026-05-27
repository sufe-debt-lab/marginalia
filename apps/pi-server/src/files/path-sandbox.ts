import { realpathSync } from "node:fs";
import path from "node:path";

export function resolveWorkspacePath(rootDir: string, requestedPath: string) {
  const root = path.resolve(rootDir);
  const realRoot = realpathSync.native(rootDir);
  const candidate = path.resolve(root, requestedPath);
  const candidateRelative = path.relative(root, candidate);

  if (candidateRelative.startsWith("..") || path.isAbsolute(candidateRelative)) {
    throw new Error("Path escapes workspace");
  }

  try {
    const target = realpathSync.native(candidate);
    const relative = path.relative(realRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Path escapes workspace");
    }
    return candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
    throw error;
  }
}
