import { serve } from "@hono/node-server";
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai";
import { emptyUsage } from "@marginalia/chat-core";
import { createApp } from "../../src/app.js";
import { AgentSessionRegistry } from "../../src/agent/agent-session-registry.js";
import { PiCodingAgentClient } from "../../src/agent/pi-coding-agent-client.js";
import { ApprovalGateway } from "../../src/agent/approval-gateway.js";

const authStorage = AuthStorage.inMemory();
authStorage.setRuntimeApiKey("openai", "fixture-only");
const modelRegistry = ModelRegistry.inMemory(authStorage);
const registry = new AgentSessionRegistry({
  authStorage,
  modelRegistry,
  createSession: async (config) => {
    const created = await createAgentSession({
      ...config,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false }
      })
    } as Parameters<typeof createAgentSession>[0]);
    created.session.agent.streamFn = (_model, context) => {
      const last = context.messages.at(-1);
      const command =
        last?.role === "user" && Array.isArray(last.content)
          ? last.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
          : null;
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: command ? "toolUse" : "stop",
        message: {
          role: "assistant",
          api: "openai-responses",
          provider: "openai",
          model: "gpt-4o",
          usage: emptyUsage(),
          timestamp: Date.now(),
          stopReason: command ? "toolUse" : "stop",
          content: command
            ? [{ type: "toolCall", id: `bash-${Date.now()}`, name: "bash", arguments: { command } }]
            : [{ type: "text", text: "done" }]
        }
      });
      return stream;
    };
    return created;
  }
});
const app = createApp({
  authStorage,
  modelRegistry,
  agentClient: new PiCodingAgentClient(
    registry,
    () => getModel("openai", "gpt-4o"),
    new ApprovalGateway()
  ),
  capability: { token: "process-fixture", allowedOrigins: new Set() }
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
  console.log(JSON.stringify({ type: "ready", port: info.port }))
);
process.on("SIGTERM", () => {
  void app.shutdown().then(() => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
});
