import { randomUUID } from "node:crypto";

/** Synchronous, atomic operations supplied by the OS (or an in-memory test adapter). */
export interface CredentialAdapter {
  get(reference: string): string | null;
  set(reference: string, secret: string): void;
  delete(reference: string): void;
}

export class CredentialStoreError extends Error {
  constructor() {
    super("credential_store_unavailable");
    this.name = "CredentialStoreError";
  }
}

/** Shared by Providers and future Knowledge Platform credentials. Never serializes secrets. */
export class CredentialStore {
  // Retain observed values only in process memory so late errors after rotation are safe.
  private readonly redactions = new Set<string>();

  private remember(secret: string | null) {
    if (!secret) return;
    this.redactions.add(secret);
    this.redactions.add(encodeURIComponent(secret));
    this.redactions.add(Buffer.from(secret).toString("base64"));
  }

  redact(message: string): string {
    let safe = message;
    for (const secret of this.redactions) safe = safe.split(secret).join("[redacted]");
    return safe;
  }

  constructor(private readonly adapter: CredentialAdapter) {}

  create(owner: string, secret: string): string {
    const reference = `${owner}:${randomUUID()}`;
    this.replace(reference, secret);
    return reference;
  }

  read(reference: string): string | null {
    try {
      const secret = this.adapter.get(reference);
      this.remember(secret);
      return secret;
    } catch {
      throw new CredentialStoreError();
    }
  }

  replace(reference: string, secret: string): void {
    try {
      this.remember(secret);
      this.adapter.set(reference, secret);
    } catch {
      throw new CredentialStoreError();
    }
  }

  delete(reference: string): void {
    try {
      this.adapter.delete(reference);
    } catch {
      throw new CredentialStoreError();
    }
  }
}
