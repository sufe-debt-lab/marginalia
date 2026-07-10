import { describe, expect, it } from "vitest";
import type { Approval } from "@/api/client.js";
import { mergeApprovals } from "./approval-merge.js";

function approval(toolCallId: string, status: Approval["status"]): Approval {
  return {
    id: `ap-${toolCallId}`,
    toolCallId,
    toolName: "bash",
    kind: "command",
    status,
    payload: { kind: "command", command: "x", cwd: "/" }
  };
}

describe("mergeApprovals", () => {
  it("keys fetched approvals by toolCallId", () => {
    const merged = mergeApprovals([approval("t1", "denied")], new Map());
    expect(merged.get("t1")?.status).toBe("denied");
    expect(merged.size).toBe(1);
  });

  it("keeps live entries the fetch snapshot does not know about", () => {
    const live = new Map([["t2", approval("t2", "pending")]]);
    const merged = mergeApprovals([approval("t1", "approved")], live);
    expect(merged.get("t1")?.status).toBe("approved");
    expect(merged.get("t2")?.status).toBe("pending");
  });

  it("prefers the live entry when both sides have the same toolCallId", () => {
    // The stream resolved this approval while the fetch was in flight; the
    // stale snapshot still says pending and must not win.
    const live = new Map([["t1", approval("t1", "denied")]]);
    const merged = mergeApprovals([approval("t1", "pending")], live);
    expect(merged.get("t1")?.status).toBe("denied");
    expect(merged.size).toBe(1);
  });
});
