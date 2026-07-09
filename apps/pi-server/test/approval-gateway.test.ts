import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import type { ApprovalEvent } from "../src/agent/agent-client.js";

function gateway(fileExists = () => true) {
  const g = new ApprovalGateway({ fileExists });
  g.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
  return g;
}

describe("ApprovalGateway", () => {
  it("evaluates using the session policy and injected fileExists", () => {
    const g = gateway(() => false);
    expect(g.evaluate("s1", "write", { path: "new.md" })).toBe("allow");
    expect(g.evaluate("s1", "edit", { path: "a.md" })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "edit"
    });
    // Unknown session defaults to allow (no policy registered → not "ask").
    expect(g.evaluate("nope", "edit", { path: "a.md" })).toBe("allow");
  });

  it("emits approval_requested and resolves the pending promise on approve", async () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    g.onEvent("s1", (e) => events.push(e));

    const promise = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(events[0]?.type).toBe("approval_requested");
    const approvalId = (events[0] as { approvalId: string }).approvalId;

    expect(g.resolve(approvalId, { approved: true })).toBe(true);
    await expect(promise).resolves.toEqual({ approved: true });
    expect(events[1]).toMatchObject({ type: "approval_resolved", approved: true });
    // Second resolve is a no-op.
    expect(g.resolve(approvalId, { approved: false })).toBe(false);
  });

  it("adds the command prefix to the session allowlist on alwaysAllowPrefix", async () => {
    const g = gateway();
    g.onEvent("s1", () => {});
    const promise = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    const pendingId = g.pendingIds("s1")[0]!;
    g.resolve(pendingId, { approved: true, alwaysAllowPrefix: true });
    await promise;
    expect(g.evaluate("s1", "bash", { command: "python other.py" })).toBe("allow");
  });

  it("cancelPending denies all pending approvals with expired flag", async () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    g.onEvent("s1", (e) => events.push(e));
    const p1 = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(g.cancelPending("s1")).toBe(1);
    await expect(p1).resolves.toMatchObject({ approved: false });
    const resolved = events.find((e) => e.type === "approval_resolved");
    expect(resolved).toMatchObject({ approved: false, expired: true });
  });

  it("unsubscribes listeners", () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    const off = g.onEvent("s1", (e) => events.push(e));
    off();
    void g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(events).toHaveLength(0);
    g.cancelPending("s1");
  });
});
