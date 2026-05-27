import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const app = createApp();

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
