import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ScriptedFakeAgentClient } from "./agent/scripted-fake-agent.js";

// Dev/screenshot-only escape hatch: swaps in a deterministic scripted agent
// instead of the real pi-coding-agent client. See docs/developer/development.md.
const agentClient =
  process.env.MARGINALIA_FAKE_AGENT === "1" ? new ScriptedFakeAgentClient() : undefined;

const allowedOrigin = process.env.MARGINALIA_ALLOWED_ORIGIN;
const app = createApp({
  agentClient,
  capability: {
    token: process.env.MARGINALIA_CAPABILITY_TOKEN ?? null,
    allowedOrigins: new Set(allowedOrigin ? [allowedOrigin] : [])
  }
});

const server = serve(
  {
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0
  },
  (info) => {
    process.stdout.write(JSON.stringify({ type: "ready", port: info.port }) + "\n");
  }
);

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
