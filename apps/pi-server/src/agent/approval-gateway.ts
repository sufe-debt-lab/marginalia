import { randomUUID } from "node:crypto";
import type {
  AgentPermission,
  ApprovalDecision,
  ApprovalEvent,
  ApprovalPayload
} from "./agent-client.js";
import { evaluateEffect, type ToolEffect } from "./approval-policy.js";

type SessionPolicy = { permission: AgentPermission; workspaceRoot: string };

type Pending = {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  resolve(decision: ApprovalDecision): void;
  payload: ApprovalPayload;
};

export class ApprovalGateway {
  private readonly policies = new Map<string, SessionPolicy>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Set<(e: ApprovalEvent) => void>>();

  setPolicy(sessionId: string, policy: SessionPolicy): void {
    this.policies.set(sessionId, policy);
  }

  policyFor(sessionId: string): SessionPolicy | null {
    return this.policies.get(sessionId) ?? null;
  }

  evaluate(sessionId: string, effect: ToolEffect): "allow" | "approve" | "deny" {
    const policy = this.policies.get(sessionId);
    return policy ? evaluateEffect(policy.permission, effect) : "deny";
  }

  async authorize(
    sessionId: string,
    req: { toolCallId: string; toolName: string; effect: ToolEffect; payload?: ApprovalPayload },
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    const policy = this.evaluate(sessionId, req.effect);
    if (policy === "deny")
      throw new Error("Operation denied by read-only or missing session policy");
    if (policy === "allow") return;
    if (!req.payload) throw new Error("Protected operation requires an exact approval preview");
    const cancel = () => {
      this.cancelPending(sessionId);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const decision = await this.request(sessionId, {
        ...req,
        payload: { ...req.payload, effect: req.effect }
      });
      signal?.throwIfAborted();
      if (!decision.approved)
        throw new Error(
          decision.reason
            ? `User declined this operation: ${decision.reason}`
            : "User declined this operation."
        );
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  request(
    sessionId: string,
    req: { toolCallId: string; toolName: string; payload: ApprovalPayload }
  ): Promise<ApprovalDecision> {
    const approvalId = randomUUID();
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(approvalId, {
        approvalId,
        sessionId,
        toolCallId: req.toolCallId,
        resolve,
        payload: req.payload
      });
      this.emit(sessionId, {
        type: "approval_requested",
        approvalId,
        sessionId,
        toolCallId: req.toolCallId,
        toolName: req.toolName,
        payload: req.payload
      });
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    entry.resolve({ approved: decision.approved, reason: decision.reason });
    this.emit(entry.sessionId, {
      type: "approval_resolved",
      approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      approved: decision.approved,
      reason: decision.reason
    });
    return true;
  }

  cancelPending(sessionId: string): number {
    let count = 0;
    for (const [approvalId, entry] of [...this.pending]) {
      if (entry.sessionId !== sessionId) continue;
      this.pending.delete(approvalId);
      entry.resolve({ approved: false });
      this.emit(sessionId, {
        type: "approval_resolved",
        approvalId,
        sessionId,
        toolCallId: entry.toolCallId,
        approved: false,
        expired: true
      });
      count += 1;
    }
    return count;
  }

  /** Visible for tests. */
  pendingIds(sessionId: string): string[] {
    return [...this.pending.values()]
      .filter((p) => p.sessionId === sessionId)
      .map((p) => p.approvalId);
  }

  onEvent(sessionId: string, listener: (e: ApprovalEvent) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => set.delete(listener);
  }

  private emit(sessionId: string, event: ApprovalEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}
