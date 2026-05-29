import { streamSse } from "./sse-stream.js";

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
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type Provider = {
  id: string;
  name: string;
  baseUrl?: string | null;
  defaultModel: string;
};

export type RunEvent = {
  type: string;
  run_id?: string;
  session_id?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export type FileEntry = { path: string; name: string; kind: "file" };
export type DocumentContent = { path: string; mime: string; text: string; pages?: number; truncated: boolean };

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

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
    return this.request<Message[]>(`/sessions/${sessionId}/messages`);
  }

  createMessage(sessionId: string, input: { role: Message["role"]; content: string }) {
    return this.request<Message>(`/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  listProviders() {
    return this.request<Provider[]>("/providers");
  }

  createProvider(input: { name: string; apiKey: string; baseUrl?: string | null; defaultModel: string }) {
    return this.request<Provider>("/providers", { method: "POST", body: JSON.stringify(input) });
  }

  testProvider(providerId: string) {
    return this.request<{ ok: boolean; message: string }>(`/providers/${providerId}/test`, { method: "POST" });
  }

  listFiles(workspaceId: string) {
    return this.request<FileEntry[]>(`/workspaces/${workspaceId}/files`);
  }

  readDocument(workspaceId: string, path: string) {
    return this.request<DocumentContent>(`/workspaces/${workspaceId}/files/content?path=${encodeURIComponent(path)}`);
  }

  searchFiles(workspaceId: string, q: string) {
    return this.request<{ path: string; match: "name" | "content" }[]>(
      `/workspaces/${workspaceId}/files/search?q=${encodeURIComponent(q)}`
    );
  }

  updateSession(sessionId: string, input: { model: string | null }) {
    return this.request<Session>(`/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  async runChat(
    sessionId: string,
    input: {
      providerId: string;
      model?: string;
      message: string;
      contextFiles?: string[];
      permission?: "full" | "ask" | "readonly";
      reasoning?: "low" | "medium" | "high" | "xhigh";
    }
  ): Promise<AsyncIterable<RunEvent>> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
      throw new Error(error.error ?? response.statusText);
    }
    return streamSse<RunEvent>(response.body);
  }

  async deleteWorkspace(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/workspaces/${id}`, { method: "DELETE" });
    if (response.status === 204) return;
    const error = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(error.error ?? response.statusText);
  }

  async getBranch(workspaceId: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/workspaces/${workspaceId}/branch`);
      if (!response.ok) return null;
      const body = (await response.json()) as { branch?: string };
      return body.branch ?? null;
    } catch {
      return null;
    }
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers }
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
      throw new Error(error.error ?? response.statusText);
    }
    return (await response.json()) as T;
  }
}
