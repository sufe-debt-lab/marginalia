import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { PiMessageCore } from "@marginalia/chat-core";
import type { ApprovalPayload } from "../agent/agent-client.js";

let clock = Date.now();
const now = () => ++clock;

export type Workspace = {
  id: string;
  name: string;
  rootDir: string;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  origin: string;
  model?: string | null;
  agentSessionPath?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Message = {
  id: string;
  sessionId: string;
  role: Exclude<PiMessageCore, { role: "toolResult" }>["role"];
  content: string;
  createdAt: number;
};

export type Provider = {
  id: string;
  name: string;
  apiKeyRef: string;
  apiKey?: string;
  baseUrl: string | null;
  defaultModel: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

function mapWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    rootDir: row.root_dir,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSession(row: any): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    origin: row.origin,
    model: row.model ?? null,
    agentSessionPath: row.agent_session_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

export function createWorkspace(db: Database.Database, input: { name: string; rootDir: string }) {
  const timestamp = now();
  const workspace = {
    id: randomUUID(),
    name: input.name,
    rootDir: input.rootDir,
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies Workspace;
  db.prepare(
    "insert into workspaces (id, name, root_dir, last_opened_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)"
  ).run(
    workspace.id,
    workspace.name,
    workspace.rootDir,
    null,
    workspace.createdAt,
    workspace.updatedAt
  );
  return workspace;
}

export function listWorkspaces(db: Database.Database) {
  return db
    .prepare("select * from workspaces order by created_at asc")
    .all()
    .map((row) => mapWorkspace(row));
}

export function markWorkspaceOpened(db: Database.Database, id: string) {
  const timestamp = now();
  db.prepare("update workspaces set last_opened_at = ?, updated_at = ? where id = ?").run(
    timestamp,
    timestamp,
    id
  );
  return getWorkspace(db, id);
}

export function getWorkspace(db: Database.Database, id: string) {
  const row = db.prepare("select * from workspaces where id = ?").get(id);
  return row ? mapWorkspace(row) : null;
}

export function getRecentWorkspace(db: Database.Database) {
  const row = db
    .prepare(
      "select * from workspaces where last_opened_at is not null order by last_opened_at desc limit 1"
    )
    .get();
  return row ? mapWorkspace(row) : null;
}

export function createSession(
  db: Database.Database,
  input: { workspaceId: string; title: string; origin?: string; model?: string | null }
) {
  const timestamp = now();
  const session = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    origin: input.origin ?? "desktop",
    model: input.model ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies Session;
  const hasModel = hasColumn(db, "sessions", "model");
  db.prepare(
    hasModel
      ? "insert into sessions (id, workspace_id, title, origin, model, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)"
      : "insert into sessions (id, workspace_id, title, origin, created_at, updated_at) values (?, ?, ?, ?, ?, ?)"
  ).run(
    ...(hasModel
      ? [
          session.id,
          session.workspaceId,
          session.title,
          session.origin,
          session.model,
          session.createdAt,
          session.updatedAt
        ]
      : [
          session.id,
          session.workspaceId,
          session.title,
          session.origin,
          session.createdAt,
          session.updatedAt
        ])
  );
  return session;
}

export function listSessions(db: Database.Database, workspaceId: string) {
  return db
    .prepare("select * from sessions where workspace_id = ? order by updated_at desc")
    .all(workspaceId)
    .map((row) => mapSession(row));
}

export function getSession(db: Database.Database, id: string) {
  const row = db.prepare("select * from sessions where id = ?").get(id);
  return row ? mapSession(row) : null;
}

export function updateSession(db: Database.Database, id: string, patch: { model?: string | null }) {
  if (patch.model !== undefined) {
    db.prepare("update sessions set model = ?, updated_at = ? where id = ?").run(
      patch.model,
      now(),
      id
    );
  }
  return getSession(db, id);
}

export function setAgentSessionPath(db: Database.Database, id: string, agentSessionPath: string) {
  db.prepare("update sessions set agent_session_path = ?, updated_at = ? where id = ?").run(
    agentSessionPath,
    now(),
    id
  );
  return getSession(db, id);
}

export function createMessage(
  db: Database.Database,
  input: { sessionId: string; role: Message["role"]; content: string }
) {
  const timestamp = now();
  const message = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    createdAt: timestamp
  } satisfies Message;
  db.prepare(
    "insert into messages (id, session_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).run(message.id, message.sessionId, message.role, message.content, message.createdAt);
  db.prepare("update sessions set updated_at = ? where id = ?").run(timestamp, message.sessionId);
  return message;
}

export function getMessages(db: Database.Database, sessionId: string) {
  return db
    .prepare("select * from messages where session_id = ? order by created_at asc")
    .all(sessionId)
    .map((row) => mapMessage(row));
}

export function createProvider(
  db: Database.Database,
  input: { name: string; apiKey: string; baseUrl?: string | null; defaultModel: string }
) {
  const timestamp = now();
  const envId = randomUUID();
  const provider = {
    id: randomUUID(),
    name: input.name,
    apiKeyRef: envId,
    baseUrl: input.baseUrl ?? null,
    defaultModel: input.defaultModel,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies Provider;
  db.prepare("insert into env_vars (id, key, value, scope, created_at) values (?, ?, ?, ?, ?)").run(
    envId,
    `${input.name.toUpperCase()}_API_KEY`,
    input.apiKey,
    "global",
    timestamp
  );
  db.prepare(
    "insert into providers (id, name, api_key_ref, base_url, default_model, enabled, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    provider.id,
    provider.name,
    provider.apiKeyRef,
    provider.baseUrl,
    provider.defaultModel,
    1,
    timestamp,
    timestamp
  );
  return provider;
}

export function listProviders(db: Database.Database) {
  return db
    .prepare("select * from providers order by created_at asc")
    .all()
    .map((row: any) => mapProvider(row));
}

export function getProvider(db: Database.Database, id: string) {
  const row = db
    .prepare(
      "select providers.*, env_vars.value as api_key from providers join env_vars on env_vars.id = providers.api_key_ref where providers.id = ?"
    )
    .get(id);
  return row ? mapProvider(row) : null;
}

export function updateProvider(
  db: Database.Database,
  id: string,
  input: {
    name?: string;
    apiKey?: string;
    baseUrl?: string | null;
    defaultModel?: string;
    enabled?: boolean;
  }
) {
  const existing = getProvider(db, id);
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const baseUrl = input.baseUrl === undefined ? existing.baseUrl : (input.baseUrl ?? null);
  const defaultModel = input.defaultModel ?? existing.defaultModel;
  const enabled = input.enabled === undefined ? existing.enabled : input.enabled;
  const timestamp = now();
  db.prepare(
    "update providers set name = ?, base_url = ?, default_model = ?, enabled = ?, updated_at = ? where id = ?"
  ).run(name, baseUrl, defaultModel, enabled ? 1 : 0, timestamp, id);
  const renamed = name !== existing.name;
  if (input.apiKey !== undefined) {
    db.prepare("update env_vars set key = ?, value = ? where id = ?").run(
      `${name.toUpperCase()}_API_KEY`,
      input.apiKey,
      existing.apiKeyRef
    );
  } else if (renamed) {
    db.prepare("update env_vars set key = ? where id = ?").run(
      `${name.toUpperCase()}_API_KEY`,
      existing.apiKeyRef
    );
  }
  return getProvider(db, id);
}

export function deleteProvider(db: Database.Database, id: string) {
  const existing = getProvider(db, id);
  if (!existing) return null;
  const tx = db.transaction(() => {
    // runs.provider_id is a NOT NULL FK with no ON DELETE, so clear the provider's
    // run history first (mirrors deleteWorkspace) to avoid a constraint failure.
    db.prepare("delete from runs where provider_id = ?").run(id);
    db.prepare("delete from providers where id = ?").run(id);
    db.prepare("delete from env_vars where id = ?").run(existing.apiKeyRef);
  });
  tx();
  return existing;
}

export function createRun(
  db: Database.Database,
  input: { sessionId: string; providerId: string; model: string }
) {
  const timestamp = now();
  const id = randomUUID();
  db.prepare(
    "insert into runs (id, session_id, provider_id, model, status, created_at) values (?, ?, ?, ?, ?, ?)"
  ).run(id, input.sessionId, input.providerId, input.model, "running", timestamp);
  return {
    id,
    sessionId: input.sessionId,
    providerId: input.providerId,
    model: input.model,
    status: "running",
    createdAt: timestamp
  };
}

export function completeRun(
  db: Database.Database,
  id: string,
  status: "completed" | "failed",
  error?: string
) {
  db.prepare("update runs set status = ?, error = ?, completed_at = ? where id = ?").run(
    status,
    error ?? null,
    now(),
    id
  );
}

export function deleteWorkspace(db: Database.Database, id: string): boolean {
  const tx = db.transaction(() => {
    const existing = db.prepare("select id from workspaces where id = ?").get(id);
    if (!existing) return false;
    const sessions = db.prepare("select id from sessions where workspace_id = ?").all(id) as {
      id: string;
    }[];
    const delMessages = db.prepare("delete from messages where session_id = ?");
    const delRuns = db.prepare("delete from runs where session_id = ?");
    const delSession = db.prepare("delete from sessions where id = ?");
    for (const s of sessions) {
      delMessages.run(s.id);
      delRuns.run(s.id);
      delSession.run(s.id);
    }
    db.prepare("delete from workspaces where id = ?").run(id);
    return true;
  });
  return tx();
}

function mapProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    apiKeyRef: row.api_key_ref,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hasColumn(db: Database.Database, table: string, column: string) {
  return db
    .prepare(`pragma table_info(${table})`)
    .all()
    .some((row: any) => row.name === column);
}

export type ApprovalRow = {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  kind: "command" | "file_edit";
  payload: ApprovalPayload;
  status: "pending" | "approved" | "denied" | "expired";
  reason: string | null;
  createdAt: number;
  decidedAt: number | null;
};

function mapApproval(row: Record<string, unknown>): ApprovalRow {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    toolCallId: row.tool_call_id as string,
    toolName: row.tool_name as string,
    kind: row.kind as ApprovalRow["kind"],
    payload: JSON.parse(row.payload as string) as ApprovalPayload,
    status: row.status as ApprovalRow["status"],
    reason: (row.reason as string | null) ?? null,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number | null) ?? null
  };
}

export function createApproval(
  db: Database.Database,
  input: {
    id: string;
    sessionId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    kind: ApprovalRow["kind"];
    payload: ApprovalPayload;
  }
): ApprovalRow {
  const now = Date.now();
  db.prepare(
    `insert into approvals (id, session_id, run_id, tool_call_id, tool_name, kind, payload, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    input.id,
    input.sessionId,
    input.runId,
    input.toolCallId,
    input.toolName,
    input.kind,
    JSON.stringify(input.payload),
    now
  );
  return getApproval(db, input.id)!;
}

export function getApproval(db: Database.Database, id: string): ApprovalRow | null {
  const row = db.prepare("select * from approvals where id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapApproval(row) : null;
}

export function decideApproval(
  db: Database.Database,
  id: string,
  status: "approved" | "denied" | "expired",
  reason?: string
): ApprovalRow | null {
  db.prepare(
    "update approvals set status = ?, reason = coalesce(?, reason), decided_at = ? where id = ?"
  ).run(status, reason ?? null, Date.now(), id);
  return getApproval(db, id);
}

export function listApprovals(db: Database.Database, sessionId: string): ApprovalRow[] {
  return (
    db
      .prepare("select * from approvals where session_id = ? order by created_at asc")
      .all(sessionId) as Record<string, unknown>[]
  ).map(mapApproval);
}

export function expirePendingApprovals(db: Database.Database, runId: string): number {
  const result = db
    .prepare(
      "update approvals set status = 'expired', decided_at = ? where run_id = ? and status = 'pending'"
    )
    .run(Date.now(), runId);
  return result.changes;
}
