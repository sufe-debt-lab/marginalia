import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

function assertContained(realRoot: string, target: string): void {
  const relative = path.relative(realRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace");
  }
}

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
    assertContained(realRoot, target);
    return candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let existingAncestor = candidate;
  while (true) {
    try {
      lstatSync(existingAncestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
      continue;
    }

    try {
      assertContained(realRoot, realpathSync.native(existingAncestor));
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Path escapes workspace", { cause: error });
      }
      throw error;
    }
  }
}
