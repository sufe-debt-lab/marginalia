import path from "node:path";
import { consumeLoopbackAccessEnvironment } from "./security/loopback-access.js";

const loopbackAccess = consumeLoopbackAccessEnvironment(process.env);
const [{ serve }, { createApp }, { ScriptedFakeAgentClient }] = await Promise.all([
  import("@hono/node-server"),
  import("./app.js"),
  import("./agent/scripted-fake-agent.js")
]);

// Dev/screenshot-only escape hatch: swaps in a deterministic scripted agent
// instead of the real pi-coding-agent client. See docs/developer/development.md.
const agentClient =
  process.env.MARGINALIA_FAKE_AGENT === "workspace" && process.env.MARGINALIA_DB_PATH
    ? new ScriptedFakeAgentClient({
        workspaceTools: true,
        sessionDir: path.join(path.dirname(process.env.MARGINALIA_DB_PATH), "pi-sessions")
      })
    : process.env.MARGINALIA_FAKE_AGENT === "1"
      ? new ScriptedFakeAgentClient()
      : undefined;

const app = createApp({
  agentClient,
  loopbackAccess
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
