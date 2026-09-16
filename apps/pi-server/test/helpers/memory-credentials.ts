import type { CredentialAdapter } from "../../src/credentials/store.js";
export class MemoryCredentialAdapter implements CredentialAdapter {
  readonly values = new Map<string, string>();
  failure: "get" | "set" | "delete" | null = null;
  get(reference: string) {
    if (this.failure === "get") throw new Error("access denied: sensitive-value");
    return this.values.get(reference) ?? null;
  }
  set(reference: string, secret: string) {
    if (this.failure === "set") throw new Error(`access denied: ${secret}`);
    this.values.set(reference, secret);
  }
  delete(reference: string) {
    if (this.failure === "delete") throw new Error("access denied: sensitive-value");
    this.values.delete(reference);
  }
}
