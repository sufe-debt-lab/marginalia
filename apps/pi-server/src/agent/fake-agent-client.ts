import type {
  AgentClient,
  AgentPrepareInput,
  AgentRunEvent,
  AgentRunExecution,
  ApprovalDecision,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  PreparedAgentRun
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

  async prepare(input: AgentPrepareInput): Promise<PreparedAgentRun> {
    const events = this.nextEvents.slice();
    this.nextEvents = [];
    let started = false;
    return {
      sessionFile: `/tmp/fake/${input.sessionId}.jsonl`,
      release() {},
      start: () => {
        if (started) throw new Error("prepared run already started");
        started = true;
        return this.start(input.sessionId, events);
      }
    };
  }

  private start(sessionId: string, events: AgentRunEvent[]): AgentRunExecution {
    let aborted = false;
    let settledDone = false;
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const settle = () => {
      if (settledDone) return;
      settledDone = true;
      resolveSettled();
    };
    const pending = this.pending;
    async function* iterate(): AsyncGenerator<AgentRunEvent> {
      try {
        for (const event of events) {
          if (aborted) return;
          if ((event as { type?: string }).type === "approval_requested") {
            const req = event as ApprovalRequestedEvent;
            // Mirror ApprovalGateway.request(): register the pending entry BEFORE
            // the event reaches the consumer, so resolveApproval/cancelPending
            // fired from an abort handler mid-delivery can always find it.
            const decisionPromise = new Promise<ApprovalDecision & { expired?: boolean }>(
              (resolve) =>
                pending.set(req.approvalId, {
                  sessionId: req.sessionId,
                  toolCallId: req.toolCallId,
                  resolve
                })
            );
            yield event;
            const decision = await decisionPromise;
            if (aborted) return;
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
          } else {
            yield event;
          }
        }
      } finally {
        settle();
      }
    }
    const iterator = iterate();
    return {
      events: {
        [Symbol.asyncIterator]: () => iterator
      },
      abort: () => {
        if (aborted) return;
        aborted = true;
        this.cancelPending(sessionId);
        try {
          void Promise.resolve(iterator.return(undefined)).then(settle, settle);
        } catch {
          settle();
        }
      },
      settled
    };
  }
}
