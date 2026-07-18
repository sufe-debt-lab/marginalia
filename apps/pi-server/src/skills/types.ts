import type { Skill } from "@earendil-works/pi-coding-agent";

export const SKILL_EXPLICIT_BYTES = 512 * 1024;
export const SKILL_PREVIEW_BYTES = 256 * 1024;

export type SkillSource =
  | "workspace_marginalia"
  | "workspace_pi"
  | "ancestor_agents"
  | "user_marginalia"
  | "user_pi"
  | "user_agents";

export type SkillScope = "workspace" | "user";
export type SkillDiscoveryMode = "pi" | "agents";

export type SkillDiagnostic = {
  code: string;
  level: "warning" | "error";
  message: string;
  path?: string;
};

export type DiscoveredSkillFile = {
  discoveredPath: string;
  sourceRoot: string;
  relativePath: string;
  source: SkillSource;
  scope: SkillScope;
  mode: SkillDiscoveryMode;
  sourcePriority: number;
  ancestorDepth: number;
};

export type ParsedSkillCandidate = DiscoveredSkillFile & {
  canonicalPath: string;
  canonicalBaseDir: string;
  skill: Skill | null;
  diagnostics: SkillDiagnostic[];
  bytesTotal: number;
  contentHash: string;
  explicitEligible: boolean;
  explicitOnly: boolean;
  rawContent: string | null;
  previewContent: string;
  previewTruncated: boolean;
};

export type SkillDiscoveryOptions = {
  workspaceRoot?: string | null;
  homeDir: string;
};
