import type {
  AgentSessionConfig,
  AgentSessionEvent,
  AuthStorage,
  ModelRegistry,
  PromptOptions,
  SessionManager
} from "@earendil-works/pi-coding-agent";

/**
 * Re-export pi types as the single source of truth. Do not redefine these locally.
 */
export type {
  AgentSessionConfig,
  AgentSessionEvent,
  AuthStorage,
  ModelRegistry,
  PromptOptions,
  SessionManager
};

/** Tool permission level chosen in the composer. */
export type AgentPermission = "full" | "ask" | "readonly";
/** Reasoning / thinking budget chosen in the composer (subset of pi ThinkingLevel). */
export type AgentReasoning = "low" | "medium" | "high" | "xhigh";

/** Input for one chat turn from the UI. */
export type AgentRunInput = {
  /** pi-server's own session id (UUID, distinct from pi sessionFile). */
  sessionId: string;
  /** Workspace rootDir; becomes pi cwd. Must exist on disk. */
  workspaceRoot: string;
  /** pi provider id ("minimax-cn", "openai", …). */
  piProviderId: string;
  /** Model id on the chosen provider, e.g. "MiniMax-M2.7". */
  modelId: string;
  /** User's message text. */
  message: string;
  /** If we already have a pi session file for this UI session, open it; otherwise create. */
  agentSessionPath?: string | null;
  /** Tool permission. "readonly" restricts to read-only tools; "full"/"ask" keep defaults. */
  permission?: AgentPermission;
  /** Reasoning budget; applied via session.setThinkingLevel and session config. */
  reasoning?: AgentReasoning | null;
  /** Optional passthrough for pi's prompt options (e.g. images). */
  promptOptions?: PromptOptions;
};

export type AgentRunResult = {
  /** Final session file path. Persist this in DB so future runs reuse it. */
  sessionFile: string;
  /** Stream of pi-native events. Consumer is responsible for full drain. */
  events: AsyncIterable<AgentSessionEvent>;
  /** Disposes the underlying AgentSession when caller is done. */
  dispose(): void;
};

export interface AgentClient {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
