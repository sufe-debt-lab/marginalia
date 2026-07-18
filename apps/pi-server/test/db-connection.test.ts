import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { homedir } from "node:os";
import path from "node:path";
import { defaultDbPath } from "../src/db/connection.js";
import { migrate } from "../src/db/migrations.js";

describe("defaultDbPath", () => {
  const originalHome = process.env.HOME;
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("resolves under the OS home dir", () => {
    expect(defaultDbPath()).toBe(path.join(homedir(), ".marginalia", "db.sqlite"));
  });

  it("ignores an unset HOME (Windows) and never falls back to cwd", () => {
    // On Windows HOME is undefined; the old cwd fallback put the DB inside the
    // packaged app's Resources/pi-server. The path must stay in the user's home.
    delete process.env.HOME;
    const result = defaultDbPath();
    expect(result).toBe(path.join(homedir(), ".marginalia", "db.sqlite"));
    expect(result.startsWith(process.cwd())).toBe(false);
  });
});

describe("database migrations", () => {
  it("migrates a recorded v1 database to v2 without losing existing data", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'desktop',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        model TEXT,
        agent_session_path TEXT
      );
      INSERT INTO sessions (
        id, workspace_id, title, origin, created_at, updated_at, model, agent_session_path
      ) VALUES ('session-1', 'workspace-1', 'Existing', 'desktop', 1, 1, 'model-1', '/tmp/a.jsonl');
    `);

    try {
      migrate(db);

      expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
        { version: 1 },
        { version: 2 }
      ]);
      expect(
        db
          .prepare("select name from sqlite_master where type = 'table' order by name")
          .all()
          .map((row) => (row as { name: string }).name)
      ).toContain("skill_preferences");
      expect(db.prepare("select title, model, agent_session_path from sessions").get()).toEqual({
        title: "Existing",
        model: "model-1",
        agent_session_path: "/tmp/a.jsonl"
      });
      expect(() =>
        db.prepare("insert into skill_preferences values (?, ?, ?)").run("/x", 2, 1)
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("repairs legacy v1 session columns even when v1 is already recorded", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'desktop',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    try {
      migrate(db);
      const columns = db
        .prepare("pragma table_info(sessions)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(columns).toContain("model");
      expect(columns).toContain("agent_session_path");
    } finally {
      db.close();
    }
  });
});
