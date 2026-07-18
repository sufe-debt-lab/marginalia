import { homedir } from "node:os";
import path from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
  AgentClient,
  AgentPrepareInput,
  AgentRunEvent,
  ApprovalDecision,
  PreparedAgentRun
} from "./agent-client.js";
import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import { createApprovalExtension } from "./approval-extension.js";

/** Resolves a pi `Model` for the given provider/model id; returns null when unavailable. */
export type ResolveModelFn = (piProviderId: string, modelId: string) => unknown | null;

/** Read-only tool allowlist used when permission === "readonly". */
const READONLY_TOOLS = ["read", "grep", "find", "ls"];

export class PiCodingAgentClient implements AgentClient {
  constructor(
    private readonly registry: AgentSessionRegistry,
    private readonly resolveModel: ResolveModelFn,
    private readonly gateway: ApprovalGateway
  ) {}

  resolveApproval(_sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return this.gateway.resolve(approvalId, decision);
  }

  cancelPending(sessionId: string): number {
    return this.gateway.cancelPending(sessionId);
  }

  async prepare(input: AgentPrepareInput): Promise<PreparedAgentRun> {
    const model = this.resolveModel(input.piProviderId, input.modelId);
    if (!model) {
      throw new Error(`unknown model ${input.piProviderId}/${input.modelId}`);
    }

    // Approval policy is per-run: cached sessions read the current value.
    this.gateway.setPolicy(input.sessionId, {
      permission: input.permission ?? "full",
      workspaceRoot: input.workspaceRoot
    });

    const loader = new DefaultResourceLoader({
      cwd: input.workspaceRoot,
      agentDir: path.join(homedir(), ".marginalia", "pi-agent"),
      noExtensions: true, // discovery disabled; inline extensionFactories still run (verified in resource-loader-factories.test.ts)
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        createApprovalExtension(this.gateway, input.sessionId) as unknown as ExtensionFactory
      ]
    });
    await loader.reload();

    // Map composer permission/reasoning onto createAgentSession options.
    const config: Record<string, unknown> = { model, resourceLoader: loader };
    if (input.permission === "readonly") config.tools = READONLY_TOOLS;
    if (input.reasoning) config.thinkingLevel = input.reasoning;

    const handle = await this.registry.acquire({
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      agentSessionPath: input.agentSessionPath ?? null,
      config
    });

    // Reasoning is dynamic: apply per run so cached sessions also honour it.
    const session = handle.session as unknown as {
      setThinkingLevel?: (level: string) => void;
    };
    if (input.reasoning && typeof session.setThinkingLevel === "function") {
      session.setThinkingLevel(input.reasoning);
    }

    let started = false;
    return {
      sessionFile: handle.sessionFile,
      start: (message, promptOptions) => {
        if (started) throw new Error("prepared run already started");
        started = true;
        const queue: AgentRunEvent[] = [];
        const waiters: Array<() => void> = [];
        let finished = false;
        let error: unknown = null;
        let resolveSettled!: () => void;
        const settled = new Promise<void>((resolve) => {
          resolveSettled = resolve;
        });

        // Shared sink: both raw pi session events and gateway approval events feed
        // the same ordered stream, so the consumer sees approvals interleaved with
        // the tool calls they gate.
        const pushEvent = (event: AgentRunEvent) => {
          queue.push(event);
          waiters.shift()?.();
        };

        const offApproval = this.gateway.onEvent(input.sessionId, pushEvent);
        const unsubscribe = handle.session.subscribe(pushEvent);
        const finish = (failure?: unknown) => {
          if (finished) return;
          error = failure ?? null;
          finished = true;
          offApproval();
          unsubscribe?.();
          for (const waiter of waiters.splice(0)) waiter();
          resolveSettled();
        };

        try {
          Promise.resolve(handle.session.prompt(message, promptOptions)).then(
            () => finish(),
            (failure) => finish(failure)
          );
        } catch (failure) {
          finish(failure);
        }

        const events: AsyncIterable<AgentRunEvent> = {
          [Symbol.asyncIterator]() {
            return {
              next() {
                return new Promise<IteratorResult<AgentRunEvent>>((resolve, reject) => {
                  const read = () => {
                    if (queue.length > 0) {
                      resolve({ value: queue.shift()!, done: false });
                      return;
                    }
                    if (error !== null) {
                      reject(error);
                      return;
                    }
                    if (finished) {
                      resolve({ value: undefined as unknown as AgentRunEvent, done: true });
                      return;
                    }
                    waiters.push(read);
                  };
                  read();
                });
              }
            };
          }
        };

        return {
          events,
          abort: () => {
            void (handle.session as unknown as { abort?: () => Promise<void> }).abort?.();
          },
          settled
        };
      }
    };
  }
}
