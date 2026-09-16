import { describe, expect, it } from "vitest";
import { evaluateEffect, type ToolEffect } from "../src/agent/approval-policy.js";

describe("structured effect policy", () => {
  it.each(["read", "create", "overwrite", "delete", "execute", "export", "send"] as const)(
    "applies the permission matrix to %s",
    (kind) => {
      const effect: ToolEffect = { kind, target: "notes.md" };
      expect(evaluateEffect("ask", effect)).toBe(
        ["read", "create"].includes(kind) ? "allow" : "approve"
      );
      expect(evaluateEffect("readonly", effect)).toBe(kind === "read" ? "allow" : "deny");
      expect(evaluateEffect("full", effect)).toBe("allow");
    }
  );
});
