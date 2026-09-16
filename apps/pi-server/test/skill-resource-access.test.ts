import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  renameSync,
  realpathSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createSkillCatalogService } from "../src/skills/catalog.js";
import { prepareSkillTurn } from "../src/skills/turn-preflight.js";
import { createWorkspaceTools } from "../src/agent/workspace-tools.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
async function setup() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "skill-access-")));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  mkdirSync(workspace);
  mkdirSync(home);
  const skill = (name: string, body: string, explicitOnly = false) => {
    const dir = path.join(home, ".marginalia/skills", name);
    mkdirSync(path.join(dir, "references"), { recursive: true });
    const file = path.join(dir, "SKILL.md");
    writeFileSync(
      file,
      `---\nname: ${name}\ndescription: fixture\ndisable-model-invocation: ${explicitOnly}\n---\n${body}`
    );
    writeFileSync(path.join(dir, "references/guide.md"), `${name} reference`);
    return file;
  };
  const disabled = new Set<string>();
  const catalog = createSkillCatalogService({
    homeDir: home,
    preferences: {
      enabledFor: (file) => !disabled.has(file),
      list: () => [...disabled].map((skillPath) => ({ skillPath, enabled: false, updatedAt: 1 })),
      setEnabled: () => {
        throw new Error("unused");
      }
    }
  });
  const gateway = new ApprovalGateway();
  gateway.setPolicy("s", { permission: "ask", workspaceRoot: workspace });
  const prepare = async (selections: Array<{ name: string; path: string }> = []) => {
    const snapshot = await catalog.refresh({ workspaceId: "w", workspaceRoot: workspace });
    const turn = prepareSkillTurn(snapshot, selections);
    const tools = await createWorkspaceTools(workspace, gateway, "s", turn.runtime.contents);
    const read = (file: string) => {
      const tool = tools.find((t) => t.name === "read_skill");
      if (!tool) throw new Error("read_skill missing");
      return tool.execute("read-skill", { path: file }, undefined, undefined, {} as never);
    };
    return { snapshot, turn, read };
  };
  return { root, workspace, skill, disabled, prepare, gateway };
}
it("keeps implicit Skills readable independently of explicit wrapper limits", async () => {
  const { skill, prepare } = await setup();
  const large = skill("large", "needle\n" + "x".repeat(512 * 1024));
  const control = skill("control", "needle\u0001body");
  const { snapshot, turn, read } = await prepare();
  for (const file of [large, control]) {
    expect(snapshot.candidates.find((c) => c.canonicalPath === file)).toMatchObject({
      effective: true,
      explicitEligible: false
    });
    expect(turn.runtime.loadResult.skills.some((s) => s.filePath === file)).toBe(true);
    expect(JSON.stringify(await read(file))).toContain("needle");
    writeFileSync(file, "changed on disk");
    expect(JSON.stringify(await read(file))).toContain("needle");
  }
});
it("reads admitted resources in every profile without admitting siblings, traversal or symlinks", async () => {
  const { root, workspace, skill, disabled, prepare, gateway } = await setup();
  const allowed = skill("allowed", "Read references/guide.md");
  const denied = skill("disabled", "disabled");
  disabled.add(denied);
  const hidden = skill("explicit", "explicit", true);
  const { read } = await prepare();
  const dir = path.dirname(allowed);
  symlinkSync(path.dirname(denied), path.join(dir, "linked"), "dir");
  for (const permission of ["ask", "readonly", "full"] as const) {
    gateway.setPolicy("s", { permission, workspaceRoot: workspace });
    expect(JSON.stringify(await read(path.join(dir, "references/guide.md")))).toContain(
      "allowed reference"
    );
    for (const file of [
      path.join(path.dirname(denied), "references/guide.md"),
      path.join(path.dirname(hidden), "references/guide.md"),
      `${dir}/../disabled/SKILL.md`,
      path.join(dir, "linked/references/guide.md"),
      path.join(root, "other")
    ])
      await expect(read(file)).rejects.toThrow();
  }
  renameSync(dir, `${dir}-old`);
  mkdirSync(path.join(dir, "references"), { recursive: true });
  writeFileSync(path.join(dir, "references/guide.md"), "replacement root");
  await expect(read(path.join(dir, "references/guide.md"))).rejects.toThrow();
});
it("admits explicitly selected Skill resources only for that runtime identity", async () => {
  const { skill, prepare } = await setup();
  skill("ordinary", "ordinary");
  const explicit = skill("explicit", "explicit", true);
  const before = await prepare();
  const selected = await prepare([{ name: "explicit", path: explicit }]);
  const after = await prepare();
  const resource = path.join(path.dirname(explicit), "references/guide.md");
  expect(JSON.stringify(await selected.read(resource))).toContain("explicit reference");
  await expect(before.read(resource)).rejects.toThrow();
  await expect(after.read(resource)).rejects.toThrow();
  expect(selected.turn.runtime.effectiveRevision).not.toBe(before.turn.runtime.effectiveRevision);
  expect(after.turn.runtime.effectiveRevision).toBe(before.turn.runtime.effectiveRevision);
});

it("does not advertise Skill bodies beyond the shared read budget", async () => {
  const { skill, prepare } = await setup();
  const large = skill("too-large", "x".repeat(10 * 1024 * 1024 + 1));
  const { snapshot, turn } = await prepare();
  expect(snapshot.candidates.find((c) => c.canonicalPath === large)).toMatchObject({
    status: "invalid",
    rawContent: null
  });
  expect(turn.runtime.loadResult.skills).toEqual([]);
  expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: "read_too_large" }));
});
