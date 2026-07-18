import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import type {
  DiscoveredSkillFile,
  SkillDiscoveryMode,
  SkillDiscoveryOptions,
  SkillScope,
  SkillSource
} from "./types.js";

type SkillSourceRoot = {
  path: string;
  source: SkillSource;
  scope: SkillScope;
  mode: SkillDiscoveryMode;
  sourcePriority: number;
  ancestorDepth: number;
};

function root(
  rootPath: string,
  source: SkillSource,
  scope: SkillScope,
  mode: SkillDiscoveryMode,
  sourcePriority: number,
  ancestorDepth = 0
): SkillSourceRoot {
  return { path: rootPath, source, scope, mode, sourcePriority, ancestorDepth };
}

function canonicalRoot(rootPath: string): string {
  try {
    return realpathSync(rootPath);
  } catch {
    return path.resolve(rootPath);
  }
}

function ancestorAgentRoots(workspaceRoot: string, homeDir: string): SkillSourceRoot[] {
  const roots: SkillSourceRoot[] = [];
  const globalAgentsRoot = path.join(homeDir, ".agents/skills");
  const canonicalGlobalAgentsRoot = canonicalRoot(globalAgentsRoot);
  let directory = path.resolve(workspaceRoot);
  let ancestorDepth = 0;

  while (true) {
    const agentsRoot = path.join(directory, ".agents/skills");
    if (canonicalRoot(agentsRoot) !== canonicalGlobalAgentsRoot) {
      roots.push(root(agentsRoot, "ancestor_agents", "workspace", "agents", 3, ancestorDepth));
    }

    if (existsSync(path.join(directory, ".git"))) {
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
    ancestorDepth += 1;
  }

  return roots;
}

function sourceRoots(workspaceRoot: string | null, homeDir: string): SkillSourceRoot[] {
  const resolvedHomeDir = path.resolve(homeDir);
  const workspace = workspaceRoot
    ? [
        root(
          path.join(path.resolve(workspaceRoot), ".marginalia/skills"),
          "workspace_marginalia",
          "workspace",
          "pi",
          1
        ),
        root(
          path.join(path.resolve(workspaceRoot), ".pi/skills"),
          "workspace_pi",
          "workspace",
          "pi",
          2
        ),
        ...ancestorAgentRoots(workspaceRoot, resolvedHomeDir)
      ]
    : [];

  return [
    ...workspace,
    root(path.join(resolvedHomeDir, ".marginalia/skills"), "user_marginalia", "user", "pi", 4),
    root(path.join(resolvedHomeDir, ".pi/agent/skills"), "user_pi", "user", "pi", 5),
    root(path.join(resolvedHomeDir, ".agents/skills"), "user_agents", "user", "agents", 6)
  ];
}

function toPosixRelativePath(sourceRoot: string, discoveredPath: string): string {
  return path.relative(sourceRoot, discoveredPath).split(path.sep).join("/");
}

export function unicodeCodePointCompare(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const delta = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

function compareDiscoveredSkillFiles(
  left: DiscoveredSkillFile,
  right: DiscoveredSkillFile
): number {
  return (
    left.sourcePriority - right.sourcePriority ||
    left.ancestorDepth - right.ancestorDepth ||
    unicodeCodePointCompare(left.relativePath, right.relativePath)
  );
}

export async function discoverSkillFiles(
  options: SkillDiscoveryOptions
): Promise<DiscoveredSkillFile[]> {
  const discovered: DiscoveredSkillFile[] = [];

  for (const sourceRoot of sourceRoots(options.workspaceRoot ?? null, options.homeDir)) {
    const result = loadSkillsFromDir({ dir: sourceRoot.path, source: sourceRoot.source });
    const discoveredPaths = new Set<string>();
    for (const skill of result.skills) {
      discoveredPaths.add(skill.filePath);
    }
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.path) {
        discoveredPaths.add(diagnostic.path);
      }
    }

    for (const discoveredPath of discoveredPaths) {
      if (sourceRoot.mode === "agents" && path.basename(discoveredPath) !== "SKILL.md") {
        continue;
      }
      discovered.push({
        discoveredPath,
        sourceRoot: sourceRoot.path,
        relativePath: toPosixRelativePath(sourceRoot.path, discoveredPath),
        source: sourceRoot.source,
        scope: sourceRoot.scope,
        mode: sourceRoot.mode,
        sourcePriority: sourceRoot.sourcePriority,
        ancestorDepth: sourceRoot.ancestorDepth
      });
    }
  }

  return discovered.sort(compareDiscoveredSkillFiles);
}
