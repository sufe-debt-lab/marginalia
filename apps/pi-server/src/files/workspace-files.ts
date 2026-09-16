import { closeSync, constants, fstatSync, openSync, statSync, type BigIntStats } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { configureFsSafeNative } from "@openclaw/fs-safe/config";
import { FsSafeError } from "@openclaw/fs-safe/errors";
import { root, type Root } from "@openclaw/fs-safe/root";
import { resolveWorkspacePath } from "./path-sandbox.js";

// Node has no descriptor-relative rename/mkdir API. Never fall back to pathname writes.
configureFsSafeNative({ mode: "require" });

export class WorkspaceConflictError extends Error {
  constructor() {
    super("File changed since it was read; read it again before writing.");
  }
}

export type FileSnapshot = { content: Buffer; version: string; mode: number };

function version(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export function workspaceErrorStatus(error: unknown): 403 | 404 | 409 | 500 {
  if (error instanceof WorkspaceConflictError) return 409;
  let cause: unknown = error;
  while (cause instanceof Error) {
    if (["ENOSPC", "EIO", "EDQUOT", "EROFS"].includes((cause as NodeJS.ErrnoException).code ?? ""))
      return 500;
    cause = cause.cause;
  }
  if (error instanceof FsSafeError) {
    if (error.code === "already-exists") return 409;
    if (error.code === "not-found") return 404;
    if (error.category === "policy") return 403;
  }
  if ((error as Error).message === "Path escapes workspace") return 403;
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return 404;
  return 500;
}

/** Shared operation boundary for HTTP, attachments and pi tools. Bodies stay on disk. */
export class WorkspaceFiles {
  private constructor(private readonly files: Root) {}

  static async open(rootDir: string): Promise<WorkspaceFiles> {
    return new WorkspaceFiles(
      await root(rootDir, {
        symlinks: "reject",
        mutationSymlinks: "reject",
        hardlinks: "reject",
        mkdir: true,
        maxBytes: 10 * 1024 * 1024
      })
    );
  }

  get rootDir(): string {
    return this.files.rootReal;
  }

  relative(requestedPath: string): string {
    return (
      path
        .relative(this.rootDir, resolveWorkspacePath(this.rootDir, requestedPath))
        .split(path.sep)
        .join("/") || "."
    );
  }

  async snapshot(requestedPath: string): Promise<FileSnapshot | null> {
    const relative = this.relative(requestedPath);
    let opened;
    try {
      opened = await this.files.open(relative);
    } catch (error) {
      if (workspaceErrorStatus(error) === 404) return null;
      throw error;
    }
    try {
      const before = await opened.handle.stat({ bigint: true });
      if (before.size > 10n * 1024n * 1024n)
        throw new Error("File exceeds 10 MiB workspace text limit");
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await opened.handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead
        );
        if (!result.bytesRead) break;
        bytesRead += result.bytesRead;
      }
      const content = buffer.subarray(0, bytesRead);
      const after = await opened.handle.stat({ bigint: true });
      if (version(before) !== version(after)) throw new WorkspaceConflictError();
      return { content, version: version(after), mode: Number(after.mode & 0o777n) };
    } finally {
      await opened.handle.close();
    }
  }

  async read(requestedPath: string): Promise<Buffer> {
    return this.files.readBytes(this.relative(requestedPath));
  }
  async openRead(requestedPath: string) {
    return this.files.open(this.relative(requestedPath));
  }
  async stat(requestedPath: string) {
    return this.files.stat(this.relative(requestedPath));
  }
  async list(requestedPath = ".") {
    return this.files.list(this.relative(requestedPath), { withFileTypes: true });
  }
  async *walk(requestedPath = ".", respectGitignore = false) {
    const relative = this.relative(requestedPath);
    const rules = new Map<string, Ignore>();
    const loadRules = async (directory: string) => {
      const file = path.posix.join(directory, ".gitignore");
      const snapshot = await this.snapshot(file);
      if (snapshot) rules.set(directory, ignore().add(snapshot.content.toString("utf8")));
    };
    if (respectGitignore) {
      await loadRules(".");
      let directory = "";
      if (relative !== ".")
        for (const part of relative.split("/")) {
          directory = path.posix.join(directory, part);
          await loadRules(directory);
        }
    }
    const ignored = (file: string, isDirectory: boolean) => {
      let excluded = false;
      for (const [directory, matcher] of rules) {
        const candidate = path.posix.relative(directory, file);
        if (!candidate || candidate.startsWith("../")) continue;
        const result = matcher.test(candidate + (isDirectory ? "/" : ""));
        if (result.ignored) excluded = true;
        else if (result.unignored) excluded = false;
      }
      return excluded;
    };
    for await (const entry of this.files.walk(relative, {
      symlinkPolicy: "skip",
      maxEntries: 100_000,
      maxDepth: 100,
      limitBehavior: "throw",
      entryFilter: (entry) =>
        [".git", "node_modules"].includes(path.posix.basename(entry.relativePath)) ||
        (respectGitignore && ignored(entry.relativePath, entry.kind === "directory"))
          ? "skip-subtree"
          : "include"
    })) {
      // Native walk yields a directory before descending; load its local rules first.
      if (respectGitignore && entry.kind === "directory") await loadRules(entry.relativePath);
      yield entry;
    }
  }

  async write(
    requestedPath: string,
    content: string,
    expected: FileSnapshot | null,
    signal?: AbortSignal
  ): Promise<void> {
    const relative = this.relative(requestedPath);
    const assertBeforeMutation = () => {
      signal?.throwIfAborted();
      // Approval is for this file identity and version, not a later replacement.
      if (expected) {
        const absolute = resolveWorkspacePath(this.rootDir, relative);
        let fd;
        try {
          fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const stat = fstatSync(fd, { bigint: true });
          if (
            version(stat) !== expected.version ||
            version(statSync(absolute, { bigint: true })) !== expected.version
          )
            throw new WorkspaceConflictError();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new WorkspaceConflictError();
          throw error;
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
      }
    };
    assertBeforeMutation();
    const options = { assertBeforeMutation, mode: expected?.mode ?? 0o666 & ~process.umask() };
    if (expected) await this.files.write(relative, content, options);
    else await this.files.create(relative, content, options);
  }
}
