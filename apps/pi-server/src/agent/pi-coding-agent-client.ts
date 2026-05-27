import type {
  AgentClient,
  AgentRunInput,
  AgentRunResult,
  AgentSessionEvent
} from "./agent-client.js";
import type { AgentSessionRegistry } from "./agent-session-registry.js";

/** Resolves a pi `Model` for the given provider/model id; returns null when unavailable. */
export type ResolveModelFn = (piProviderId: string, modelId: string) => unknown | null;

export class PiCodingAgentClient implements AgentClient {
  constructor(
    private readonly registry: AgentSessionRegistry,
    private readonly resolveModel: ResolveModelFn
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const model = this.resolveModel(input.piProviderId, input.modelId);
    if (!model) {
      throw new Error(`unknown model ${input.piProviderId}/${input.modelId}`);
    }

    const handle = await this.registry.acquire({
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      agentSessionPath: input.agentSessionPath ?? null,
      config: { model }
    });

    const queue: AgentSessionEvent[] = [];
    const waiters: Array<(value: IteratorResult<AgentSessionEvent>) => void> = [];
    let finished = false;
    let error: unknown = null;

    const unsubscribe = handle.session.subscribe((event) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value: event, done: false });
        return;
      }
      queue.push(event);
    });

    handle.session
      .prompt(input.message, input.promptOptions)
      .catch((err) => {
        error = err;
      })
      .finally(() => {
        finished = true;
        unsubscribe?.();
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as AgentSessionEvent, done: true });
        }
      });

    const events: AsyncIterable<AgentSessionEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise<IteratorResult<AgentSessionEvent>>((resolve, reject) => {
              if (queue.length > 0) {
                resolve({ value: queue.shift()!, done: false });
                return;
              }
              if (error) {
                reject(error);
                return;
              }
              if (finished) {
                resolve({ value: undefined as unknown as AgentSessionEvent, done: true });
                return;
              }
              waiters.push(resolve);
            });
          }
        };
      }
    };

    return {
      sessionFile: handle.sessionFile,
      events,
      dispose: () => unsubscribe?.()
    };
  }
}
