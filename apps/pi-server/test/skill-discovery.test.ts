import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSkillFiles, unicodeCodePointCompare } from "../src/skills/discovery.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "marginalia-skill-discovery-"));
  tempRoots.push(root);
  return root;
}

function writeSkill(filePath: string, name: string, description = `${name} description`): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptionLine = description ? `description: ${description}\n` : "";
  writeFileSync(filePath, `---\nname: ${name}\n${descriptionLine}---\n\n# ${name}\n`);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("discoverSkillFiles", () => {
  it("discovers the six source levels in priority order with Pi and Agents directory semantics", async () => {
    const root = tempRoot();
    const homeDir = path.join(root, "home");
    const repoRoot = path.join(root, "repo");
    const workspaceRoot = path.join(repoRoot, "workspace");
    const linkedPiSkills = path.join(root, "linked-pi-skills");
    mkdirSync(path.join(repoRoot, ".git"), { recursive: true });

    const workspaceMarginalia = path.join(workspaceRoot, ".marginalia/skills");
    const workspacePi = path.join(workspaceRoot, ".pi/skills");
    const workspaceAgents = path.join(workspaceRoot, ".agents/skills");
    const repoAgents = path.join(repoRoot, ".agents/skills");
    const userMarginalia = path.join(homeDir, ".marginalia/skills");
    const userPi = path.join(homeDir, ".pi/agent/skills");
    const userAgents = path.join(homeDir, ".agents/skills");

    const invalidRootMarkdown = path.join(workspaceMarginalia, "invalid.md");
    writeSkill(invalidRootMarkdown, "invalid", "");
    writeSkill(path.join(linkedPiSkills, "root.md"), "shared-name");
    mkdirSync(path.dirname(workspacePi), { recursive: true });
    symlinkSync(linkedPiSkills, workspacePi, "dir");
    writeSkill(path.join(workspaceAgents, "near/SKILL.md"), "ancestor-near");
    writeSkill(path.join(workspaceAgents, "ignored.md"), "ignored-near-root");
    writeSkill(path.join(repoAgents, "far/SKILL.md"), "ancestor-far");
    writeSkill(path.join(repoAgents, "ignored.md"), "ignored-far-root");
    writeSkill(path.join(userMarginalia, "root.md"), "user-marginalia");
    writeSkill(path.join(userPi, "nested/SKILL.md"), "shared-name");
    writeSkill(path.join(userAgents, "nested/SKILL.md"), "user-agents");
    writeSkill(path.join(userAgents, "ignored.md"), "ignored-user-root");

    const result = await discoverSkillFiles({ workspaceRoot, homeDir });

    expect(result.map((item) => item.source)).toEqual([
      "workspace_marginalia",
      "workspace_pi",
      "ancestor_agents",
      "ancestor_agents",
      "user_marginalia",
      "user_pi",
      "user_agents"
    ]);
    expect(result).toEqual([
      {
        discoveredPath: invalidRootMarkdown,
        sourceRoot: workspaceMarginalia,
        relativePath: "invalid.md",
        source: "workspace_marginalia",
        scope: "workspace",
        mode: "pi",
        sourcePriority: 1,
        ancestorDepth: 0
      },
      {
        discoveredPath: path.join(workspacePi, "root.md"),
        sourceRoot: workspacePi,
        relativePath: "root.md",
        source: "workspace_pi",
        scope: "workspace",
        mode: "pi",
        sourcePriority: 2,
        ancestorDepth: 0
      },
      {
        discoveredPath: path.join(workspaceAgents, "near/SKILL.md"),
        sourceRoot: workspaceAgents,
        relativePath: "near/SKILL.md",
        source: "ancestor_agents",
        scope: "workspace",
        mode: "agents",
        sourcePriority: 3,
        ancestorDepth: 0
      },
      {
        discoveredPath: path.join(repoAgents, "far/SKILL.md"),
        sourceRoot: repoAgents,
        relativePath: "far/SKILL.md",
        source: "ancestor_agents",
        scope: "workspace",
        mode: "agents",
        sourcePriority: 3,
        ancestorDepth: 1
      },
      {
        discoveredPath: path.join(userMarginalia, "root.md"),
        sourceRoot: userMarginalia,
        relativePath: "root.md",
        source: "user_marginalia",
        scope: "user",
        mode: "pi",
        sourcePriority: 4,
        ancestorDepth: 0
      },
      {
        discoveredPath: path.join(userPi, "nested/SKILL.md"),
        sourceRoot: userPi,
        relativePath: "nested/SKILL.md",
        source: "user_pi",
        scope: "user",
        mode: "pi",
        sourcePriority: 5,
        ancestorDepth: 0
      },
      {
        discoveredPath: path.join(userAgents, "nested/SKILL.md"),
        sourceRoot: userAgents,
        relativePath: "nested/SKILL.md",
        source: "user_agents",
        scope: "user",
        mode: "agents",
        sourcePriority: 6,
        ancestorDepth: 0
      }
    ]);
  });

  it.each(["directory", "file"] as const)(
    "stops ancestor discovery at a Git root marked by a .git %s and includes that root",
    async (gitMarker) => {
      const root = tempRoot();
      const homeDir = path.join(root, "home");
      const outerRoot = path.join(root, "outer");
      const repoRoot = path.join(outerRoot, "repo");
      const workspaceRoot = path.join(repoRoot, "workspace");
      mkdirSync(workspaceRoot, { recursive: true });
      if (gitMarker === "directory") {
        mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
      } else {
        writeFileSync(path.join(repoRoot, ".git"), "gitdir: ../worktrees/repo\n");
      }
      writeSkill(path.join(workspaceRoot, ".agents/skills/near/SKILL.md"), "near");
      writeSkill(path.join(repoRoot, ".agents/skills/repo/SKILL.md"), "repo");
      writeSkill(path.join(outerRoot, ".agents/skills/outside/SKILL.md"), "outside");

      const result = await discoverSkillFiles({ workspaceRoot, homeDir });

      expect(
        result.map(({ sourceRoot, ancestorDepth }) => ({ sourceRoot, ancestorDepth }))
      ).toEqual([
        { sourceRoot: path.join(workspaceRoot, ".agents/skills"), ancestorDepth: 0 },
        { sourceRoot: path.join(repoRoot, ".agents/skills"), ancestorDepth: 1 }
      ]);
    }
  );

  it("walks ancestors nearest-first toward the filesystem root when there is no Git marker", async () => {
    const root = tempRoot();
    const homeDir = path.join(root, "home");
    const workspaceRoot = path.join(root, "outer/middle/workspace");
    writeSkill(path.join(workspaceRoot, ".agents/skills/near/SKILL.md"), "near");
    writeSkill(path.join(root, "outer/middle/.agents/skills/middle/SKILL.md"), "middle");
    writeSkill(path.join(root, "outer/.agents/skills/outer/SKILL.md"), "outer");

    const result = await discoverSkillFiles({ workspaceRoot, homeDir });
    const fixtureResults = result.filter((item) =>
      item.sourceRoot.startsWith(`${path.join(root, "outer")}${path.sep}`)
    );

    expect(
      fixtureResults.map(({ relativePath, ancestorDepth }) => ({ relativePath, ancestorDepth }))
    ).toEqual([
      { relativePath: "near/SKILL.md", ancestorDepth: 0 },
      { relativePath: "middle/SKILL.md", ancestorDepth: 1 },
      { relativePath: "outer/SKILL.md", ancestorDepth: 2 }
    ]);
  });

  it.each(["canonical-symlink", "lexical-ancestor"] as const)(
    "excludes the global Agents root from ancestor discovery for a %s duplicate",
    async (duplicateKind) => {
      const root = tempRoot();
      const homeDir = path.join(root, "home");
      const globalAgents = path.join(homeDir, ".agents/skills");
      writeSkill(path.join(globalAgents, "global/SKILL.md"), "global");

      let workspaceRoot: string;
      const relevantRoots = [globalAgents];
      if (duplicateKind === "canonical-symlink") {
        const repoRoot = path.join(root, "repo");
        workspaceRoot = path.join(repoRoot, "workspace");
        mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
        mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });
        const linkedAgents = path.join(workspaceRoot, ".agents/skills");
        symlinkSync(globalAgents, linkedAgents, "dir");
        relevantRoots.push(linkedAgents);
      } else {
        workspaceRoot = path.join(homeDir, "projects/workspace");
        mkdirSync(workspaceRoot, { recursive: true });
      }

      const result = await discoverSkillFiles({ workspaceRoot, homeDir });
      const relevantResults = result.filter((item) => relevantRoots.includes(item.sourceRoot));

      expect(relevantResults).toEqual([
        {
          discoveredPath: path.join(globalAgents, "global/SKILL.md"),
          sourceRoot: globalAgents,
          relativePath: "global/SKILL.md",
          source: "user_agents",
          scope: "user",
          mode: "agents",
          sourcePriority: 6,
          ancestorDepth: 0
        }
      ]);
    }
  );

  it("sorts POSIX relative paths by Unicode code point independently of creation order", async () => {
    const root = tempRoot();
    const homeDir = path.join(root, "home");
    const workspaceRoot = path.join(root, "workspace");
    const skillRoot = path.join(workspaceRoot, ".marginalia/skills");
    for (const [fileName, name] of [
      ["😀.md", "emoji"],
      ["𐐀.md", "deseret"],
      ["a.md", "lowercase"],
      ["Z.md", "uppercase"]
    ]) {
      writeSkill(path.join(skillRoot, fileName), name);
    }

    const expected = ["Z.md", "a.md", "𐐀.md", "😀.md"];
    for (let run = 0; run < 3; run += 1) {
      const result = await discoverSkillFiles({ workspaceRoot, homeDir });
      expect(result.map((item) => item.relativePath)).toEqual(expected);
    }
  });

  it("treats missing roots and a null workspace as nonfatal", async () => {
    const root = tempRoot();

    await expect(
      discoverSkillFiles({ workspaceRoot: null, homeDir: path.join(root, "missing-home") })
    ).resolves.toEqual([]);
  });
});

describe("unicodeCodePointCompare", () => {
  it.each([
    ["a", "a", 0],
    ["a", "aa", -1],
    ["Z", "a", -1],
    ["𐐀", "😀", -1],
    ["😀", "𐐀", 1]
  ] as const)("compares %j and %j by Unicode code point", (left, right, direction) => {
    expect(Math.sign(unicodeCodePointCompare(left, right))).toBe(direction);
  });
});
