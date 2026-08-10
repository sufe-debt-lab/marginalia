import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type Database from "better-sqlite3";
import { AuthStorage, ModelRegistry, createAgentSession } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { emptyUsage } from "@marginalia/chat-core";
import type { ChatEntry } from "@marginalia/chat-core";
import type {
  AgentClient,
  AgentRunExecution,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent
} from "./agent/agent-client.js";
import { buildAgentMessage } from "./agent/agent-message.js";
import { AgentSessionRegistry } from "./agent/agent-session-registry.js";
import { ApprovalGateway } from "./agent/approval-gateway.js";
import { PiCodingAgentClient } from "./agent/pi-coding-agent-client.js";
import { piProviderId } from "./agent/provider-id.js";
import { readMessagesFromSessionFile } from "./agent/session-messages.js";
import { migrate } from "./db/migrations.js";
import { openDatabase } from "./db/connection.js";
import {
  completeRun,
  createApproval,
  createMessage,
  createProvider,
  createRun,
  createSession,
  createWorkspace,
  decideApproval,
  deleteProvider,
  deleteWorkspace,
  expirePendingApprovals,
  getMessages,
  getSession,
  getWorkspace,
  getProvider,
  getRecentWorkspace,
  listApprovals,
  listProviders,
  listSessions,
  listWorkspaces,
  type Message,
  markWorkspaceOpened,
  setAgentSessionPath,
  updateProvider,
  updateSession
} from "./db/repositories.js";
import { createSkillPreferenceStore } from "./db/skill-preferences.js";
import {
  DocumentPreviewError,
  mimeFromPath,
  previewErrorStatus,
  readDocument,
  type DocumentContent
} from "./files/document-reader.js";
import { listWorkspaceFiles, searchWorkspaceFiles } from "./files/file-tree.js";
import { resolveWorkspacePath } from "./files/path-sandbox.js";
import { createHealthInfo } from "./health.js";
import { ModelAvailabilityChecker } from "./providers/provider-availability.js";
import { SessionRunLeases } from "./run/session-run-leases.js";
import { RequestBodyTooLargeError, readJsonBodyWithinLimit } from "./run/request-body.js";
import {
  authorizeLoopbackAccess,
  isAllowedOrigin,
  type LoopbackAccessPolicy
} from "./security/loopback-access.js";
import {
  SkillCandidateNotFoundError,
  createSkillCatalogService,
  toPublicSkillCatalogSnapshot
} from "./skills/catalog.js";
import type { SkillCatalogService } from "./skills/types.js";
import {
  SkillPayloadTooLargeError,
  SkillPreconditionError,
  prepareSkillTurn,
  type SkillSelection
} from "./skills/turn-preflight.js";

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
  agentClient?: AgentClient;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  availabilityChecker?: ModelAvailabilityChecker;
  documentReader?: (rootDir: string, relativePath: string) => Promise<DocumentContent>;
  loopbackAccess?: LoopbackAccessPolicy;
  skillCatalog?: SkillCatalogService;
};

const DEFAULT_AUTH_PATH = path.join(homedir(), ".marginalia", "auth.json");

export function createApp(options: AppOptions = {}) {
  const startedAt = options.startedAt ?? new Date();
  const db = options.db ?? openDatabase();
  const documentReader = options.documentReader ?? readDocument;
  const authStorage = options.authStorage ?? AuthStorage.create(DEFAULT_AUTH_PATH);
  const modelRegistry = options.modelRegistry ?? ModelRegistry.inMemory(authStorage);
  const registry = new AgentSessionRegistry({
    authStorage,
    modelRegistry,
    createSession: (config) =>
      createAgentSession(config as Parameters<typeof createAgentSession>[0])
  });
  const approvalGateway = new ApprovalGateway();
  const agentClient =
    options.agentClient ??
    new PiCodingAgentClient(
      registry,
      (provider, modelId) => {
        try {
          // getModel's typed overloads only accept its literal provider/model unions;
          // here provider/modelId are dynamic strings from the registry.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return getModel(provider as any, modelId as any) ?? null;
        } catch {
          return null;
        }
      },
      approvalGateway
    );
  const availabilityChecker =
    options.availabilityChecker ?? new ModelAvailabilityChecker(modelRegistry);
  const enforceLoopbackAccess = options.loopbackAccess !== undefined;
  const loopbackAccess = options.loopbackAccess ?? {
    bearer: null,
    allowedOrigins: new Set<string>()
  };
  const runLeases = new SessionRunLeases();

  migrate(db);
  syncProviderKeys(db, authStorage);
  const skillCatalog =
    options.skillCatalog ??
    createSkillCatalogService({
      homeDir: homedir(),
      preferences: createSkillPreferenceStore(db)
    });

  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || !enforceLoopbackAccess) return next();

    const accessFailure = authorizeLoopbackAccess(c.req.raw, loopbackAccess);
    if (accessFailure === 403) return c.json({ error: "origin_forbidden" }, 403);
    return next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin || null, loopbackAccess) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"]
    })
  );
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.method === "OPTIONS" || !enforceLoopbackAccess) {
      return next();
    }
    const accessFailure = authorizeLoopbackAccess(c.req.raw, loopbackAccess);
    return accessFailure === 401 ? c.json({ error: "unauthorized" }, 401) : next();
  });
  app.get("/health", (c) => c.json(createHealthInfo(startedAt)));
  app.get("/skills", async (c) => {
    const workspaceId = c.req.query("workspaceId");
    const workspace = workspaceId === undefined ? null : getWorkspace(db, workspaceId);
    if (workspaceId !== undefined && !workspace) {
      return c.json({ error: "workspace not found" }, 404);
    }
    try {
      const snapshot = await skillCatalog.refresh({
        workspaceId: workspace?.id ?? null,
        workspaceRoot: workspace?.rootDir ?? null
      });
      return c.json(toPublicSkillCatalogSnapshot(snapshot));
    } catch {
      return c.json({ error: "skills unavailable" }, 500);
    }
  });
  app.patch("/skills/state", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid request" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as { path?: unknown }).path !== "string" ||
      typeof (body as { enabled?: unknown }).enabled !== "boolean" ||
      ((body as { workspaceId?: unknown }).workspaceId !== undefined &&
        typeof (body as { workspaceId?: unknown }).workspaceId !== "string")
    ) {
      return c.json({ error: "invalid request" }, 400);
    }
    const input = body as { path: string; enabled: boolean; workspaceId?: string };
    const workspace = input.workspaceId === undefined ? null : getWorkspace(db, input.workspaceId);
    if (input.workspaceId !== undefined && !workspace) {
      return c.json({ error: "workspace not found" }, 404);
    }
    try {
      const snapshot = await skillCatalog.setEnabled({
        workspaceId: workspace?.id ?? null,
        workspaceRoot: workspace?.rootDir ?? null,
        path: input.path,
        enabled: input.enabled
      });
      return c.json(toPublicSkillCatalogSnapshot(snapshot));
    } catch (error) {
      if (error instanceof SkillCandidateNotFoundError) {
        return c.json({ error: "skill not found" }, 404);
      }
      return c.json({ error: "skills unavailable" }, 500);
    }
  });
  app.get("/skills/content", async (c) => {
    const workspaceId = c.req.query("workspaceId");
    const workspace = workspaceId === undefined ? null : getWorkspace(db, workspaceId);
    if (workspaceId !== undefined && !workspace) {
      return c.json({ error: "workspace not found" }, 404);
    }
    try {
      const snapshot = await skillCatalog.refresh({
        workspaceId: workspace?.id ?? null,
        workspaceRoot: workspace?.rootDir ?? null
      });
      const requestedPath = c.req.query("path");
      const candidate = snapshot.candidates.find((item) => item.canonicalPath === requestedPath);
      if (!candidate) return c.json({ error: "skill not found" }, 404);
      return c.json({
        path: candidate.canonicalPath,
        content: candidate.previewContent,
        truncated: candidate.previewTruncated,
        bytesTotal: candidate.bytesTotal
      });
    } catch {
      return c.json({ error: "skills unavailable" }, 500);
    }
  });
  app.get("/workspaces", (c) => c.json(listWorkspaces(db)));
  app.post("/workspaces", async (c) => {
    const body = await c.req.json<{ name: string; rootDir: string }>();
    return c.json(createWorkspace(db, body), 201);
  });
  app.patch("/workspaces/:id/open", (c) => {
    const workspace = markWorkspaceOpened(db, c.req.param("id"));
    return workspace ? c.json(workspace) : c.json({ error: "workspace not found" }, 404);
  });
  app.delete("/workspaces/:id", (c) => {
    const ok = deleteWorkspace(db, c.req.param("id"));
    if (!ok) return c.json({ error: "workspace not found" }, 404);
    return c.body(null, 204);
  });
  app.get("/workspaces/:id/sessions", (c) => c.json(listSessions(db, c.req.param("id"))));
  app.get("/workspaces/:id/files", (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(listWorkspaceFiles(workspace.rootDir));
  });
  app.get("/workspaces/:id/files/content", async (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    try {
      return c.json(await documentReader(workspace.rootDir, c.req.query("path") ?? ""));
    } catch (error) {
      if ((error as Error).message === "Path escapes workspace")
        return c.json({ error: "Path escapes workspace" }, 403);
      if (error instanceof DocumentPreviewError) {
        return c.json(
          { error: error.message, code: error.code, ...error.meta },
          previewErrorStatus(error.code)
        );
      }
      return c.json({ error: "file not found" }, 404);
    }
  });
  app.get("/workspaces/:id/files/raw", (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    const filePath = c.req.query("path") ?? "";
    try {
      const absolute = resolveWorkspacePath(workspace.rootDir, filePath);
      const stat = statSync(absolute);
      if (!stat.isFile()) return c.json({ error: "not a file" }, 400);
      const stream = createReadStream(absolute);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "content-type": mimeFromPath(filePath),
          "content-length": String(stat.size),
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`
        }
      });
    } catch (error) {
      if ((error as Error).message === "Path escapes workspace")
        return c.json({ error: "Path escapes workspace" }, 403);
      return c.json({ error: "file not found" }, 404);
    }
  });
  app.get("/workspaces/:id/files/search", async (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(await searchWorkspaceFiles(workspace.rootDir, c.req.query("q") ?? ""));
  });
  app.put("/workspaces/:id/files/content", async (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    const body = await c.req.json<{ path: string; content: string; overwrite?: boolean }>();
    try {
      const absolute = resolveWorkspacePath(workspace.rootDir, body.path ?? "");
      const exists = existsSync(absolute);
      if (exists && !body.overwrite) return c.json({ error: "file exists" }, 409);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, body.content ?? "", "utf8");
      return c.json({ path: body.path }, exists ? 200 : 201);
    } catch (error) {
      if ((error as Error).message === "Path escapes workspace")
        return c.json({ error: "Path escapes workspace" }, 403);
      return c.json({ error: (error as Error).message }, 500);
    }
  });
  app.post("/sessions", async (c) => {
    const body = await c.req.json<{ workspaceId: string; title: string; origin?: string }>();
    return c.json(createSession(db, body), 201);
  });
  app.patch("/sessions/:sessionId", async (c) => {
    const body = await c.req.json<{ model?: string | null }>();
    const session = updateSession(db, c.req.param("sessionId"), { model: body.model });
    return session ? c.json(session) : c.json({ error: "session not found" }, 404);
  });
  app.get("/sessions/:sessionId/messages", (c) => {
    const session = getSession(db, c.req.param("sessionId"));
    if (!session) return c.json({ error: "session not found" }, 404);
    if (session.agentSessionPath) {
      return c.json(readMessagesFromSessionFile(session.agentSessionPath));
    }
    return c.json(getMessages(db, session.id).map(storedMessageToChatEntry));
  });
  app.post("/sessions/:sessionId/messages", async (c) => {
    const body = await c.req.json<{ role: Message["role"]; content: string }>();
    return c.json(
      storedMessageToChatEntry(createMessage(db, { sessionId: c.req.param("sessionId"), ...body })),
      201
    );
  });
  app.post("/sessions/:sessionId/approvals/:approvalId", async (c) => {
    const body = await c.req.json<{
      approved: boolean;
      reason?: string;
      alwaysAllowPrefix?: boolean;
    }>();
    const approvalId = c.req.param("approvalId");
    const ok = agentClient.resolveApproval(c.req.param("sessionId"), approvalId, body);
    if (!ok) return c.json({ error: "approval not found or already resolved" }, 404);
    decideApproval(db, approvalId, body.approved ? "approved" : "denied", body.reason);
    return c.json({ ok: true });
  });
  app.get("/sessions/:sessionId/approvals", (c) =>
    c.json(listApprovals(db, c.req.param("sessionId")))
  );
  app.post("/quick-chat", (c) => {
    const workspace = getRecentWorkspace(db);
    if (!workspace) return c.json({ error: "workspace required" }, 409);
    return c.json(
      createSession(db, { workspaceId: workspace.id, title: "Quick chat", origin: "quick_chat" }),
      201
    );
  });
  app.get("/providers", (c) => c.json(listProviders(db)));
  app.post("/providers", async (c) => {
    const body = await c.req.json<{
      name: string;
      apiKey: string;
      baseUrl?: string | null;
      defaultModel: string;
    }>();
    const provider = createProvider(db, body);
    const piId = piProviderId(provider.name);
    if (piId && body.apiKey) authStorage.setRuntimeApiKey(piId, body.apiKey);
    return c.json(provider, 201);
  });
  app.post("/providers/:id/test", async (c) => {
    const provider = getProvider(db, c.req.param("id"));
    if (!provider) return c.json({ error: "provider not found" }, 404);
    return c.json(
      availabilityChecker.check({
        piProviderId: piProviderId(provider.name),
        modelId: provider.defaultModel
      })
    );
  });
  app.patch("/providers/:id", async (c) => {
    const before = getProvider(db, c.req.param("id"));
    if (!before) return c.json({ error: "provider not found" }, 404);
    const body = await c.req.json<{
      name?: string;
      apiKey?: string;
      baseUrl?: string | null;
      defaultModel?: string;
      enabled?: boolean;
    }>();
    const after = updateProvider(db, before.id, body);
    if (!after) return c.json({ error: "provider not found" }, 404);

    // Keep the pi runtime key in sync: drop the old provider id on rename, then
    // set/clear the new one based on whether the provider is enabled.
    const oldPiId = piProviderId(before.name);
    const newPiId = piProviderId(after.name);
    const apiKey = body.apiKey ?? before.apiKey;
    if (oldPiId && oldPiId !== newPiId) authStorage.removeRuntimeApiKey(oldPiId);
    if (newPiId) {
      // Set when enabled with a non-empty key; otherwise drop any stale override
      // (disabled, or the key was explicitly blanked).
      if (after.enabled && apiKey) authStorage.setRuntimeApiKey(newPiId, apiKey);
      else authStorage.removeRuntimeApiKey(newPiId);
    }

    const { apiKey: _omit, ...safe } = after;
    return c.json(safe);
  });
  app.delete("/providers/:id", async (c) => {
    const removed = deleteProvider(db, c.req.param("id"));
    if (!removed) return c.json({ error: "provider not found" }, 404);
    const piId = piProviderId(removed.name);
    if (piId) authStorage.removeRuntimeApiKey(piId);
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = getSession(db, sessionId);
    if (!session) return c.json({ error: "session not found" }, 404);
    const workspace = getWorkspace(db, session.workspaceId);
    if (!workspace) return c.json({ error: "workspace not found" }, 404);

    let body: {
      providerId: string;
      message: string;
      model?: string;
      contextFiles?: string[];
      skills?: SkillSelection[];
      permission?: "full" | "ask" | "readonly";
      reasoning?: "low" | "medium" | "high" | "xhigh" | null;
    };
    try {
      body = await readJsonBodyWithinLimit(c.req.raw);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "skill_payload_too_large" }, 413);
      }
      throw error;
    }
    const provider = getProvider(db, body.providerId);
    if (!provider) return c.json({ error: "provider not found" }, 404);
    if (!provider.enabled) return c.json({ error: "provider disabled" }, 409);

    const modelId = body.model ?? provider.defaultModel;
    const lease = runLeases.tryAcquire(sessionId);
    if (!lease) return c.json({ error: "session_busy" }, 409);

    let agentMessage: string;
    let prepared: Awaited<ReturnType<AgentClient["prepare"]>> | null = null;
    let run: ReturnType<typeof createRun>;
    let catalogRevision: string | null = null;
    try {
      if (
        body.skills !== undefined &&
        (!Array.isArray(body.skills) ||
          body.skills.some(
            (selection) =>
              !selection ||
              typeof selection !== "object" ||
              typeof selection.name !== "string" ||
              typeof selection.path !== "string"
          ))
      ) {
        throw new Error("invalid skills");
      }
      const snapshot = await skillCatalog.refresh({
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootDir
      });
      const runtimeWorkspaceRoot = snapshot.workspaceRoot ?? workspace.rootDir;
      catalogRevision = snapshot.catalogRevision;
      const skillTurn = prepareSkillTurn(snapshot, body.skills ?? []);
      agentMessage = await buildAgentMessage({
        workspaceRoot: runtimeWorkspaceRoot,
        text: body.message,
        contextFiles: body.contextFiles ?? [],
        skillBlocks: skillTurn.blocks
      });
      prepared = await agentClient.prepare({
        sessionId,
        workspaceRoot: runtimeWorkspaceRoot,
        piProviderId: piProviderId(provider.name),
        modelId,
        agentSessionPath: session.agentSessionPath ?? null,
        permission: body.permission,
        reasoning: body.reasoning ?? null,
        runtimeSkills: skillTurn.runtime
      });
      if (prepared.sessionFile) setAgentSessionPath(db, sessionId, prepared.sessionFile);
      run = createRun(db, { sessionId, providerId: provider.id, model: modelId });
    } catch (error) {
      prepared?.release();
      lease.release();
      if (error instanceof SkillPreconditionError && catalogRevision !== null) {
        return c.json(
          {
            error: "skill_precondition_failed",
            catalogRevision,
            invalidSelections: error.invalidSelections
          },
          409
        );
      }
      if (error instanceof SkillPayloadTooLargeError) {
        return c.json({ error: "skill_payload_too_large" }, 413);
      }
      return c.json({ error: "run_preparation_failed" }, 500);
    }

    if (!prepared) {
      lease.release();
      return c.json({ error: "run_preparation_failed" }, 500);
    }
    const preparedRun = prepared;

    return streamSSE(c, async (sse) => {
      const emit = async (type: string, payload: Record<string, unknown> = {}) => {
        await sse.writeSSE({
          data: JSON.stringify({
            run_id: run.id,
            session_id: sessionId,
            type,
            payload,
            created_at: new Date().toISOString()
          })
        });
      };
      let failed = false;
      let execution: AgentRunExecution | null = null;
      try {
        await emit("run_started", { model: modelId });
        execution = preparedRun.start(agentMessage);

        let abortRequested = false;
        const onAbort = () => {
          if (abortRequested) return;
          abortRequested = true;
          execution?.abort();
          agentClient.cancelPending(sessionId);
        };
        c.req.raw.signal.addEventListener("abort", onAbort, { once: true });
        if (c.req.raw.signal.aborted) onAbort();

        try {
          // Single source of truth: forward raw pi events; the client derives all
          // UI (bubbles, deltas, tool cards, thinking) from them. Only the run-level
          // envelope (started/failed/completed) is added on top.
          for await (const event of execution.events) {
            const type = (event as { type?: string }).type;
            if (type === "approval_requested") {
              const approval = event as ApprovalRequestedEvent;
              createApproval(db, {
                id: approval.approvalId,
                sessionId,
                runId: run.id,
                toolCallId: approval.toolCallId,
                toolName: approval.toolName,
                kind: approval.payload.kind,
                payload: approval.payload
              });
              await emit("approval_requested", { approval });
              continue;
            }
            if (type === "approval_resolved") {
              const approval = event as ApprovalResolvedEvent;
              if (approval.expired) decideApproval(db, approval.approvalId, "expired");
              await emit("approval_resolved", { approval });
              continue;
            }
            await emit("agent_event", { event });
            const e = event as {
              type?: string;
              message?: { stopReason?: string; errorMessage?: string };
            };
            if (e?.type === "message_end" && e.message?.stopReason === "error") {
              const msg = e.message.errorMessage ?? "agent failed";
              await emit("run_failed", { error: msg });
              completeRun(db, run.id, "failed", msg);
              failed = true;
              break;
            }
          }
        } catch (failure) {
          onAbort();
          throw failure;
        } finally {
          if (c.req.raw.signal.aborted) onAbort();
          try {
            await execution.settled;
          } finally {
            c.req.raw.signal.removeEventListener("abort", onAbort);
          }
        }

        if (!failed) {
          await emit("run_completed");
          completeRun(db, run.id, "completed");
        }
      } catch (error) {
        const msg = (error as Error).message;
        try {
          await emit("run_failed", { error: msg });
        } catch {
          // The client may already be disconnected; DB completion still matters.
        }
        completeRun(db, run.id, "failed", msg);
      } finally {
        try {
          if (execution === null) preparedRun.release();
          agentClient.cancelPending(sessionId);
          expirePendingApprovals(db, run.id);
        } finally {
          lease.release();
        }
      }
    });
  });

  return app;
}

function storedMessageToChatEntry(message: Message): ChatEntry {
  if (message.role === "user") {
    return {
      id: message.id,
      message: { role: "user", content: message.content, timestamp: message.createdAt }
    };
  }
  return {
    id: message.id,
    message: {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: "marginalia-legacy",
      provider: "marginalia",
      model: "",
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: message.createdAt
    }
  };
}

function syncProviderKeys(db: Database.Database, authStorage: AuthStorage) {
  const rows = db
    .prepare(
      "select providers.name as name, env_vars.value as api_key from providers join env_vars on env_vars.id = providers.api_key_ref where providers.enabled = 1"
    )
    .all() as Array<{ name: string; api_key: string }>;
  for (const row of rows) {
    const piId = piProviderId(row.name);
    if (piId && row.api_key) authStorage.setRuntimeApiKey(piId, row.api_key);
  }
}
