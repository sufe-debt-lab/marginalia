import type {
  AgentSessionConfig,
  AgentSessionEvent,
  AuthStorage,
  ModelRegistry,
  PromptOptions,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import type { AgentRuntimeSkills } from "../skills/turn-preflight.js";

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
  /** Client disconnect / explicit stop signal. */
  abortSignal?: AbortSignal;
};

export type AgentPrepareInput = Omit<AgentRunInput, "message" | "promptOptions" | "abortSignal"> & {
  /** Immutable Skill runtime pinned by the turn preflight snapshot. */
  runtimeSkills: AgentRuntimeSkills;
};

export type AgentRunExecution = {
  /** Stream of pi-native events. Consumer is responsible for full drain. */
  events: AsyncIterable<AgentRunEvent>;
  /** Requests cancellation of the active prompt. */
  abort(): void;
  /** Resolves after the active prompt and event subscriptions have settled. */
  settled: Promise<void>;
};

export type PreparedAgentRun = {
  /** Final session file path. Persist this in DB so future runs reuse it. */
  sessionFile: string;
  /** Releases preparation resources when this run will not be started. Idempotent. */
  release(): void;
  /** Starts the prompt after preparation has completed. */
  start(message: string, promptOptions?: PromptOptions): AgentRunExecution;
};

export interface AgentClient {
  prepare(input: AgentPrepareInput): Promise<PreparedAgentRun>;
  /** Resolve one pending approval; false when the id is unknown/already resolved. */
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean;
  /** Deny every pending approval for the session (disconnect/exit safety). Returns count. */
  cancelPending(sessionId: string): number;
}

/** Decision sent back from the UI for one pending approval. */
export type ApprovalDecision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

export type ApprovalPayload = { effect?: import("./approval-policy.js").ToolEffect } & (
  | { kind: "command"; command: string; cwd: string }
  | {
      kind: "file_edit";
      path: string;
      mode: "edit" | "write";
      patch: string;
      additions: number;
      deletions: number;
      exact: boolean;
      error?: string;
    }
);

export type ApprovalRequestedEvent = {
  type: "approval_requested";
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  payload: ApprovalPayload;
};

export type ApprovalResolvedEvent = {
  type: "approval_resolved";
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  approved: boolean;
  reason?: string;
  expired?: boolean;
};

export type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent;

/** Marginalia run-envelope event stream: raw pi events plus approval envelope events. */
export type AgentRunEvent = AgentSessionEvent | ApprovalEvent;
