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
  /** Model/provider/tool profile identity. Omitted only by legacy or isolated callers. */
  runtimeRevision?: string;
  /** Extra config (model, tools, etc.). Forwarded to createSession. */
  config?: Record<string, unknown>;
};

export type SessionHandle = {
  sessionId: string;
  workspaceRoot: string;
  resourceRevision: string;
  runtimeRevision: string;
  session: AgentSession;
  sessionFile: string;
  /** Protects this session from idle-LRU eviction until the returned release is called. */
  pin(): () => void;
  dispose(): void;
};

export type SessionReservation = {
  handle: SessionHandle;
  release(): void;
};

type RegistryEntry = SessionHandle & { activePins: number };

function defaultSessionManagerFor(workspaceRoot: string, existing: string | null): SessionManager {
  if (!existing) return PiSessionManager.create(workspaceRoot);
  try {
    return PiSessionManager.open(existing, undefined, workspaceRoot);
  } catch {
    return PiSessionManager.create(workspaceRoot);
  }
}

export class AgentSessionRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
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
    return (await this.acquireEntry(input, false)).handle;
  }

  async acquirePinned(input: AcquireInput): Promise<SessionReservation> {
    const reservation = await this.acquireEntry(input, true);
    return { handle: reservation.handle, release: reservation.release! };
  }

  private async acquireEntry(
    input: AcquireInput,
    pinned: boolean
  ): Promise<{ handle: SessionHandle; release?: () => void }> {
    const hit = this.entries.get(input.sessionId);
    if (
      hit &&
      hit.workspaceRoot === input.workspaceRoot &&
      hit.resourceRevision === input.resourceRevision &&
      hit.runtimeRevision === (input.runtimeRevision ?? "")
    ) {
      this.entries.delete(input.sessionId); // move to MRU
      this.entries.set(input.sessionId, hit);
      return { handle: hit, ...(pinned ? { release: hit.pin() } : {}) };
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

    const handle: RegistryEntry = {
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      resourceRevision: input.resourceRevision,
      runtimeRevision: input.runtimeRevision ?? "",
      session,
      sessionFile: session.sessionFile ?? "",
      activePins: 0,
      pin: () => {
        handle.activePins += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          handle.activePins -= 1;
          this.maybeEvict();
        };
      },
      dispose: () => session.dispose()
    };
    this.entries.set(input.sessionId, handle);
    const release = pinned ? handle.pin() : undefined;
    this.maybeEvict(input.sessionId);
    return { handle, ...(release ? { release } : {}) };
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

  private maybeEvict(protectedSessionId?: string): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = [...this.entries].find(
        ([sessionId, handle]) => sessionId !== protectedSessionId && handle.activePins === 0
      )?.[0];
      if (!oldestKey) break;
      this.evict(oldestKey);
    }
  }
}
