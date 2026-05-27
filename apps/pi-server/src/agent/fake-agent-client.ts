import type {
  AgentClient,
  AgentRunInput,
  AgentRunResult,
  AgentSessionEvent
} from "./agent-client.js";

/**
 * Returns canned events for tests. Caller supplies the event stream per run.
 */
export class FakeAgentClient implements AgentClient {
  private nextEvents: AgentSessionEvent[] = [];

  enqueueEvents(events: AgentSessionEvent[]) {
    this.nextEvents = events;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const events = this.nextEvents.slice();
    this.nextEvents = [];
    async function* iterate() {
      for (const event of events) yield event;
    }
    return {
      sessionFile: `/tmp/fake/${input.sessionId}.jsonl`,
      events: iterate(),
      dispose() {}
    };
  }
}
