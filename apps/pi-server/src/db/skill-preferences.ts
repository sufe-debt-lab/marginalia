import type Database from "better-sqlite3";

export type SkillPreference = {
  skillPath: string;
  enabled: boolean;
  updatedAt: number;
};

export interface SkillPreferenceStore {
  enabledFor(skillPath: string): boolean;
  setEnabled(skillPath: string, enabled: boolean): SkillPreference;
  list(): SkillPreference[];
}

type SkillPreferenceRow = {
  skill_path: string;
  enabled: number;
  updated_at: number;
};

function toSkillPreference(row: SkillPreferenceRow): SkillPreference {
  return {
    skillPath: row.skill_path,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at
  };
}

export function createSkillPreferenceStore(db: Database.Database): SkillPreferenceStore {
  const findStatement = db.prepare("select enabled from skill_preferences where skill_path = ?");
  const upsertStatement = db.prepare(`
    INSERT INTO skill_preferences (skill_path, enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(skill_path) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const listStatement = db.prepare(`
    SELECT skill_path, enabled, updated_at
    FROM skill_preferences
    ORDER BY skill_path
  `);

  return {
    enabledFor(skillPath) {
      const row = findStatement.get(skillPath) as { enabled: number } | undefined;
      return row?.enabled !== 0;
    },

    setEnabled(skillPath, enabled) {
      const updatedAt = Date.now();
      upsertStatement.run(skillPath, enabled ? 1 : 0, updatedAt);
      return { skillPath, enabled, updatedAt };
    },

    list() {
      return (listStatement.all() as SkillPreferenceRow[]).map(toSkillPreference);
    }
  };
}
