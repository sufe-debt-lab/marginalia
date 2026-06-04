import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import path from "node:path";
import { defaultDbPath } from "../src/db/connection.js";

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
