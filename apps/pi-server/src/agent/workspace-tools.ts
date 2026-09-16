import path from "node:path";
import { isUtf8 } from "node:buffer";
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createBashToolDefinition,
  createLsToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  truncateHead
} from "@earendil-works/pi-coding-agent";
import { WorkspaceFiles } from "../files/workspace-files.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import type { ToolEffect } from "./approval-policy.js";
import { previewContent } from "./diff-preview.js";
import { searchText } from "./workspace-search.js";

function textResult(text: string) {
  const truncated = truncateHead(text);
  return {
    content: [{ type: "text" as const, text: truncated.content }],
    details: { truncation: truncated }
  };
}

function textSnapshot(bytes: Buffer): string {
  if (!isUtf8(bytes) || bytes.includes(0))
    throw new Error(
      "Only UTF-8 text files can be changed with write/edit; binary or invalid UTF-8 targets are unsupported."
    );
  return bytes.toString("utf8");
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  return undefined;
}

/** pi owns tool schemas, events and result identity; all local IO uses WorkspaceFiles. */
export async function createWorkspaceTools(
  rootDir: string,
  gateway: ApprovalGateway,
  sessionId: string,
  skillContents: Readonly<Record<string, string>> = {}
) {
  const files = await WorkspaceFiles.open(rootDir);
  const cwd = files.rootDir;
  const authorizeRead = (
    toolName: string,
    toolCallId: string,
    relative: string,
    signal?: AbortSignal
  ) =>
    gateway.authorize(
      sessionId,
      { toolName, toolCallId, effect: { kind: "read", target: path.join(cwd, relative) } },
      signal
    );

  const read: ReturnType<typeof createReadToolDefinition> = {
    ...createReadToolDefinition(cwd),
    description:
      "Read a workspace-relative file. Absolute paths, parent traversal and symlinks are rejected.",
    async execute(id, args, signal, update, ctx) {
      const relative = files.relative(args.path);
      await authorizeRead("read", id, relative, signal);
      const bytes = await files.read(relative);
      const native = createReadToolDefinition(cwd, {
        operations: {
          access: async () => {},
          readFile: async () => bytes,
          detectImageMimeType: async () => imageMime(bytes)
        }
      });
      return native.execute(id, { ...args, path: relative }, signal, update, ctx);
    }
  };

  const write: ReturnType<typeof createWriteToolDefinition> = {
    ...createWriteToolDefinition(cwd),
    description:
      "Create a workspace-relative file, or propose replacing an existing file. Overwrites require approval in Standard Access.",
    async execute(id, args, signal) {
      const relative = files.relative(args.path);
      const snapshot = await files.snapshot(relative);
      const before = snapshot ? textSnapshot(snapshot.content) : "";
      const effect: ToolEffect = {
        kind: snapshot ? "overwrite" : "create",
        target: path.join(cwd, relative)
      };
      await gateway.authorize(
        sessionId,
        {
          toolName: "write",
          toolCallId: id,
          effect,
          payload: {
            kind: "file_edit",
            path: effect.target,
            mode: "write",
            ...previewContent(relative, before, args.content)
          }
        },
        signal
      );
      await files.write(relative, args.content, snapshot, signal);
      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote ${Buffer.byteLength(args.content)} bytes to ${relative}`
          }
        ],
        details: undefined
      };
    }
  };

  const edit: ReturnType<typeof createEditToolDefinition> = {
    ...createEditToolDefinition(cwd),
    description:
      "Edit a workspace-relative file. The exact proposed change is approved before publication; changed files require a new proposal.",
    async execute(id, args, signal, update, ctx) {
      const relative = files.relative(args.path);
      const snapshot = await files.snapshot(relative);
      if (!snapshot) throw new Error("File not found");
      const before = textSnapshot(snapshot.content);
      let proposed: string | undefined;
      // pi computes its own replacement semantics against a frozen snapshot. No disk side effects yet.
      const native = createEditToolDefinition(cwd, {
        operations: {
          access: async () => {},
          readFile: async () => snapshot.content,
          writeFile: async (_path, content) => {
            proposed = content;
          }
        }
      });
      const result = await native.execute(id, { ...args, path: relative }, signal, update, ctx);
      if (proposed === undefined) throw new Error("Edit did not produce a replacement");
      const effect: ToolEffect = { kind: "overwrite", target: path.join(cwd, relative) };
      await gateway.authorize(
        sessionId,
        {
          toolName: "edit",
          toolCallId: id,
          effect,
          payload: {
            kind: "file_edit",
            path: effect.target,
            mode: "edit",
            ...previewContent(relative, before, proposed)
          }
        },
        signal
      );
      await files.write(relative, proposed, snapshot, signal);
      return result;
    }
  };

  const nativeBash = createBashToolDefinition(cwd);
  const bash: ReturnType<typeof createBashToolDefinition> = {
    ...nativeBash,
    description:
      "Execute a host shell command from the workspace. This may read or modify files outside the workspace or access the network; Standard Access requires approval of each command.",
    async execute(id, args, signal, update, ctx) {
      await gateway.authorize(
        sessionId,
        {
          toolName: "bash",
          toolCallId: id,
          effect: { kind: "execute", target: cwd },
          payload: { kind: "command", command: args.command, cwd }
        },
        signal
      );
      await files.stat("."); // A replaced workspace root invalidates the command too.
      return nativeBash.execute(id, args, signal, update, ctx);
    }
  };

  const ls: ReturnType<typeof createLsToolDefinition> = {
    ...createLsToolDefinition(cwd),
    async execute(id, args, signal) {
      const relative = files.relative(args.path ?? ".");
      await authorizeRead("ls", id, relative, signal);
      const entries = (await files.list(relative)).filter((entry) => !entry.isSymbolicLink);
      const limit = Math.max(1, Math.min(args.limit ?? 500, 10000));
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit)
        .map((entry) => entry.name + (entry.isDirectory ? "/" : ""));
      if (entries.length > limit) lines.push(`[Entry limit reached: ${limit}]`);
      return textResult(lines.join("\n") || "Directory is empty");
    }
  };

  const find: ReturnType<typeof createFindToolDefinition> = {
    ...createFindToolDefinition(cwd),
    async execute(id, args, signal) {
      const relative = files.relative(args.path ?? ".");
      await authorizeRead("find", id, relative, signal);
      const matches: string[] = [];
      const limit = Math.max(1, Math.min(args.limit ?? 1000, 10000));
      for await (const entry of files.walk(relative, true)) {
        signal?.throwIfAborted();
        if (entry.kind !== "file") continue;
        const candidate = path.posix.relative(relative, entry.relativePath);
        if (
          path.matchesGlob(candidate, args.pattern) ||
          path.matchesGlob(path.posix.basename(candidate), args.pattern)
        )
          matches.push(candidate);
        if (matches.length >= limit) {
          matches.push(`[Result limit reached: ${limit}]`);
          break;
        }
      }
      return textResult(matches.join("\n") || "No files found matching pattern");
    }
  };

  const grep: ReturnType<typeof createGrepToolDefinition> = {
    ...createGrepToolDefinition(cwd),
    async execute(id, args, signal) {
      const relative = files.relative(args.path ?? ".");
      await authorizeRead("grep", id, relative, signal);
      const entries: Array<{ path: string; text: string }> = [];
      let total = 0;
      const add = async (file: string) => {
        if (
          args.glob &&
          !path.matchesGlob(file, args.glob) &&
          !path.matchesGlob(path.posix.basename(file), args.glob)
        )
          return;
        const bytes = await files.read(file);
        total += bytes.length;
        if (total > 10 * 1024 * 1024)
          throw new Error("Search exceeds 10 MiB; narrow the path or glob.");
        if (!bytes.includes(0)) entries.push({ path: file, text: bytes.toString("utf8") });
      };
      if ((await files.stat(relative)).isFile) await add(relative);
      else
        for await (const entry of files.walk(relative, true)) {
          signal?.throwIfAborted();
          if (entry.kind === "file") await add(entry.relativePath);
        }
      return textResult(await searchText(entries, args, signal));
    }
  };
  const tools = [read, grep, find, ls, write, edit, bash];
  if (Object.keys(skillContents).length) {
    const skillRoots = await Promise.all(
      [...new Set(Object.keys(skillContents).map((file) => path.dirname(file)))].map((directory) =>
        WorkspaceFiles.open(directory)
      )
    );
    const readSkill: ReturnType<typeof createReadToolDefinition> = {
      ...createReadToolDefinition(cwd),
      name: "read_skill",
      label: "read_skill",
      description:
        "Read a frozen admitted Skill body, or a resource beneath its directory. Use the absolute catalog path or resolve references relative to that Skill directory. Resource reads reject symlinks and parent traversal; they do not authorize execution or writes.",
      async execute(id, args, signal, update, ctx) {
        await gateway.authorize(
          sessionId,
          {
            toolName: "read_skill",
            toolCallId: id,
            effect: { kind: "read", target: args.path }
          },
          signal
        );
        let bytes: Buffer;
        if (Object.hasOwn(skillContents, args.path)) bytes = Buffer.from(skillContents[args.path]!);
        else {
          if (!path.isAbsolute(args.path) || args.path.split(/[\\/]/).includes(".."))
            throw new Error("Skill resource is not in this run catalog");
          const root = skillRoots.find((root) => {
            const relative = path.relative(root.rootDir, args.path);
            return (
              relative !== "" &&
              relative !== ".." &&
              !relative.startsWith(`..${path.sep}`) &&
              !path.isAbsolute(relative)
            );
          });
          if (!root) throw new Error("Skill resource is not in this run catalog");
          bytes = await root.read(path.relative(root.rootDir, args.path));
        }
        return createReadToolDefinition(cwd, {
          operations: {
            access: async () => {},
            readFile: async () => bytes,
            detectImageMimeType: async () => imageMime(bytes)
          }
        }).execute(id, args, signal, update, ctx);
      }
    };
    tools.push(readSkill);
  }
  return tools;
}
