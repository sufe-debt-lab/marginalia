import { describe, expect, it } from "vitest";
import { CredentialStore } from "../src/credentials/store.js";

import { MemoryCredentialAdapter } from "./helpers/memory-credentials.js";

describe("Credential Store contract", () => {
  it("redacts diagnostics for read, replaced and removed secrets without hiding unrelated failures", () => {
    const store = new CredentialStore(new MemoryCredentialAdapter());
    const ref = store.create("provider", "secret/one+");
    store.replace(ref, "secret-two");
    store.delete(ref);
    expect(store.redact("HTTP 429: retry later")).toBe("HTTP 429: retry later");
    expect(store.redact("rejected secret/one+")).not.toContain("secret/one+");
    expect(store.redact("rejected secret%2Fone%2B")).not.toContain("secret%2Fone%2B");
    expect(store.redact("rejected secret-two")).not.toContain("secret-two");
  });
  it("saves, reads, replaces and deletes opaque references for either owner", () => {
    const store = new CredentialStore(new MemoryCredentialAdapter());
    for (const owner of ["provider", "knowledge-platform"]) {
      const reference = store.create(owner, "first");
      expect(reference).not.toContain("first");
      expect(store.read(reference)).toBe("first");
      store.replace(reference, "replacement");
      expect(store.read(reference)).toBe("replacement");
      store.delete(reference);
      expect(store.read(reference)).toBeNull();
      expect(() => store.delete(reference)).not.toThrow();
    }
  });

  it.each(["get", "set", "delete"] as const)(
    "redacts %s failures without leaking a cause",
    (operation) => {
      const adapter = new MemoryCredentialAdapter();
      const store = new CredentialStore(adapter);
      const ref = store.create("provider", "sensitive-value");
      adapter.failure = operation;
      const action = () =>
        operation === "get"
          ? store.read(ref)
          : operation === "set"
            ? store.replace(ref, "sensitive-value")
            : store.delete(ref);
      expect(action).toThrow("credential_store_unavailable");
      try {
        action();
      } catch (error) {
        expect(String(error)).not.toContain("sensitive-value");
        expect((error as Error).cause).toBeUndefined();
      }
      adapter.failure = null;
      expect(store.read(ref)).toBe("sensitive-value");
    }
  );
});
