import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { createApp, type AppOptions } from "../src/app.js";

// Existing functional suites use an explicitly authenticated desktop request.
// Boundary suites import createApp directly to exercise denied requests.
export function createTestApp(options: AppOptions = {}) {
  const access = { bearer: "test-token", allowedOrigins: new Set(["null"]) };
  const app = createApp({
    authStorage: AuthStorage.inMemory(),
    ...options,
    loopbackAccess: options.loopbackAccess ?? access
  });
  if (options.loopbackAccess) return app;
  const request = app.request.bind(app);
  app.request = (input, init, env) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    headers.set("authorization", `Bearer ${access.bearer}`);
    headers.set("origin", "null");
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    return request(input, { ...init, headers }, env);
  };
  return app;
}
