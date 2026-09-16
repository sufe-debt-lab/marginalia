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
  process.env.MARGINALIA_FAKE_AGENT === "1" ? new ScriptedFakeAgentClient() : undefined;

// The existing isolated Electron screenshot harness must never touch the OS store.
// Pair both stores in memory: this flag must never migrate or open a user database.
let credentialStore;
let db;
if (process.env.MARGINALIA_SCREENSHOT_VERIFY === "1") {
  const { CredentialStore } = await import("./credentials/store.js");
  const { openDatabase } = await import("./db/connection.js");
  db = openDatabase(":memory:");
  const values = new Map<string, string>();
  credentialStore = new CredentialStore({
    get: (reference) => values.get(reference) ?? null,
    set: (reference, secret) => {
      values.set(reference, secret);
    },
    delete: (reference) => {
      values.delete(reference);
    }
  });
}

const app = createApp({
  agentClient,
  loopbackAccess,
  credentialStore,
  db
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
