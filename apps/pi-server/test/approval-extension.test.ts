import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import { createApprovalExtension, type PiExtensionApi } from "../src/agent/approval-extension.js";

type ToolCallHandler = (
  event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
  ctx: unknown
) => Promise<{ block: boolean; reason?: string } | undefined>;

function register(gateway: ApprovalGateway, sessionId: string): ToolCallHandler {
  let handler: ToolCallHandler | null = null;
  const pi: PiExtensionApi = {
    on(type, h) {
      if (type === "tool_call") handler = h;
    }
  };
  createApprovalExtension(gateway, sessionId)(pi);
  if (!handler) throw new Error("tool_call handler not registered");
  return handler;
}

describe("createApprovalExtension", () => {
  it("lets safe calls through without pending approvals", async () => {
    const gateway = new ApprovalGateway({ fileExists: () => false });
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
    const handler = register(gateway, "s1");
    const result = await handler(
      { toolName: "read", toolCallId: "t1", input: { path: "a.md" } },
      {}
    );
    expect(result).toBeUndefined();
    expect(gateway.pendingIds("s1")).toHaveLength(0);
  });

  it("blocks a denied command with the user reason", async () => {
    const gateway = new ApprovalGateway({ fileExists: () => true });
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
    const handler = register(gateway, "s1");
    const resultPromise = handler(
      { toolName: "bash", toolCallId: "t1", input: { command: "python x.py" } },
      {}
    );
    // Wait for the pending approval to register, then deny with a reason.
    await new Promise((r) => setTimeout(r, 0));
    const id = gateway.pendingIds("s1")[0]!;
    gateway.resolve(id, { approved: false, reason: "改用只读方式" });
    const result = await resultPromise;
    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("改用只读方式");
  });

  it("returns undefined when approved and builds a file_edit payload with a real diff", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "approval-ext-"));
    writeFileSync(path.join(root, "a.md"), "old line\n");
    const gateway = new ApprovalGateway();
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: root });
    const events: unknown[] = [];
    gateway.onEvent("s1", (e) => events.push(e));
    const handler = register(gateway, "s1");
    const resultPromise = handler(
      {
        toolName: "edit",
        toolCallId: "t2",
        input: { path: "a.md", oldText: "old line", newText: "new line" }
      },
      {}
    );
    await new Promise((r) => setTimeout(r, 0));
    const requested = events[0] as { payload: { kind: string; patch: string } };
    expect(requested.payload.kind).toBe("file_edit");
    expect(requested.payload.patch).toContain("+new line");
    gateway.resolve(gateway.pendingIds("s1")[0]!, { approved: true });
    expect(await resultPromise).toBeUndefined();
  });
});
