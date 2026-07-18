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

export type SkillDiscoveryOptions = {
  workspaceRoot?: string | null;
  homeDir: string;
};
