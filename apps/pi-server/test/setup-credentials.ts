import { vi } from "vitest";

// All ordinary server tests replace the OS boundary, including legacy repository fixtures.
// No import of the native keyring and no access to the developer's credentials.
vi.mock("../src/credentials/system.js", async () => {
  const { CredentialStore } = await import("../src/credentials/store.js");
  const { MemoryCredentialAdapter } = await import("./helpers/memory-credentials.js");
  const systemCredentialStore = () => new CredentialStore(new MemoryCredentialAdapter());
  return { credentials: systemCredentialStore(), systemCredentialStore };
});
