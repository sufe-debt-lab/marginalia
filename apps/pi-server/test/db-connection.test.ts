import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { defaultDbPath } from "../src/db/connection.js";
import { migrate } from "../src/db/migrations.js";

function tableNames(db: Database.Database): string[] {
  return db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function sessionColumns(db: Database.Database): string[] {
  return db
    .prepare("pragma table_info(sessions)")
    .all()
    .map((row) => (row as { name: string }).name);
}

function createRecordedV1(db: Database.Database, withCompatibilityColumns: boolean) {
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
      ${withCompatibilityColumns ? ", model TEXT, agent_session_path TEXT" : ""}
    );
  `);
}

type MigrationWorker = {
  worker: Worker;
  atTransaction: Promise<void>;
  result: Promise<{ ok: true } | { ok: false; error: string }>;
  exited: Promise<void>;
};

function startMigrationWorker(dbPath: string, barrier: SharedArrayBuffer): MigrationWorker {
  const migrationUrl = new URL("../src/db/migrations.ts", import.meta.url).href;
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    const Database = require("better-sqlite3");

    void import(workerData.migrationUrl).then(({ migrate }) => {
      let paused = false;
      const barrier = new Int32Array(workerData.barrier);
      const db = new Database(workerData.dbPath, {
        verbose(sql) {
          if (!paused && /^BEGIN(?: IMMEDIATE)?$/i.test(sql.trim())) {
            paused = true;
            parentPort.postMessage({ type: "transaction" });
            Atomics.wait(barrier, 0, 0, 5_000);
          }
        }
      });
      db.pragma("busy_timeout = 5000");
      try {
        migrate(db);
        parentPort.postMessage({ type: "result", ok: true });
      } catch (error) {
        parentPort.postMessage({
          type: "result",
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        db.close();
      }
    });
  `;
  const worker = new Worker(source, {
    eval: true,
    execArgv: ["--import", "tsx"],
    workerData: { barrier, dbPath, migrationUrl }
  });

  let resolveTransaction!: () => void;
  let rejectTransaction!: (error: Error) => void;
  let resolveResult!: (result: { ok: true } | { ok: false; error: string }) => void;
  let rejectResult!: (error: Error) => void;
  const atTransaction = new Promise<void>((resolve, reject) => {
    resolveTransaction = resolve;
    rejectTransaction = reject;
  });
  const result = new Promise<{ ok: true } | { ok: false; error: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  worker.on("message", (message: { type: string; ok?: boolean; error?: string }) => {
    if (message.type === "transaction") resolveTransaction();
    if (message.type === "result") {
      resolveResult(
        message.ok ? { ok: true } : { ok: false, error: message.error ?? "unknown error" }
      );
    }
  });
  worker.once("error", (error) => {
    rejectTransaction(error);
    rejectResult(error);
  });

  return { worker, atTransaction, result, exited };
}

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

  it("finishes the fresh v1 bootstrap before recording v1 when v2 fails", () => {
    const db = new Database(":memory:");
    db.exec("create table skill_preferences (unexpected TEXT)");

    try {
      expect(() => migrate(db)).toThrow();
      expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
        { version: 1 }
      ]);
      expect(sessionColumns(db)).toEqual(expect.arrayContaining(["model", "agent_session_path"]));
    } finally {
      db.close();
    }
  });

  it("repairs a recorded v1 anomaly before attempting v2", () => {
    const db = new Database(":memory:");
    createRecordedV1(db, false);
    db.exec("create table skill_preferences (unexpected TEXT)");

    try {
      expect(() => migrate(db)).toThrow();
      expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
        { version: 1 }
      ]);
      expect(sessionColumns(db)).toEqual(expect.arrayContaining(["model", "agent_session_path"]));
    } finally {
      db.close();
    }
  });

  it("rolls back migration SQL when recording its version fails", () => {
    const db = new Database(":memory:");
    createRecordedV1(db, true);
    db.exec(`
      CREATE TRIGGER reject_v2_version
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 2
      BEGIN
        SELECT RAISE(ABORT, 'reject v2 version');
      END;
    `);

    try {
      expect(() => migrate(db)).toThrow("reject v2 version");
      expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
        { version: 1 }
      ]);
      expect(tableNames(db)).not.toContain("skill_preferences");
    } finally {
      db.close();
    }
  });

  it("rolls back a partial compatibility-column repair", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1), (2, 2);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'desktop',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        agent_session_path TEXT GENERATED ALWAYS AS (title) VIRTUAL
      );
      CREATE TABLE skill_preferences (
        skill_path TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );
    `);

    try {
      expect(() => migrate(db)).toThrow(/duplicate column name: agent_session_path/i);
      expect(sessionColumns(db)).not.toContain("model");
      expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
        { version: 1 },
        { version: 2 }
      ]);
    } finally {
      db.close();
    }
  });

  it("serializes migrations from two connections and rechecks versions under the lock", async () => {
    const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "marginalia-migration-test-"));
    const dbPath = path.join(tmpDir, "db.sqlite");
    const setupDb = new Database(dbPath);
    createRecordedV1(setupDb, true);
    setupDb.close();

    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = startMigrationWorker(dbPath, barrier);
    const second = startMigrationWorker(dbPath, barrier);

    try {
      await Promise.all([first.atTransaction, second.atTransaction]);
      Atomics.store(new Int32Array(barrier), 0, 1);
      Atomics.notify(new Int32Array(barrier), 0, 2);

      expect(await Promise.all([first.result, second.result])).toEqual([
        { ok: true },
        { ok: true }
      ]);
      await Promise.all([first.exited, second.exited]);

      const db = new Database(dbPath);
      try {
        expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
          { version: 1 },
          { version: 2 }
        ]);
        expect(tableNames(db).filter((name) => name === "skill_preferences")).toEqual([
          "skill_preferences"
        ]);
      } finally {
        db.close();
      }
    } finally {
      if (first.worker.exitCode === null) await first.worker.terminate();
      if (second.worker.exitCode === null) await second.worker.terminate();
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });
});
