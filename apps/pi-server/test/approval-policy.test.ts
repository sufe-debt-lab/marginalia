import { describe, expect, it } from "vitest";
import { commandPrefix, evaluateToolCall } from "../src/agent/approval-policy.js";

const base = {
  permission: "ask" as const,
  fileExists: () => true,
  isPrefixAllowed: () => false
};

describe("commandPrefix", () => {
  it("takes the first token lowercased", () => {
    expect(commandPrefix("  Git status")).toBe("git");
    expect(commandPrefix("")).toBe("");
  });
});

describe("evaluateToolCall", () => {
  it("allows everything under full and readonly", () => {
    for (const permission of ["full", "readonly"] as const) {
      expect(
        evaluateToolCall({ ...base, permission, toolName: "bash", input: { command: "rm -rf /" } })
      ).toBe("allow");
    }
  });

  it("allows read-only tools under ask", () => {
    for (const toolName of ["read", "grep", "find", "ls"]) {
      expect(evaluateToolCall({ ...base, toolName, input: {} })).toBe("allow");
    }
  });

  it("allows read-only bash commands, including compound ones", () => {
    expect(evaluateToolCall({ ...base, toolName: "bash", input: { command: "ls -la" } })).toBe(
      "allow"
    );
    expect(
      evaluateToolCall({
        ...base,
        toolName: "bash",
        input: { command: "cat a.md | grep foo && wc -l b.md" }
      })
    ).toBe("allow");
  });

  it("asks for non-readonly bash and for compound commands with any unsafe segment", () => {
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "python gen.py" } })
    ).toEqual({ kind: "command", command: "python gen.py" });
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "cat a.md && rm b.md" } })
    ).toEqual({ kind: "command", command: "cat a.md && rm b.md" });
  });

  it("asks when a read-only prefix redirects output to a file", () => {
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "echo hi > notes.md" } })
    ).toEqual({ kind: "command", command: "echo hi > notes.md" });
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "cat a.md >> b.md" } })
    ).toEqual({ kind: "command", command: "cat a.md >> b.md" });
  });

  it("honours the session prefix allowlist", () => {
    const policy = { ...base, isPrefixAllowed: (p: string) => p === "python" };
    expect(
      evaluateToolCall({ ...policy, toolName: "bash", input: { command: "python gen.py" } })
    ).toBe("allow");
  });

  it("asks for edit always, and for write only when the file exists", () => {
    expect(evaluateToolCall({ ...base, toolName: "edit", input: { path: "a.md" } })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "edit"
    });
    expect(evaluateToolCall({ ...base, toolName: "write", input: { path: "a.md" } })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "write"
    });
    expect(
      evaluateToolCall({
        ...base,
        fileExists: () => false,
        toolName: "write",
        input: { path: "new.md" }
      })
    ).toBe("allow");
  });

  it("asks conservatively for unknown tools", () => {
    const result = evaluateToolCall({ ...base, toolName: "mystery", input: { a: 1 } });
    expect(result).not.toBe("allow");
  });

  it("treats an empty bash command as needing approval", () => {
    expect(evaluateToolCall({ ...base, toolName: "bash", input: {} })).toEqual({
      kind: "command",
      command: ""
    });
  });
});
