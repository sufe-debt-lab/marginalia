import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createReadStream, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type Database from "better-sqlite3";
import { AuthStorage, ModelRegistry, createAgentSession } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import type { AgentClient } from "./agent/agent-client.js";
import { AgentSessionRegistry } from "./agent/agent-session-registry.js";
import { PiCodingAgentClient } from "./agent/pi-coding-agent-client.js";
import { piProviderId } from "./agent/provider-id.js";
import { readMessagesFromSessionFile } from "./agent/session-messages.js";
import { migrate } from "./db/migrations.js";
import { openDatabase } from "./db/connection.js";
import {
  completeRun,
  createMessage,
  createProvider,
  createRun,
  createSession,
  createWorkspace,
  deleteWorkspace,
  getMessages,
  getSession,
  getWorkspace,
  getProvider,
  getRecentWorkspace,
  listProviders,
  listSessions,
  listWorkspaces,
  markWorkspaceOpened,
  setAgentSessionPath,
  updateSession
} from "./db/repositories.js";
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

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
  agentClient?: AgentClient;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  availabilityChecker?: ModelAvailabilityChecker;
  documentReader?: (rootDir: string, relativePath: string) => Promise<DocumentContent>;
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
  const agentClient =
    options.agentClient ??
    new PiCodingAgentClient(registry, (provider, modelId) => {
      try {
        return getModel(provider as any, modelId as any) ?? null;
      } catch {
        return null;
      }
    });
  const availabilityChecker =
    options.availabilityChecker ?? new ModelAvailabilityChecker(modelRegistry);

  migrate(db);
  syncProviderKeys(db, authStorage);

  const app = new Hono();
  app.use("*", cors({ origin: (origin) => origin }));
  app.get("/health", (c) => c.json(createHealthInfo(startedAt)));
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
    return c.json(getMessages(db, session.id));
  });
  app.post("/sessions/:sessionId/messages", async (c) => {
    const body = await c.req.json<{ role: "user" | "assistant" | "system"; content: string }>();
    return c.json(createMessage(db, { sessionId: c.req.param("sessionId"), ...body }), 201);
  });
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

  app.post("/sessions/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = getSession(db, sessionId);
    if (!session) return c.json({ error: "session not found" }, 404);
    const workspace = getWorkspace(db, session.workspaceId);
    if (!workspace) return c.json({ error: "workspace not found" }, 404);

    const body = await c.req.json<{
      providerId: string;
      message: string;
      model?: string;
      contextFiles?: string[];
      permission?: "full" | "ask" | "readonly";
      reasoning?: "low" | "medium" | "high" | "xhigh" | null;
    }>();
    const provider = getProvider(db, body.providerId);
    if (!provider) return c.json({ error: "provider not found" }, 404);

    const modelId = body.model ?? provider.defaultModel;
    const run = createRun(db, { sessionId, providerId: provider.id, model: modelId });

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
      await emit("run_started", { model: modelId });

      let assistantText = "";
      let failed = false;
      try {
        const result = await agentClient.run({
          sessionId,
          workspaceRoot: workspace.rootDir,
          piProviderId: piProviderId(provider.name),
          modelId,
          message: await buildAgentMessage(workspace.rootDir, body.message, body.contextFiles ?? []),
          agentSessionPath: session.agentSessionPath ?? null,
          permission: body.permission,
          reasoning: body.reasoning ?? null,
          abortSignal: c.req.raw.signal
        });
        if (result.sessionFile) setAgentSessionPath(db, sessionId, result.sessionFile);

        for await (const event of result.events) {
          await emit("agent_event", { event });
          const e = event as any;
          if (e?.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
            const delta = e.assistantMessageEvent.delta as string | undefined;
            if (delta) {
              assistantText += delta;
              await emit("assistant_delta", { text: delta });
            }
          }
          if (e?.type === "tool_execution_start") {
            await emit("tool_started", {
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              args: e.args ?? null
            });
          }
          if (e?.type === "tool_execution_update") {
            await emit("tool_updated", {
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              args: e.args ?? null,
              partialResult: e.partialResult ?? null
            });
          }
          if (e?.type === "tool_execution_end") {
            await emit(e.isError ? "tool_failed" : "tool_completed", {
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              result: e.result ?? null,
              isError: Boolean(e.isError)
            });
          }
          if (e?.type === "message_end") {
            const stop = e.message?.stopReason;
            if (stop === "error") {
              const msg = e.message?.errorMessage ?? "agent failed";
              await emit("run_failed", { error: msg });
              completeRun(db, run.id, "failed", msg);
              failed = true;
              return;
            }
          }
        }

        if (!failed) {
          await emit("assistant_message", { content: assistantText });
          await emit("run_completed");
          completeRun(db, run.id, "completed");
        }
      } catch (error) {
        const msg = (error as Error).message;
        await emit("run_failed", { error: msg });
        completeRun(db, run.id, "failed", msg);
      }
    });
  });

  return app;
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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function buildAgentMessage(
  workspaceRoot: string,
  message: string,
  contextFiles: readonly string[]
): Promise<string> {
  const unique = [...new Set(contextFiles.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) return message;

  const attachments: string[] = [];
  for (const filePath of unique) {
    try {
      const doc = await readDocument(workspaceRoot, filePath);
      const text = doc.rawOnly
        ? `[${doc.mime} attachment; content preview unavailable. Use file tools if you need to inspect it.]`
        : doc.text;
      attachments.push(
        `<attached_file path="${escapeAttr(filePath)}" mime="${escapeAttr(doc.mime)}">\n${text}\n</attached_file>`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      attachments.push(
        `<attached_file path="${escapeAttr(filePath)}" error="${escapeAttr(reason)}">\n</attached_file>`
      );
    }
  }

  return `${message}\n\n<attached_files>\n${attachments.join("\n")}\n</attached_files>`;
}
