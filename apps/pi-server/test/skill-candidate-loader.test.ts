import { createHash } from "node:crypto";
import path from "node:path";
import type { LoadSkillsResult, ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SKILL_EXPLICIT_BYTES,
  SKILL_PREVIEW_BYTES,
  hasUnsupportedXmlChar,
  loadSkillCandidate,
  type CandidateLoaderDeps
} from "../src/skills/candidate-loader.js";
import type { DiscoveredSkillFile } from "../src/skills/types.js";

const discoveredPath = "/discovered/demo/SKILL.md";
const canonicalPath = "/canonical/demo/SKILL.md";
const V1 = "---\nname: demo-v1\ndescription: version one\n---\n\n# One\n";
const V2 = "---\nname: demo-v2\ndescription: version two\n---\n\n# Two\n";

const descriptor: DiscoveredSkillFile = {
  discoveredPath,
  sourceRoot: "/discovered",
  relativePath: "demo/SKILL.md",
  source: "workspace_marginalia",
  scope: "workspace",
  mode: "pi",
  sourcePriority: 1,
  ancestorDepth: 0
};

function skill(overrides: Partial<Skill> = {}): Skill {
  const filePath = overrides.filePath ?? canonicalPath;
  const baseDir = overrides.baseDir ?? path.dirname(filePath);
  return {
    name: "demo",
    description: "Demo skill",
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

function result(
  parsedSkill: Skill | null = skill(),
  diagnostics: ResourceDiagnostic[] = []
): LoadSkillsResult {
  return { skills: parsedSkill ? [parsedSkill] : [], diagnostics };
}

type FakeDepsOptions = {
  reads?: Buffer[];
  realpaths?: string[];
  parseResults?: LoadSkillsResult[];
  events?: string[];
};

function fakeDeps(options: FakeDepsOptions = {}): CandidateLoaderDeps {
  const reads = [...(options.reads ?? [Buffer.from(V1), Buffer.from(V1)])];
  const realpaths = [...(options.realpaths ?? [canonicalPath, canonicalPath])];
  const parseResults = [...(options.parseResults ?? [result()])];
  return {
    realpath: vi.fn(async (inputPath: string) => {
      options.events?.push(`realpath:${inputPath}`);
      const value = realpaths.shift();
      if (value === undefined) throw new Error("unexpected realpath call");
      return value;
    }),
    readFile: vi.fn(async (inputPath: string) => {
      options.events?.push(`read:${inputPath}`);
      const value = reads.shift();
      if (value === undefined) throw new Error("unexpected read call");
      return value;
    }),
    parse: vi.fn((inputPath: string) => {
      options.events?.push(`parse:${inputPath}`);
      return parseResults.shift() ?? result();
    })
  };
}

describe("loadSkillCandidate", () => {
  it("accepts only metadata parsed between equal reads", async () => {
    const events: string[] = [];
    const deps = fakeDeps({
      reads: [Buffer.from(V1), Buffer.from(V2), Buffer.from(V2), Buffer.from(V2)],
      parseResults: [result(skill({ name: "demo-v1" })), result(skill({ name: "demo-v2" }))],
      realpaths: [canonicalPath, canonicalPath, canonicalPath, canonicalPath],
      events
    });

    const candidate = await loadSkillCandidate(descriptor, deps);

    expect(candidate.rawContent).toBe(V2);
    expect(candidate.skill?.name).toBe("demo-v2");
    expect(deps.parse).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      `realpath:${discoveredPath}`,
      `read:${canonicalPath}`,
      `parse:${canonicalPath}`,
      `realpath:${discoveredPath}`,
      `read:${canonicalPath}`,
      `realpath:${discoveredPath}`,
      `read:${canonicalPath}`,
      `parse:${canonicalPath}`,
      `realpath:${discoveredPath}`,
      `read:${canonicalPath}`
    ]);
  });

  it("publishes unstable_file after exactly three attempts", async () => {
    const reads = Array.from({ length: 6 }, (_, index) => Buffer.from(`version-${index}`));
    const deps = fakeDeps({
      reads,
      realpaths: Array(6).fill(canonicalPath),
      parseResults: [result(), result(), result()]
    });

    const candidate = await loadSkillCandidate(descriptor, deps);

    expect(deps.parse).toHaveBeenCalledTimes(3);
    expect(deps.realpath).toHaveBeenCalledTimes(6);
    expect(deps.readFile).toHaveBeenCalledTimes(6);
    expect(candidate.skill).toBeNull();
    expect(candidate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unstable_file", level: "error" })
    );
  });

  it("returns a valid candidate with SHA-256 content identity", async () => {
    const content = Buffer.from(V1);

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result(skill({ name: "demo" }))] })
    );

    expect(candidate).toMatchObject({
      canonicalPath,
      canonicalBaseDir: path.dirname(canonicalPath),
      bytesTotal: content.byteLength,
      contentHash: createHash("sha256").update(content).digest("hex"),
      explicitEligible: true,
      explicitOnly: false,
      rawContent: V1,
      previewContent: V1,
      previewTruncated: false
    });
    expect(candidate.skill?.name).toBe("demo");
    expect(candidate.diagnostics).toEqual([]);
  });

  it("keeps a Pi warning candidate valid when Pi also returns a Skill", async () => {
    const warning: ResourceDiagnostic = {
      type: "warning",
      message: "name should use lowercase letters",
      path: canonicalPath
    };

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ parseResults: [result(skill(), [warning])] })
    );

    expect(candidate.skill).not.toBeNull();
    expect(candidate.explicitEligible).toBe(true);
    expect(candidate.diagnostics).toContainEqual({
      code: "pi_warning",
      level: "warning",
      message: warning.message,
      path: canonicalPath
    });
  });

  it("marks a stable candidate invalid when Pi returns no Skill", async () => {
    const warning: ResourceDiagnostic = {
      type: "warning",
      message: "description is required",
      path: canonicalPath
    };

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ parseResults: [result(null, [warning])] })
    );

    expect(candidate.skill).toBeNull();
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
    expect(candidate.previewContent).toBe(V1);
    expect(candidate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "pi_warning", message: "description is required" })
    );
  });

  it("turns a read failure into an invalid candidate diagnostic", async () => {
    const deps: CandidateLoaderDeps = {
      realpath: vi.fn(async () => canonicalPath),
      readFile: vi.fn(async () => {
        throw new Error("permission denied");
      }),
      parse: vi.fn(() => result())
    };

    await expect(loadSkillCandidate(descriptor, deps)).resolves.toMatchObject({
      skill: null,
      explicitEligible: false,
      diagnostics: [
        expect.objectContaining({
          code: "read_failed",
          level: "error",
          message: expect.stringContaining("permission denied")
        })
      ]
    });
    expect(deps.parse).not.toHaveBeenCalled();
  });

  it("keeps the complete 512 KiB boundary eligible and truncates only its preview", async () => {
    const content = Buffer.alloc(SKILL_EXPLICIT_BYTES, "a");

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.bytesTotal).toBe(SKILL_EXPLICIT_BYTES);
    expect(candidate.explicitEligible).toBe(true);
    expect(Buffer.byteLength(candidate.rawContent ?? "", "utf8")).toBe(SKILL_EXPLICIT_BYTES);
    expect(Buffer.byteLength(candidate.previewContent, "utf8")).toBe(SKILL_PREVIEW_BYTES);
    expect(candidate.previewTruncated).toBe(true);
  });

  it("keeps only a 256 KiB preview above the explicit size limit", async () => {
    const content = Buffer.alloc(SKILL_EXPLICIT_BYTES + 1, "b");

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.bytesTotal).toBe(SKILL_EXPLICIT_BYTES + 1);
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
    expect(Buffer.byteLength(candidate.previewContent, "utf8")).toBe(SKILL_PREVIEW_BYTES);
    expect(candidate.previewTruncated).toBe(true);
    expect(candidate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "too_large", level: "warning" })
    );
  });

  it("uses Buffer bytes rather than JavaScript string length for size decisions", async () => {
    const content = Buffer.from("😀".repeat(SKILL_EXPLICIT_BYTES / 4 + 1), "utf8");
    expect(content.toString("utf8").length).toBeLessThan(SKILL_EXPLICIT_BYTES);
    expect(content.byteLength).toBeGreaterThan(SKILL_EXPLICIT_BYTES);

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.bytesTotal).toBe(content.byteLength);
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
  });

  it("maps disable-model-invocation to explicitOnly", async () => {
    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ parseResults: [result(skill({ disableModelInvocation: true }))] })
    );

    expect(candidate.explicitOnly).toBe(true);
    expect(candidate.explicitEligible).toBe(true);
  });

  it("retries when the canonical realpath changes and accepts the later stable path", async () => {
    const pathA = "/canonical-a/demo/SKILL.md";
    const pathB = "/canonical-b/demo/SKILL.md";
    const content = Buffer.from(V1);
    const deps = fakeDeps({
      reads: [content, content, content, content],
      realpaths: [pathA, pathB, pathB, pathB],
      parseResults: [
        result(skill({ filePath: pathA, baseDir: path.dirname(pathA) })),
        result(skill({ filePath: pathB, baseDir: path.dirname(pathB) }))
      ]
    });

    const candidate = await loadSkillCandidate(descriptor, deps);

    expect(deps.parse).toHaveBeenNthCalledWith(1, pathA);
    expect(deps.parse).toHaveBeenNthCalledWith(2, pathB);
    expect(candidate.canonicalPath).toBe(pathB);
    expect(candidate.canonicalBaseDir).toBe(path.dirname(pathB));
    expect(candidate.skill?.filePath).toBe(pathB);
  });

  it.each([
    {
      label: "name",
      stablePath: canonicalPath,
      parsedSkill: skill({ name: "bad\u0001name" })
    },
    {
      label: "path",
      stablePath: "/canonical/demo/bad\u0001.md",
      parsedSkill: skill({
        filePath: "/canonical/demo/bad\u0001.md",
        baseDir: "/canonical/demo"
      })
    },
    {
      label: "baseDir",
      stablePath: "/canonical/bad\u0001/demo/SKILL.md",
      parsedSkill: skill({
        filePath: "/canonical/bad\u0001/demo/SKILL.md",
        baseDir: "/canonical/bad\u0001/demo"
      })
    }
  ])(
    "rejects an XML 1.0 control character in the Skill $label",
    async ({ stablePath, parsedSkill }) => {
      const candidate = await loadSkillCandidate(
        descriptor,
        fakeDeps({
          realpaths: [stablePath, stablePath],
          parseResults: [result(parsedSkill)]
        })
      );

      expect(candidate.skill).not.toBeNull();
      expect(candidate.explicitEligible).toBe(false);
      expect(candidate.rawContent).toBeNull();
      expect(candidate.diagnostics).toContainEqual(
        expect.objectContaining({ code: "unsupported_identifier", level: "error" })
      );
    }
  );
});

describe("hasUnsupportedXmlChar", () => {
  it("accepts XML 1.0 characters including allowed whitespace and supplementary planes", () => {
    expect(hasUnsupportedXmlChar("name\tline\ncarriage\r😀")).toBe(false);
  });

  it.each(["\u0000", "\u0001", "\u000b", "\ufffe", "\uffff"])(
    "rejects unsupported XML 1.0 character U+%s",
    (value) => {
      expect(hasUnsupportedXmlChar(value)).toBe(true);
    }
  );
});
