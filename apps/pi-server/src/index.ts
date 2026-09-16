import { watchProcessOwner } from "./run/process-owner.js";
import { consumeCapabilityEnvironment } from "./security/capability.js";

const capability = consumeCapabilityEnvironment(process.env);
const parentPid = Number(process.env.MARGINALIA_PARENT_PID);
delete process.env.MARGINALIA_PARENT_PID;
const [{ serve }, { createApp }, { ScriptedFakeAgentClient }] = await Promise.all([
  import("@hono/node-server"),
  import("./app.js"),
  import("./agent/scripted-fake-agent.js")
]);

// Dev/screenshot-only escape hatch: swaps in a deterministic scripted agent
// instead of the real pi-coding-agent client. See docs/developer/development.md.
const agentClient =
  process.env.MARGINALIA_FAKE_AGENT === "1" ? new ScriptedFakeAgentClient() : undefined;

const app = createApp({
  agentClient,
  capability
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

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Bound shutdown even if a model/tool fails to settle after abort. Run state
  // is persisted synchronously by shutdown() before waiting for execution.
  const timeout = setTimeout(() => process.exit(0), 2000);
  timeout.unref();
  void app.shutdown().finally(() => {
    if ("closeAllConnections" in server) server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Both system-Node children and packaged utility processes must die with the app.
if (Number.isSafeInteger(parentPid) && parentPid > 0) {
  watchProcessOwner(parentPid, shutdown);
}
