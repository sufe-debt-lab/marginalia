import path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { SkillPreference, SkillPreferenceStore } from "../src/db/skill-preferences.js";
import {
  SkillCandidateNotFoundError,
  createSkillCatalogService,
  type SkillCatalogDependencies
} from "../src/skills/catalog.js";
import type {
  DiscoveredSkillFile,
  ParsedSkillCandidate,
  SkillDiagnostic
} from "../src/skills/types.js";

const workspace = { workspaceId: "workspace-1", workspaceRoot: "/workspace" } as const;
const globalOnly = { workspaceId: null, workspaceRoot: null } as const;

function descriptor(
  relativePath: string,
  overrides: Partial<DiscoveredSkillFile> = {}
): DiscoveredSkillFile {
  const discoveredPath = `/workspace/.marginalia/skills/${relativePath}`;
  return {
    discoveredPath,
    sourceRoot: "/workspace/.marginalia/skills",
    relativePath,
    source: "workspace_marginalia",
    scope: "workspace",
    mode: "pi",
    sourcePriority: 1,
    ancestorDepth: 0,
    ...overrides
  };
}

function skill(filePath: string, overrides: Partial<Skill> = {}): Skill {
  const baseDir = path.dirname(filePath);
  return {
    name: path.basename(baseDir),
    description: `${path.basename(baseDir)} description`,
    filePath,
    baseDir,
    sourceInfo: {
      path: filePath,
      source: "path",
      scope: "temporary",
      origin: "top-level",
      baseDir
    },
    disableModelInvocation: false,
    ...overrides
  };
}

function parsed(
  relativePath: string,
  overrides: Partial<ParsedSkillCandidate> = {}
): ParsedSkillCandidate {
  const discovered = descriptor(relativePath, overrides);
  const canonicalPath = overrides.canonicalPath ?? `/canonical/${relativePath}`;
  return {
    ...discovered,
    canonicalPath,
    canonicalBaseDir: path.dirname(canonicalPath),
    skill: skill(canonicalPath),
    diagnostics: [],
    bytesTotal: 20,
    contentHash: `hash:${relativePath}`,
    explicitEligible: true,
    explicitOnly: false,
    rawContent: `body:${relativePath}`,
    previewContent: `body:${relativePath}`,
    previewTruncated: false,
    ...overrides
  };
}

function preferences(initial: SkillPreference[] = []): SkillPreferenceStore & {
  values: SkillPreference[];
} {
  const values = initial.map((item) => ({ ...item }));
  return {
    values,
    enabledFor(skillPath) {
      return values.find((item) => item.skillPath === skillPath)?.enabled ?? true;
    },
    setEnabled(skillPath, enabled) {
      const value = { skillPath, enabled, updatedAt: Date.now() };
      const index = values.findIndex((item) => item.skillPath === skillPath);
      if (index === -1) values.push(value);
      else values[index] = value;
      return value;
    },
    list: vi.fn(() => values.map((item) => ({ ...item })))
  };
}

function service(
  candidates:
    | ParsedSkillCandidate[]
    | (() => ParsedSkillCandidate[] | Promise<ParsedSkillCandidate[]>),
  options: Partial<SkillCatalogDependencies> = {}
) {
  const preferenceStore = options.preferences ?? preferences();
  const discover = vi.fn(async () => {
    const current = typeof candidates === "function" ? await candidates() : candidates;
    return current.map((candidate) => descriptor(candidate.relativePath, candidate));
  });
  const byDiscoveredPath = () => {
    const current = typeof candidates === "function" ? null : candidates;
    return new Map(current?.map((candidate) => [candidate.discoveredPath, candidate]));
  };
  const loadCandidate = vi.fn(async (item: DiscoveredSkillFile) => {
    if (typeof candidates === "function") {
      throw new Error("function candidates require an injected loadCandidate");
    }
    const candidate = byDiscoveredPath().get(item.discoveredPath);
    if (!candidate) throw new Error(`missing fixture for ${item.discoveredPath}`);
    return candidate;
  });

  return {
    catalog: createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferenceStore,
      discover,
      loadCandidate,
      now: () => 1_000,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root),
      ...options
    }),
    discover,
    loadCandidate,
    preferences: preferenceStore
  };
}

describe("Skill catalog reduction", () => {
  it.each([
    { valid: false, enabled: false, winner: false, status: "invalid" },
    { valid: true, enabled: false, winner: false, status: "disabled" },
    { valid: true, enabled: true, winner: false, status: "shadowed" },
    { valid: true, enabled: true, winner: true, status: "effective" }
  ] as const)(
    "publishes $status when valid=$valid enabled=$enabled winner=$winner",
    async ({ valid, enabled, winner, status }) => {
      const target = parsed("target/SKILL.md", {
        skill: valid
          ? skill("/canonical/target/SKILL.md", { name: winner ? "target" : "shared" })
          : null
      });
      const fixtures = winner
        ? [target]
        : [
            parsed("winner/SKILL.md", {
              skill: skill("/canonical/winner/SKILL.md", { name: "shared" })
            }),
            target
          ];
      const store = preferences([{ skillPath: target.canonicalPath, enabled, updatedAt: 1 }]);

      const snapshot = await service(fixtures, { preferences: store }).catalog.refresh(workspace);
      const published = snapshot.candidates.find(
        (candidate) => candidate.canonicalPath === target.canonicalPath
      );

      expect(published).toMatchObject({ enabled, effective: status === "effective", status });
      expect(published?.shadowedBy).toBe(
        status === "shadowed" ? "/canonical/winner/SKILL.md" : null
      );
    }
  );

  it("lets the next enabled valid duplicate win when the higher-priority candidate is disabled", async () => {
    const first = parsed("first/SKILL.md", {
      skill: skill("/canonical/first/SKILL.md", { name: "shared" })
    });
    const second = parsed("second/SKILL.md", {
      skill: skill("/canonical/second/SKILL.md", { name: "shared" })
    });
    const store = preferences([{ skillPath: first.canonicalPath, enabled: false, updatedAt: 1 }]);

    const snapshot = await service([first, second], { preferences: store }).catalog.refresh(
      workspace
    );

    expect(snapshot.candidates.map(({ status }) => status)).toEqual(["disabled", "effective"]);
    expect(snapshot.effectiveSkills.map(({ filePath }) => filePath)).toEqual([
      second.skill?.filePath
    ]);
  });

  it("does not let invalid or disabled candidates occupy a Skill name", async () => {
    const invalid = parsed("invalid/SKILL.md", {
      skill: null
    });
    const disabled = parsed("disabled/SKILL.md", {
      skill: skill("/canonical/disabled/SKILL.md", { name: "shared" })
    });
    const successor = parsed("successor/SKILL.md", {
      skill: skill("/canonical/successor/SKILL.md", { name: "shared" })
    });
    const store = preferences([
      { skillPath: disabled.canonicalPath, enabled: false, updatedAt: 1 }
    ]);

    const snapshot = await service([invalid, disabled, successor], {
      preferences: store
    }).catalog.refresh(workspace);

    expect(snapshot.candidates.map(({ status }) => status)).toEqual([
      "invalid",
      "disabled",
      "effective"
    ]);
  });

  it("deduplicates canonical aliases before preference and collision reduction, keeping the first", async () => {
    const first = parsed("alias-a/SKILL.md", {
      canonicalPath: "/canonical/shared/SKILL.md",
      previewContent: "first"
    });
    const alias = parsed("alias-b/SKILL.md", {
      canonicalPath: first.canonicalPath,
      previewContent: "second"
    });
    const store = preferences();

    const snapshot = await service([first, alias], { preferences: store }).catalog.refresh(
      workspace
    );

    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]?.relativePath).toBe("alias-a/SKILL.md");
    expect(snapshot.candidates[0]?.previewContent).toBe("first");
    expect(store.list).toHaveBeenCalledTimes(1);
  });

  it("preserves discovery order and points collisions at the canonical first-name winner", async () => {
    const names = ["Z.md", "a.md", "𐐀.md", "😀.md"];
    const fixtures = names.map((relativePath) =>
      parsed(relativePath, {
        skill: skill(`/canonical/${relativePath}`, { name: "shared" })
      })
    );

    const snapshot = await service(fixtures).catalog.refresh(workspace);

    expect(snapshot.candidates.map(({ relativePath }) => relativePath)).toEqual(names);
    expect(snapshot.candidates.map(({ status }) => status)).toEqual([
      "effective",
      "shadowed",
      "shadowed",
      "shadowed"
    ]);
    expect(snapshot.candidates.slice(1).map(({ shadowedBy }) => shadowedBy)).toEqual(
      Array(3).fill("/canonical/Z.md")
    );
  });

  it("aggregates original parse diagnostics without reparsing candidates", async () => {
    const diagnostic: SkillDiagnostic = {
      code: "pi_warning",
      level: "warning",
      message: "warning",
      path: "/canonical/demo/SKILL.md"
    };
    const fixture = parsed("demo/SKILL.md", { diagnostics: [diagnostic] });
    const originalSkill = fixture.skill!;
    const harness = service([fixture]);

    const snapshot = await harness.catalog.refresh(workspace);

    expect(harness.loadCandidate).toHaveBeenCalledTimes(1);
    expect(snapshot.diagnostics).toEqual([diagnostic]);
    expect(snapshot.effectiveSkills[0]).toEqual(originalSkill);
    expect(snapshot.effectiveSkills[0]).not.toBe(originalSkill);
    expect(Object.isFrozen(originalSkill)).toBe(false);
  });
});

describe("Skill catalog revisions and immutability", () => {
  it("changes catalogRevision for diagnostics, preferences, and preview while effectiveRevision tracks only runtime data", async () => {
    let fixture = parsed("demo/SKILL.md");
    const store = preferences();
    const discover = vi.fn(async () => [descriptor(fixture.relativePath, fixture)]);
    const loadCandidate = vi.fn(async () => fixture);
    let time = 1_000;
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: store,
      discover,
      loadCandidate,
      now: () => time++,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });

    const base = await catalog.refresh(workspace);
    const repeated = await catalog.refresh(workspace);
    expect(repeated.refreshedAt).not.toBe(base.refreshedAt);
    expect(repeated.catalogRevision).toBe(base.catalogRevision);
    expect(repeated.effectiveRevision).toBe(base.effectiveRevision);

    fixture = { ...fixture, diagnostics: [{ code: "warn", level: "warning", message: "new" }] };
    const diagnostic = await catalog.refresh(workspace);
    expect(diagnostic.catalogRevision).not.toBe(base.catalogRevision);
    expect(diagnostic.effectiveRevision).toBe(base.effectiveRevision);

    fixture = { ...fixture, previewContent: "different preview" };
    const preview = await catalog.refresh(workspace);
    expect(preview.catalogRevision).not.toBe(diagnostic.catalogRevision);
    expect(preview.effectiveRevision).toBe(base.effectiveRevision);

    store.values.push({ skillPath: fixture.canonicalPath, enabled: false, updatedAt: 5 });
    const disabled = await catalog.refresh(workspace);
    expect(disabled.catalogRevision).not.toBe(preview.catalogRevision);
    expect(disabled.effectiveRevision).not.toBe(base.effectiveRevision);
  });

  it("changes effectiveRevision for effective metadata, canonical path, order, and body hash only", async () => {
    let fixtures = [parsed("a/SKILL.md"), parsed("b/SKILL.md")];
    const discover = vi.fn(async () => fixtures.map((item) => descriptor(item.relativePath, item)));
    const loadCandidate = vi.fn(async (item: DiscoveredSkillFile) => {
      return fixtures.find((fixture) => fixture.discoveredPath === item.discoveredPath)!;
    });
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate,
      now: () => 1,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });

    const base = await catalog.refresh(workspace);
    fixtures = fixtures.map((item, index) =>
      index === 0
        ? {
            ...item,
            skill: { ...item.skill!, description: "changed metadata" },
            contentHash: "changed body hash"
          }
        : item
    );
    const changed = await catalog.refresh(workspace);
    expect(changed.effectiveRevision).not.toBe(base.effectiveRevision);

    fixtures = [fixtures[1]!, fixtures[0]!];
    const reordered = await catalog.refresh(workspace);
    expect(reordered.effectiveRevision).not.toBe(changed.effectiveRevision);
  });

  it("deep-freezes published clones without freezing loader-owned Pi objects", async () => {
    const original = parsed("immutable/SKILL.md");
    const snapshot = await service([original]).catalog.refresh(workspace);
    const candidate = snapshot.candidates[0]!;

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.candidates)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.diagnostics)).toBe(true);
    expect(Object.isFrozen(candidate.skill)).toBe(true);
    expect(Object.isFrozen(candidate.skill?.sourceInfo)).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
    expect(Object.isFrozen(original.skill)).toBe(false);
    expect(() => ((candidate.skill!.description as string) = "mutated")).toThrow();
  });
});

describe("Skill catalog refresh and cache", () => {
  it("serializes refreshes and prevents an older generation from publishing over a newer request", async () => {
    const first = parsed("first/SKILL.md");
    const second = parsed("second/SKILL.md");
    const releases: Array<() => void> = [];
    let discovery = 0;
    const discover = vi.fn(
      () =>
        new Promise<DiscoveredSkillFile[]>((resolve) => {
          const fixture = discovery++ === 0 ? first : second;
          releases.push(() => resolve([descriptor(fixture.relativePath, fixture)]));
        })
    );
    const loadCandidate = vi.fn(async (item: DiscoveredSkillFile) =>
      item.relativePath === first.relativePath ? first : second
    );
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });

    const older = catalog.refresh(workspace);
    const newer = catalog.refresh(workspace);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]!();
    await older;
    expect(catalog.current(workspace)).toBeNull();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();

    await expect(newer).resolves.toMatchObject({
      candidates: [expect.objectContaining({ relativePath: "second/SKILL.md" })]
    });
    expect(catalog.current(workspace)?.candidates[0]?.relativePath).toBe("second/SKILL.md");
  });

  it("retains a staged older success when the newest generation fails on a cold cache", async () => {
    const fixture = parsed("staged/SKILL.md");
    let releaseOlder!: () => void;
    const discover = vi
      .fn<SkillCatalogDependencies["discover"]>()
      .mockImplementationOnce(
        () =>
          new Promise<DiscoveredSkillFile[]>((resolve) => {
            releaseOlder = () => resolve([descriptor(fixture.relativePath, fixture)]);
          })
      )
      .mockRejectedValueOnce(new Error("newest failed"));
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate: async () => fixture,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });

    const older = catalog.refresh(workspace);
    const newer = catalog.refresh(workspace);
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
    releaseOlder();

    await older;
    await expect(newer).rejects.toThrow("newest failed");
    expect(catalog.current(workspace)?.candidates[0]?.relativePath).toBe("staged/SKILL.md");
  });

  it("uses one canonical workspace root for the cache, discovery, and snapshot", async () => {
    const fixture = parsed("canonical/SKILL.md");
    const canonicalizeWorkspaceRoot = vi.fn(() => "/canonical-workspace");
    const discover = vi.fn(async () => [descriptor(fixture.relativePath, fixture)]);
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate: async () => fixture,
      canonicalizeWorkspaceRoot
    });

    const snapshot = await catalog.refresh({
      workspaceId: "workspace-1",
      workspaceRoot: "/workspace-link"
    });

    expect(canonicalizeWorkspaceRoot).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledWith({
      workspaceRoot: "/canonical-workspace",
      homeDir: "/home/test"
    });
    expect(snapshot.workspaceRoot).toBe("/canonical-workspace");
  });

  it("bounds candidate loading concurrency while preserving descriptor order", async () => {
    const fixtures = Array.from({ length: 12 }, (_, index) =>
      parsed(`${index.toString().padStart(2, "0")}/SKILL.md`)
    );
    let active = 0;
    let maximumActive = 0;
    const loadCandidate = vi.fn(async (item: DiscoveredSkillFile) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return fixtures.find((fixture) => fixture.discoveredPath === item.discoveredPath)!;
    });
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover: async () => fixtures.map((item) => descriptor(item.relativePath, item)),
      loadCandidate,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });

    const snapshot = await catalog.refresh(workspace);

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(snapshot.candidates.map(({ relativePath }) => relativePath)).toEqual(
      fixtures.map(({ relativePath }) => relativePath)
    );
  });

  it("rejects a failed refresh and retains the prior successful snapshot", async () => {
    const fixture = parsed("stable/SKILL.md");
    const discover = vi
      .fn<SkillCatalogDependencies["discover"]>()
      .mockResolvedValueOnce([descriptor(fixture.relativePath, fixture)])
      .mockRejectedValueOnce(new Error("discovery failed"));
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate: async () => fixture,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });
    const prior = await catalog.refresh(workspace);

    await expect(catalog.refresh(workspace)).rejects.toThrow("discovery failed");
    expect(catalog.current(workspace)).toBe(prior);
  });

  it("isolates global-only and canonical workspace caches", async () => {
    const globalCandidate = parsed("global/SKILL.md", {
      source: "user_marginalia",
      scope: "user"
    });
    const workspaceCandidate = parsed("workspace/SKILL.md");
    const discover = vi.fn(async ({ workspaceRoot }: { workspaceRoot?: string | null }) =>
      workspaceRoot
        ? [descriptor(workspaceCandidate.relativePath, workspaceCandidate)]
        : [descriptor(globalCandidate.relativePath, globalCandidate)]
    );
    const loadCandidate = vi.fn(async (item: DiscoveredSkillFile) =>
      item.relativePath === globalCandidate.relativePath ? globalCandidate : workspaceCandidate
    );
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: preferences(),
      discover,
      loadCandidate,
      canonicalizeWorkspaceRoot: (root) =>
        root === "/workspace-alias" ? "/workspace" : path.resolve(root)
    });

    const globalSnapshot = await catalog.refresh(globalOnly);
    const workspaceSnapshot = await catalog.refresh(workspace);

    expect(catalog.current(globalOnly)).toBe(globalSnapshot);
    expect(catalog.current(workspace)).toBe(workspaceSnapshot);
    expect(catalog.current({ ...workspace, workspaceRoot: "/workspace-alias" })).toBe(
      workspaceSnapshot
    );
    expect(globalSnapshot.candidates[0]?.relativePath).toBe("global/SKILL.md");
    expect(workspaceSnapshot.candidates[0]?.relativePath).toBe("workspace/SKILL.md");
  });
});

describe("Skill catalog preferences", () => {
  it("persists only an exact current canonical member then refreshes", async () => {
    const fixture = parsed("toggle/SKILL.md");
    const harness = service([fixture]);
    const setEnabled = vi.spyOn(harness.preferences, "setEnabled");

    const snapshot = await harness.catalog.setEnabled({
      ...workspace,
      path: fixture.canonicalPath,
      enabled: false
    });

    expect(setEnabled).toHaveBeenCalledWith(fixture.canonicalPath, false);
    expect(harness.discover).toHaveBeenCalledTimes(2);
    expect(snapshot.candidates[0]).toMatchObject({ enabled: false, status: "disabled" });
  });

  it("throws SkillCandidateNotFoundError without persisting an absent path", async () => {
    const harness = service([parsed("known/SKILL.md")]);
    const setEnabled = vi.spyOn(harness.preferences, "setEnabled");

    await expect(
      harness.catalog.setEnabled({ ...workspace, path: "/etc/passwd", enabled: false })
    ).rejects.toBeInstanceOf(SkillCandidateNotFoundError);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("invalidates an old canonical selection when a discovered symlink retargets", async () => {
    const oldTarget = parsed("linked/SKILL.md", { canonicalPath: "/target-a/SKILL.md" });
    const newTarget = parsed("linked/SKILL.md", { canonicalPath: "/target-b/SKILL.md" });
    let target = oldTarget;
    const store = preferences();
    const discover = vi.fn(async () => [descriptor(target.relativePath, target)]);
    const loadCandidate = vi.fn(async () => target);
    const catalog = createSkillCatalogService({
      homeDir: "/home/test",
      preferences: store,
      discover,
      loadCandidate,
      canonicalizeWorkspaceRoot: (root) => path.resolve(root)
    });
    await catalog.refresh(workspace);
    target = newTarget;

    await expect(
      catalog.setEnabled({ ...workspace, path: oldTarget.canonicalPath, enabled: false })
    ).rejects.toMatchObject({ code: "skill_candidate_not_found" });
    expect(store.values).toEqual([]);
    expect(catalog.current(workspace)?.candidates[0]?.canonicalPath).toBe(newTarget.canonicalPath);
  });
});
