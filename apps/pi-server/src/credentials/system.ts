import { createRequire } from "node:module";
import type { Entry as NativeEntry } from "@napi-rs/keyring";
import { CredentialStore } from "./store.js";

const require = createRequire(import.meta.url);

/** Lazy loading keeps missing native binaries inside the redacted failure boundary. */
export function systemCredentialStore(service = "works.marginalia.credentials") {
  const entry = (reference: string): NativeEntry => {
    const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    // Kernel keyutils may disappear at logout. Require persistent Secret Service on Linux.
    return new Entry(service, reference, { linux: { store: "secret-service" } });
  };
  return new CredentialStore({
    get: (reference) => entry(reference).getPassword(),
    set: (reference, secret) => entry(reference).setPassword(secret),
    delete: (reference) => {
      entry(reference).deleteCredential();
    }
  });
}

export const credentials = systemCredentialStore();
