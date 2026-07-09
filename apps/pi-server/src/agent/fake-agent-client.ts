import type {
  AgentClient,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  ApprovalDecision,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent
} from "./agent-client.js";

/**
 * Returns canned events for tests. When an enqueued event is an
 * approval_requested, the stream pauses until resolveApproval/cancelPending,
 * then emits the matching approval_resolved before continuing.
 */
export class FakeAgentClient implements AgentClient {
  private nextEvents: AgentRunEvent[] = [];
  private pending = new Map<
    string,
    {
      sessionId: string;
      toolCallId: string;
      resolve(d: ApprovalDecision & { expired?: boolean }): void;
    }
  >();

  enqueueEvents(events: AgentRunEvent[]) {
    this.nextEvents = events;
  }

  resolveApproval(_sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  cancelPending(sessionId: string): number {
    let count = 0;
    for (const [id, entry] of [...this.pending]) {
      if (entry.sessionId !== sessionId) continue;
      this.pending.delete(id);
      entry.resolve({ approved: false, expired: true });
      count += 1;
    }
    return count;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const events = this.nextEvents.slice();
    this.nextEvents = [];
    const pending = this.pending;
    async function* iterate(): AsyncGenerator<AgentRunEvent> {
      for (const event of events) {
        yield event;
        if ((event as { type?: string }).type === "approval_requested") {
          const req = event as ApprovalRequestedEvent;
          const decision = await new Promise<ApprovalDecision & { expired?: boolean }>((resolve) =>
            pending.set(req.approvalId, {
              sessionId: req.sessionId,
              toolCallId: req.toolCallId,
              resolve
            })
          );
          const resolved: ApprovalResolvedEvent = {
            type: "approval_resolved",
            approvalId: req.approvalId,
            sessionId: req.sessionId,
            toolCallId: req.toolCallId,
            approved: decision.approved,
            reason: decision.reason,
            expired: decision.expired
          };
          yield resolved;
        }
      }
    }
    return {
      sessionFile: `/tmp/fake/${input.sessionId}.jsonl`,
      events: iterate(),
      dispose() {}
    };
  }
}
