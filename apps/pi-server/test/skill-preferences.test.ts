import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/db/migrations.js";
import { createSkillPreferenceStore } from "../src/db/skill-preferences.js";

describe("SkillPreferenceStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("enables skills by default when no preference exists", () => {
    const store = createSkillPreferenceStore(db);

    expect(store.enabledFor("/skills/default/SKILL.md")).toBe(true);
  });

  it("upserts a preference and returns its persisted value", () => {
    const store = createSkillPreferenceStore(db);
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    expect(store.setEnabled("/skills/review/SKILL.md", false)).toEqual({
      skillPath: "/skills/review/SKILL.md",
      enabled: false,
      updatedAt: 1_000
    });

    vi.setSystemTime(2_000);
    expect(store.setEnabled("/skills/review/SKILL.md", true)).toEqual({
      skillPath: "/skills/review/SKILL.md",
      enabled: true,
      updatedAt: 2_000
    });
    expect(store.list()).toEqual([
      { skillPath: "/skills/review/SKILL.md", enabled: true, updatedAt: 2_000 }
    ]);
  });

  it("uses the exact canonical string as the preference key", () => {
    const store = createSkillPreferenceStore(db);
    const skillPath = "/Users/example/.codex/skills/Review/SKILL.md";

    store.setEnabled(skillPath, false);

    expect(store.enabledFor(skillPath)).toBe(false);
    expect(
      db.prepare("select skill_path from skill_preferences where skill_path = ?").get(skillPath)
    ).toEqual({ skill_path: skillPath });
  });

  it("keeps disabled tombstones for paths that are no longer discovered", () => {
    const store = createSkillPreferenceStore(db);
    const missingPath = "/definitely/missing/skill/SKILL.md";

    store.setEnabled(missingPath, false);

    expect(store.list()).toEqual([
      expect.objectContaining({ skillPath: missingPath, enabled: false })
    ]);
  });
});
