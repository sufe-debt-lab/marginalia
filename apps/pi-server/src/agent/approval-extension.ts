import type { ApprovalPayload } from "./agent-client.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import type { ApprovalNeed } from "./approval-policy.js";
import { previewEdit, previewWrite } from "./diff-preview.js";

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
    const preview = previewEdit(
      workspaceRoot,
      need.path,
      String(input.oldText ?? ""),
      String(input.newText ?? "")
    );
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
