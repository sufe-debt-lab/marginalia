import type { ApprovalPayload } from "./agent-client.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import type { ApprovalNeed } from "./approval-policy.js";
import { previewEdits, previewWrite, type EditOp } from "./diff-preview.js";

/**
 * pi's edit tool accepts either the legacy single `{ oldText, newText }` or the
 * current `{ edits: [{ oldText, newText }, ...] }` array. Normalise both to an
 * edit list so the diff preview isn't empty when a model uses the array form.
 */
function parseEdits(input: Record<string, unknown>): EditOp[] {
  if (Array.isArray(input.edits)) {
    return input.edits
      .map((edit) => {
        const e = edit as { oldText?: unknown; newText?: unknown };
        return { oldText: String(e.oldText ?? ""), newText: String(e.newText ?? "") };
      })
      .filter((e) => e.oldText || e.newText);
  }
  return [{ oldText: String(input.oldText ?? ""), newText: String(input.newText ?? "") }];
}

export type PiExtensionApi = {
  on(
    type: "tool_call",
    handler: (
      event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
      ctx: unknown
    ) => Promise<{ block: boolean; reason?: string } | undefined>
  ): void;
};

function buildPayload(
  need: ApprovalNeed,
  input: Record<string, unknown>,
  workspaceRoot: string
): ApprovalPayload {
  if (need.kind === "command") {
    return { kind: "command", command: need.command, cwd: workspaceRoot };
  }
  if (need.mode === "edit") {
    const preview = previewEdits(workspaceRoot, need.path, parseEdits(input));
    return { kind: "file_edit", path: need.path, mode: "edit", ...preview };
  }
  const preview = previewWrite(workspaceRoot, need.path, String(input.content ?? ""));
  return { kind: "file_edit", path: need.path, mode: "write", ...preview };
}

/**
 * pi extension factory: blocks side-effecting tool calls until the user
 * approves. Registered per session; reads the CURRENT policy from the gateway
 * on every call, so cached sessions honour per-run permission changes.
 */
export function createApprovalExtension(gateway: ApprovalGateway, sessionId: string) {
  return (pi: PiExtensionApi) => {
    pi.on("tool_call", async (event) => {
      const need = gateway.evaluate(sessionId, event.toolName, event.input);
      if (need === "allow") return undefined;
      const workspaceRoot = gateway.policyFor(sessionId)?.workspaceRoot ?? "";
      const payload = buildPayload(need, event.input, workspaceRoot);
      const decision = await gateway.request(sessionId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload
      });
      if (decision.approved) return undefined;
      const reason = decision.reason?.trim();
      return {
        block: true,
        reason: reason ? `User declined this operation: ${reason}` : "User declined this operation."
      };
    });
  };
}
