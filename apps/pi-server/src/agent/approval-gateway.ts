import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AgentPermission,
  ApprovalDecision,
  ApprovalEvent,
  ApprovalPayload
} from "./agent-client.js";
import { commandPrefix, evaluateToolCall, type ApprovalNeed } from "./approval-policy.js";

type SessionPolicy = { permission: AgentPermission; workspaceRoot: string };

type Pending = {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  resolve(decision: ApprovalDecision): void;
  payload: ApprovalPayload;
};

export class ApprovalGateway {
  private readonly fileExists: (absPath: string) => boolean;
  private readonly policies = new Map<string, SessionPolicy>();
  private readonly allowedPrefixes = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Set<(e: ApprovalEvent) => void>>();

  constructor(deps: { fileExists?: (absPath: string) => boolean } = {}) {
    this.fileExists = deps.fileExists ?? existsSync;
  }

  setPolicy(sessionId: string, policy: SessionPolicy): void {
    this.policies.set(sessionId, policy);
  }

  policyFor(sessionId: string): SessionPolicy | null {
    return this.policies.get(sessionId) ?? null;
  }

  evaluate(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>
  ): "allow" | ApprovalNeed {
    const policy = this.policies.get(sessionId);
    if (!policy) return "allow";
    const prefixes = this.allowedPrefixes.get(sessionId);
    return evaluateToolCall({
      toolName,
      input,
      permission: policy.permission,
      fileExists: (rel) => this.fileExists(path.resolve(policy.workspaceRoot, rel)),
      isPrefixAllowed: (prefix) => prefixes?.has(prefix) ?? false
    });
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
    if (decision.approved && decision.alwaysAllowPrefix && entry.payload.kind === "command") {
      const set = this.allowedPrefixes.get(entry.sessionId) ?? new Set<string>();
      set.add(commandPrefix(entry.payload.command));
      this.allowedPrefixes.set(entry.sessionId, set);
    }
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
