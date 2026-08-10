import { streamSse } from "./sse-stream.js";
import type { ChatEntry, PiMessageCore } from "@marginalia/chat-core";

export type Workspace = {
  id: string;
  name: string;
  rootDir: string;
};

export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  origin: string;
  model?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export type { ChatEntry };

type StoredMessageRole = Exclude<PiMessageCore, { role: "toolResult" }>["role"];

export type Provider = {
  id: string;
  name: string;
  baseUrl?: string | null;
  defaultModel: string;
  enabled?: boolean;
};

export type SkillSelection = { name: string; path: string };
export type SkillStatus = "effective" | "shadowed" | "disabled" | "invalid";
export type SkillSource =
  | "workspace_marginalia"
  | "workspace_pi"
  | "ancestor_agents"
  | "user_marginalia"
  | "user_pi"
  | "user_agents";

export type SkillDiagnostic = {
  code: string;
  level: "warning" | "error";
  message: string;
  path?: string;
  collision?: {
    resourceType: "extension" | "skill" | "prompt" | "theme";
    name: string;
    winnerPath: string;
    loserPath: string;
    winnerSource?: string;
    loserSource?: string;
  };
};

export type InvalidSkillSelection = {
  name: string;
  path: string;
  reason:
    | "missing"
    | "disabled"
    | "invalid"
    | "shadowed"
    | "name_mismatch"
    | "too_large"
    | "unsupported_identifier";
  winnerPath?: string;
};

export type SkillCandidate = {
  name: string | null;
  description: string | null;
  discoveredPath: string;
  canonicalPath: string;
  source: SkillSource;
  scope: "workspace" | "user";
  status: SkillStatus;
  enabled: boolean;
  effective: boolean;
  explicitOnly: boolean;
  explicitEligible: boolean;
  shadowedBy: string | null;
  bytesTotal: number;
  diagnostics: SkillDiagnostic[];
};

export type SkillCatalogSnapshot = {
  workspaceId: string | null;
  catalogRevision: string;
  effectiveRevision: string;
  refreshedAt: number;
  candidates: SkillCandidate[];
  diagnostics: SkillDiagnostic[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiError(response: Response): Promise<ApiError> {
  const parsed = (await response.json().catch(() => ({}))) as unknown;
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const code = typeof body.error === "string" ? body.error : "http_error";
  const message = typeof body.message === "string" ? body.message : code;
  return new ApiError(message, response.status, code, body);
}

export type RunEvent = {
  type: string;
  run_id?: string;
  session_id?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export type FileEntry = { path: string; name: string; kind: "file" };
export type DocumentContent = {
  path: string;
  mime: string;
  text: string;
  language?: string;
  lineCount?: number;
  lineCountExact?: boolean;
  bytesRead?: number;
  bytesTotal?: number;
  rawOnly?: boolean;
  truncated: boolean;
};

export type ApprovalPayload =
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
    };

export type Approval = {
  id: string;
  toolCallId: string;
  toolName: string;
  kind: "command" | "file_edit";
  payload: ApprovalPayload;
  status: "pending" | "approved" | "denied" | "expired";
  reason?: string | null;
};

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetch: (input: string, init?: RequestInit) => Promise<Response> = (
      input,
      init
    ) => globalThis.fetch(input, init)
  ) {}

  private jsonHeaders(): HeadersInit {
    return {
      "content-type": "application/json"
    };
  }

  listWorkspaces() {
    return this.request<Workspace[]>("/workspaces");
  }

  createWorkspace(input: { name: string; rootDir: string }) {
    return this.request<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(input) });
  }

  createQuickChat() {
    return this.request<Session>("/quick-chat", { method: "POST" });
  }

  listSessions(workspaceId: string) {
    return this.request<Session[]>(`/workspaces/${workspaceId}/sessions`);
  }

  createSession(input: { workspaceId: string; title: string }) {
    return this.request<Session>("/sessions", { method: "POST", body: JSON.stringify(input) });
  }

  listMessages(sessionId: string) {
    return this.request<ChatEntry[]>(`/sessions/${sessionId}/messages`);
  }

  createMessage(sessionId: string, input: { role: StoredMessageRole; content: string }) {
    return this.request<ChatEntry>(`/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  listProviders() {
    return this.request<Provider[]>("/providers");
  }

  listSkills(workspaceId?: string | null): Promise<SkillCatalogSnapshot> {
    const query = new URLSearchParams();
    if (workspaceId != null) query.set("workspaceId", workspaceId);
    const search = query.toString();
    return this.request<SkillCatalogSnapshot>(`/skills${search ? `?${search}` : ""}`, {
      headers: this.jsonHeaders()
    });
  }

  setSkillEnabled(input: {
    path: string;
    enabled: boolean;
    workspaceId?: string | null;
  }): Promise<SkillCatalogSnapshot> {
    const body = {
      path: input.path,
      enabled: input.enabled,
      ...(input.workspaceId != null ? { workspaceId: input.workspaceId } : {})
    };
    return this.request<SkillCatalogSnapshot>("/skills/state", {
      method: "PATCH",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body)
    });
  }

  readSkillContent(input: { path: string; workspaceId?: string | null }): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    bytesTotal: number;
  }> {
    const query = new URLSearchParams({ path: input.path });
    if (input.workspaceId != null) query.set("workspaceId", input.workspaceId);
    return this.request(`/skills/content?${query}`, { headers: this.jsonHeaders() });
  }

  createProvider(input: {
    name: string;
    apiKey: string;
    baseUrl?: string | null;
    defaultModel: string;
  }) {
    return this.request<Provider>("/providers", { method: "POST", body: JSON.stringify(input) });
  }

  testProvider(providerId: string) {
    return this.request<{ ok: boolean; message: string }>(`/providers/${providerId}/test`, {
      method: "POST"
    });
  }

  updateProvider(
    providerId: string,
    input: {
      name?: string;
      apiKey?: string;
      baseUrl?: string | null;
      defaultModel?: string;
      enabled?: boolean;
    }
  ) {
    return this.request<Provider>(`/providers/${providerId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  deleteProvider(providerId: string): Promise<void> {
    return this.requestNoContent(`/providers/${providerId}`, "DELETE");
  }

  listFiles(workspaceId: string) {
    return this.request<FileEntry[]>(`/workspaces/${workspaceId}/files`);
  }

  readDocument(workspaceId: string, path: string) {
    return this.request<DocumentContent>(
      `/workspaces/${workspaceId}/files/content?path=${encodeURIComponent(path)}`
    );
  }

  async readRawDocument(workspaceId: string, path: string) {
    const response = await this.fetch(
      `${this.baseUrl}/workspaces/${workspaceId}/files/raw?path=${encodeURIComponent(path)}`
    );
    if (!response.ok) throw await apiError(response);
    return response.blob();
  }

  searchFiles(workspaceId: string, q: string) {
    return this.request<{ path: string; match: "name" | "content" }[]>(
      `/workspaces/${workspaceId}/files/search?q=${encodeURIComponent(q)}`
    );
  }

  writeWorkspaceFile(
    workspaceId: string,
    input: { path: string; content: string; overwrite?: boolean }
  ) {
    return this.request<{ path: string }>(`/workspaces/${workspaceId}/files/content`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  updateSession(sessionId: string, input: { model: string | null }) {
    return this.request<Session>(`/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  listApprovals(sessionId: string) {
    return this.request<Approval[]>(`/sessions/${sessionId}/approvals`);
  }

  resolveApproval(
    sessionId: string,
    approvalId: string,
    input: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }
  ) {
    return this.request<{ ok: boolean }>(`/sessions/${sessionId}/approvals/${approvalId}`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async runChat(
    sessionId: string,
    input: {
      providerId: string;
      model?: string;
      message: string;
      contextFiles?: string[];
      skills?: SkillSelection[];
      permission?: "full" | "ask" | "readonly";
      reasoning?: "low" | "medium" | "high" | "xhigh";
    },
    options: { signal?: AbortSignal } = {}
  ): Promise<AsyncIterable<RunEvent>> {
    const response = await this.fetch(`${this.baseUrl}/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(input),
      signal: options.signal
    });
    if (!response.ok) {
      throw await apiError(response);
    }
    return streamSse<RunEvent>(response.body);
  }

  deleteWorkspace(id: string): Promise<void> {
    return this.requestNoContent(`/workspaces/${id}`, "DELETE");
  }

  /** Like request(), but for endpoints that answer 204 No Content. */
  async requestNoContent(path: string, method: string): Promise<void> {
    const response = await this.fetch(`${this.baseUrl}${path}`, { method });
    if (response.status === 204) return;
    throw await apiError(response);
  }

  async getBranch(workspaceId: string): Promise<string | null> {
    try {
      const response = await this.fetch(`${this.baseUrl}/workspaces/${workspaceId}/branch`);
      if (!response.ok) return null;
      const body = (await response.json()) as { branch?: string };
      return body.branch ?? null;
    } catch {
      return null;
    }
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers }
    });
    if (!response.ok) {
      throw await apiError(response);
    }
    return (await response.json()) as T;
  }
}
