import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function defaultDbPath() {
  const home = process.env.HOME ?? process.cwd();
  return path.join(home, ".marginalia", "db.sqlite");
}

export function openDatabase(filePath = process.env.MARGINALIA_DB_PATH ?? defaultDbPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}
