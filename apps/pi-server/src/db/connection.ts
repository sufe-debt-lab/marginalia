import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function defaultDbPath() {
  // homedir() is cross-platform (HOME on macOS/Linux, USERPROFILE on Windows) so the
  // DB lives next to auth.json under ~/.marginalia — never inside the packaged app's
  // Resources dir, which is read-only on locked installs and wiped on update/uninstall.
  return path.join(homedir(), ".marginalia", "db.sqlite");
}

export function openDatabase(filePath = process.env.MARGINALIA_DB_PATH ?? defaultDbPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}
