import type Database from "better-sqlite3";

const V1_SQL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_dir TEXT NOT NULL,
    last_opened_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'desktop',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS env_vars (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    workspace_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_ref TEXT NOT NULL,
    base_url TEXT,
    default_model TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (api_key_ref) REFERENCES env_vars(id)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`;

const migrations: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: V1_SQL },
  {
    version: 2,
    sql: `
      CREATE TABLE skill_preferences (
        skill_path TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );
    `
  },
  {
    version: 3,
    sql: "ALTER TABLE runs ADD COLUMN owner_pid INTEGER; ALTER TABLE runs ADD COLUMN owner_started_at TEXT;"
  }
];

function repairV1SessionColumns(db: Database.Database) {
  const sessionColumns = db
    .prepare("pragma table_info(sessions)")
    .all()
    .map((row) => (row as { name: string }).name);
  if (!sessionColumns.includes("model")) {
    db.exec("ALTER TABLE sessions ADD COLUMN model TEXT");
  }
  if (!sessionColumns.includes("agent_session_path")) {
    db.exec("ALTER TABLE sessions ADD COLUMN agent_session_path TEXT");
  }
}

export function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  for (const migration of migrations) {
    db.transaction(() => {
      const applied = db
        .prepare("select 1 from schema_migrations where version = ?")
        .get(migration.version);

      if (migration.version === 1) {
        db.exec(migration.sql);
        repairV1SessionColumns(db);
        if (applied) return;
      } else {
        if (applied) return;
        db.exec(migration.sql);
      }

      db.prepare("insert into schema_migrations (version, applied_at) values (?, ?)").run(
        migration.version,
        Date.now()
      );
    }).immediate();
  }
}
