import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import { SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";

/** Subset of CreateAgentSessionOptions we forward; kept loose to avoid coupling. */
export type CreateSessionOptions = {
  cwd: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  sessionManager?: SessionManager;
  [key: string]: unknown;
};

export type CreateSessionFn = (options: CreateSessionOptions) => Promise<{ session: AgentSession }>;

export type RegistryDeps = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  createSession: CreateSessionFn;
  /** Visible for tests. Default 20. */
  maxEntries?: number;
  /** Builds a SessionManager for a given (workspaceRoot, existingPath). Default: open or create. */
  sessionManagerFor?: (workspaceRoot: string, existingPath: string | null) => SessionManager;
};

export type AcquireInput = {
  sessionId: string;
  workspaceRoot: string;
  agentSessionPath: string | null;
  resourceRevision: string;
  /** Extra config (model, tools, etc.). Forwarded to createSession. */
  config?: Record<string, unknown>;
};

export type SessionHandle = {
  sessionId: string;
  resourceRevision: string;
  session: AgentSession;
  sessionFile: string;
  dispose(): void;
};

function defaultSessionManagerFor(workspaceRoot: string, existing: string | null): SessionManager {
  if (!existing) return PiSessionManager.create(workspaceRoot);
  try {
    return PiSessionManager.open(existing);
  } catch {
    return PiSessionManager.create(workspaceRoot);
  }
}

export class AgentSessionRegistry {
  private readonly entries = new Map<string, SessionHandle>();
  private readonly maxEntries: number;
  private readonly sessionManagerFor: (
    workspaceRoot: string,
    existingPath: string | null
  ) => SessionManager;

  constructor(private readonly deps: RegistryDeps) {
    this.maxEntries = deps.maxEntries ?? 20;
    this.sessionManagerFor = deps.sessionManagerFor ?? defaultSessionManagerFor;
  }

  async acquire(input: AcquireInput): Promise<SessionHandle> {
    const hit = this.entries.get(input.sessionId);
    if (hit && hit.resourceRevision === input.resourceRevision) {
      this.entries.delete(input.sessionId); // move to MRU
      this.entries.set(input.sessionId, hit);
      return hit;
    }
    if (hit) this.evict(input.sessionId);

    const sessionManager = this.sessionManagerFor(
      input.workspaceRoot,
      input.agentSessionPath ?? null
    );
    const { session } = await this.deps.createSession({
      ...(input.config ?? {}),
      cwd: input.workspaceRoot,
      authStorage: this.deps.authStorage,
      modelRegistry: this.deps.modelRegistry,
      sessionManager
    });

    const handle: SessionHandle = {
      sessionId: input.sessionId,
      resourceRevision: input.resourceRevision,
      session,
      sessionFile: session.sessionFile ?? "",
      dispose: () => session.dispose()
    };
    this.entries.set(input.sessionId, handle);
    this.maybeEvict();
    return handle;
  }

  evict(sessionId: string): void {
    const handle = this.entries.get(sessionId);
    if (!handle) return;
    handle.dispose();
    this.entries.delete(sessionId);
  }

  disposeAll(): void {
    for (const handle of this.entries.values()) handle.dispose();
    this.entries.clear();
  }

  private maybeEvict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.evict(oldestKey);
    }
  }
}
