import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LoadSkillsResult, ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SKILL_EXPLICIT_BYTES,
  SKILL_PREVIEW_BYTES,
  hasUnsupportedXmlChar,
  loadSkillCandidate,
  parseCapturedSkillContent,
  type CandidateLoaderDeps
} from "../src/skills/candidate-loader.js";
import type { DiscoveredSkillFile } from "../src/skills/types.js";

const discoveredPath = "/discovered/demo/SKILL.md";
const canonicalPath = "/canonical/demo/SKILL.md";
const V1 = "---\nname: demo-v1\ndescription: version one\n---\n\n# One\n";
const V2 = "---\nname: demo-v2\ndescription: version two\n---\n\n# Two\n";
const tempRoots: string[] = [];

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

function writeTempSkill(content: string): DiscoveredSkillFile {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), "marginalia-skill-candidate-"));
  tempRoots.push(sourceRoot);
  const filePath = path.join(sourceRoot, "demo/SKILL.md");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return { ...descriptor, discoveredPath: filePath, sourceRoot };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

  it("binds Pi metadata parsing to the bytes captured by the stable read", async () => {
    const content = Buffer.from(V2);
    const parse = vi.fn((_inputPath: string, capturedContent?: Buffer) =>
      capturedContent?.equals(content)
        ? result(skill({ name: "demo-v2" }))
        : result(skill({ name: "stale-path-version" }))
    );

    const candidate = await loadSkillCandidate(descriptor, {
      ...fakeDeps({ reads: [content, content] }),
      parse
    });

    expect(candidate.rawContent).toBe(V2);
    expect(candidate.skill?.name).toBe("demo-v2");
    expect(parse).toHaveBeenCalledWith(canonicalPath, content);
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

  it("preserves Pi collision identity in a mapped diagnostic", async () => {
    const collision: ResourceDiagnostic = {
      type: "collision",
      message: 'name "demo" collision',
      path: canonicalPath,
      collision: {
        resourceType: "skill",
        name: "demo",
        winnerPath: "/canonical/winner/SKILL.md",
        loserPath: canonicalPath,
        winnerSource: "workspace",
        loserSource: "user"
      }
    };

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ parseResults: [result(skill(), [collision])] })
    );

    expect(candidate.diagnostics).toContainEqual({
      code: "pi_collision",
      level: "warning",
      message: collision.message,
      path: canonicalPath,
      collision: collision.collision
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

  it("does not split a valid UTF-8 code point at the preview byte boundary", async () => {
    const asciiPrefix = "a".repeat(SKILL_PREVIEW_BYTES - 1);
    const content = Buffer.concat([Buffer.from(asciiPrefix), Buffer.from("😀z")]);

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.previewContent).toHaveLength(SKILL_PREVIEW_BYTES - 1);
    expect(new Set(candidate.previewContent)).toEqual(new Set(["a"]));
    expect(candidate.previewContent).not.toContain("\ufffd");
    expect(Buffer.byteLength(candidate.previewContent, "utf8")).toBe(SKILL_PREVIEW_BYTES - 1);
    expect(candidate.previewTruncated).toBe(true);
    expect(candidate.rawContent?.endsWith("😀z")).toBe(true);
    expect(Buffer.byteLength(candidate.rawContent ?? "", "utf8")).toBe(content.byteLength);
  });

  it("marks malformed UTF-8 invalid instead of silently changing its explicit body", async () => {
    const content = Buffer.alloc(SKILL_EXPLICIT_BYTES, 0xff);

    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.skill).toBeNull();
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
    expect(candidate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_utf8", level: "error" })
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

  it("keeps an XML 1.0 control character in the body out of explicit selection", async () => {
    const content = Buffer.from(`${V1}unsafe\u0001body`);
    const candidate = await loadSkillCandidate(
      descriptor,
      fakeDeps({ reads: [content, content], parseResults: [result()] })
    );

    expect(candidate.skill).not.toBeNull();
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
    expect(candidate.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported_identifier", level: "error" })
    );
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

    expect(deps.parse).toHaveBeenNthCalledWith(1, pathA, content);
    expect(deps.parse).toHaveBeenNthCalledWith(2, pathB, content);
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

  it.each([
    {
      label: "name",
      stablePath: canonicalPath,
      parsedSkill: skill({ name: "line-one\nline-two" })
    },
    {
      label: "path",
      stablePath: "/canonical/demo/line\nbreak.md",
      parsedSkill: skill({
        filePath: "/canonical/demo/line\nbreak.md",
        baseDir: "/canonical/demo"
      })
    },
    {
      label: "baseDir",
      stablePath: "/canonical/line\nbreak/SKILL.md",
      parsedSkill: skill({
        filePath: "/canonical/line\nbreak/SKILL.md",
        baseDir: "/canonical/line\nbreak"
      })
    }
  ])(
    "keeps a line break in the Skill $label out of explicit selection",
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

describe("default Pi parser adapter", () => {
  it("parses captured bytes instead of the current source-path contents", () => {
    const live = writeTempSkill(V1);

    const parsed = parseCapturedSkillContent(live.discoveredPath, Buffer.from(V2));

    expect(parsed.skills[0]).toMatchObject({
      name: "demo-v2",
      filePath: live.discoveredPath,
      baseDir: path.dirname(live.discoveredPath)
    });
  });

  it("returns no Skill when Pi rejects a missing description", async () => {
    const candidate = await loadSkillCandidate(
      writeTempSkill("---\nname: missing-description\n---\n\n# Missing\n")
    );

    expect(candidate.skill).toBeNull();
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.diagnostics).toEqual([
      expect.objectContaining({ code: "pi_warning", level: "warning" })
    ]);
  });

  it("keeps a Skill when Pi emits a validation warning", async () => {
    const candidate = await loadSkillCandidate(
      writeTempSkill("---\nname: Invalid_Name\ndescription: Still loadable\n---\n\n# Warning\n")
    );

    expect(candidate.skill?.name).toBe("Invalid_Name");
    expect(candidate.explicitEligible).toBe(true);
    expect(candidate.diagnostics).toEqual([
      expect.objectContaining({ code: "pi_warning", level: "warning" })
    ]);
  });

  it("keeps Pi's multiline-name warning visible but blocks explicit serialization", async () => {
    const candidate = await loadSkillCandidate(
      writeTempSkill(
        "---\nname: |-\n  line-one\n  line-two\ndescription: Multiline name\n---\n\n# Warning\n"
      )
    );

    expect(candidate.skill?.name).toBe("line-one\nline-two");
    expect(candidate.explicitEligible).toBe(false);
    expect(candidate.rawContent).toBeNull();
    expect(candidate.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pi_warning", level: "warning" }),
        expect.objectContaining({ code: "unsupported_identifier", level: "error" })
      ])
    );
  });

  it("maps Pi disable-model-invocation metadata to explicitOnly", async () => {
    const candidate = await loadSkillCandidate(
      writeTempSkill(
        "---\nname: explicit-only\ndescription: Explicit only\ndisable-model-invocation: true\n---\n\n# Explicit\n"
      )
    );

    expect(candidate.skill?.disableModelInvocation).toBe(true);
    expect(candidate.explicitOnly).toBe(true);
    expect(candidate.explicitEligible).toBe(true);
  });
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
