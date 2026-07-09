import type { AgentPermission } from "./agent-client.js";

export type ApprovalNeed =
  | { kind: "command"; command: string }
  | { kind: "file_edit"; path: string; mode: "edit" | "write" };

export type PolicyInput = {
  toolName: string;
  input: Record<string, unknown>;
  permission: AgentPermission;
  fileExists(path: string): boolean;
  isPrefixAllowed(prefix: string): boolean;
};

/** Read-only builtin tools that never need approval. */
const READONLY_TOOL_NAMES = new Set(["read", "grep", "find", "ls"]);

/** Conservative allowlist of side-effect-free command prefixes. */
const READONLY_COMMAND_PREFIXES = new Set([
  "ls",
  "cat",
  "grep",
  "rg",
  "head",
  "tail",
  "wc",
  "find",
  "pwd",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "echo"
]);

export function commandPrefix(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Split a compound command on newlines, pipes, `&&`, `||`, `;`. */
function commandSegments(command: string): string[] {
  return command
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function evaluateToolCall(policy: PolicyInput): "allow" | ApprovalNeed {
  if (policy.permission !== "ask") return "allow";
  const { toolName, input } = policy;
  if (READONLY_TOOL_NAMES.has(toolName)) return "allow";

  if (toolName === "bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const segments = commandSegments(command);
    const allSafe =
      segments.length > 0 &&
      segments.every((segment) => {
        // Output redirection turns a read-only command into a write
        // (`echo x > file`) — always require approval.
        if (segment.includes(">")) return false;
        const prefix = commandPrefix(segment);
        return READONLY_COMMAND_PREFIXES.has(prefix) || policy.isPrefixAllowed(prefix);
      });
    return allSafe ? "allow" : { kind: "command", command };
  }

  if (toolName === "edit") {
    const path = typeof input.path === "string" ? input.path : "";
    return { kind: "file_edit", path, mode: "edit" };
  }

  if (toolName === "write") {
    const path = typeof input.path === "string" ? input.path : "";
    return policy.fileExists(path) ? { kind: "file_edit", path, mode: "write" } : "allow";
  }

  // Conservative fallback: unknown tools are shown as a command-style approval.
  return { kind: "command", command: `${toolName} ${JSON.stringify(input)}` };
}
