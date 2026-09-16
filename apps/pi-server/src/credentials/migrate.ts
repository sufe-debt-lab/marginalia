import type Database from "better-sqlite3";
import { CredentialStoreError, type CredentialStore } from "./store.js";

/** Version 4 is committed only after credential migration AND SQLite scrubbing succeed. */
export function migrateProviderCredentials(db: Database.Database, store: CredentialStore) {
  // env_vars is the legacy Provider credential table. Failed non-transactional
  // creates also left keys here without a providers row; preserve and migrate them.
  const rows = db
    .prepare(
      `
    select id, value from env_vars where credential_store = 0
  `
    )
    .all() as Array<{ id: string; value: string }>;
  if (!rows.length && db.prepare("select 1 from schema_migrations where version = 4").get()) return;

  try {
    // Keep every legacy value until every write has been read back successfully.
    // The stable reference makes retries after a crash idempotent.
    for (const row of rows) {
      store.replace(row.id, row.value);
      if (store.read(row.id) !== row.value) throw new CredentialStoreError();
    }
    // Scrub old free pages/WAL BEFORE the transaction that deletes the source.
    // Switching to rollback-journal mode means the final secure_delete commit cannot
    // leave old values in a WAL. Any busy reader or VACUUM failure leaves source rows.
    const result = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
    if (result.some((row) => row.busy !== 0)) throw new CredentialStoreError();
    const mode = db.pragma("journal_mode = DELETE", { simple: true });
    if (mode !== "delete" && mode !== "memory") throw new CredentialStoreError();
    db.exec("VACUUM");
    db.pragma("secure_delete = ON");
    db.transaction(() => {
      for (const row of rows) {
        db.prepare("update env_vars set value = '', credential_store = 1 where id = ?").run(row.id);
      }
      // The source deletion and success marker either both commit or both roll back.
      db.prepare("insert or ignore into schema_migrations (version, applied_at) values (4, ?)").run(
        Date.now()
      );
    }).immediate();
  } catch {
    // No native/SQLite diagnostics, inputs, causes or secrets reach startup logs.
    throw new CredentialStoreError();
  }
}
