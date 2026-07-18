import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import {
  SkillPayloadTooLargeError,
  SkillPreconditionError,
  prepareSkillTurn,
  stripPiFrontmatter
} from "../src/skills/turn-preflight.js";
import type {
  SkillCandidate,
  SkillCatalogSnapshot,
  SkillDiagnostic as CatalogSkillDiagnostic,
  SkillStatus
} from "../src/skills/types.js";

function candidate(input: {
  name: string;
  canonicalPath?: string;
  canonicalBaseDir?: string;
  rawContent?: string | null;
  status?: SkillStatus;
  explicitEligible?: boolean;
  explicitOnly?: boolean;
  diagnostics?: CatalogSkillDiagnostic[];
}): SkillCandidate {
  const canonicalPath = input.canonicalPath ?? `/tmp/${input.name}/SKILL.md`;
  const canonicalBaseDir = input.canonicalBaseDir ?? path.dirname(canonicalPath);
  const status = input.status ?? "effective";
  const skill: Skill = {
    name: input.name,
    description: `${input.name} description`,
    filePath: canonicalPath,
    baseDir: canonicalBaseDir,
    sourceInfo: {
      path: canonicalPath,
      source: "local",
      scope: "project",
      origin: "skills-test",
      baseDir: canonicalBaseDir
    },
    disableModelInvocation: input.explicitOnly ?? false
  };
  return {
    discoveredPath: canonicalPath,
    sourceRoot: canonicalBaseDir,
    relativePath: "SKILL.md",
    source: "workspace_marginalia",
    scope: "workspace",
    mode: "pi",
    sourcePriority: 0,
    ancestorDepth: 0,
    canonicalPath,
    canonicalBaseDir,
    skill,
    diagnostics: input.diagnostics ?? [],
    bytesTotal: Buffer.byteLength(input.rawContent ?? "Body"),
    contentHash: `hash-${input.name}`,
    explicitEligible: input.explicitEligible ?? true,
    explicitOnly: input.explicitOnly ?? false,
    rawContent: input.rawContent === undefined ? "Body" : input.rawContent,
    previewContent: "",
    previewTruncated: false,
    enabled: status !== "disabled",
    effective: status === "effective",
    status,
    shadowedBy: status === "shadowed" ? "/tmp/winner/SKILL.md" : null
  };
}

function invalidCandidate(input: {
  canonicalPath: string;
  diagnostics?: CatalogSkillDiagnostic[];
}): SkillCandidate {
  return {
    ...candidate({ name: "invalid", canonicalPath: input.canonicalPath, status: "invalid" }),
    skill: null,
    rawContent: null,
    explicitEligible: false,
    diagnostics: input.diagnostics ?? []
  };
}

function snapshot(candidates: readonly SkillCandidate[]): SkillCatalogSnapshot {
  return {
    workspaceId: "w1",
    workspaceRoot: "/tmp",
    catalogRevision: "catalog-1",
    effectiveRevision: "effective-1",
    refreshedAt: 1,
    candidates,
    effectiveSkills: candidates.flatMap((item) =>
      item.effective && item.skill ? [item.skill] : []
    ),
    diagnostics: candidates.flatMap((item) => item.diagnostics)
  };
}

function selection(item: SkillCandidate) {
  return { name: item.skill?.name ?? "invalid", path: item.canonicalPath };
}

function blockBytes(name: string, location: string, body: string): number {
  const baseDir = path.dirname(location);
  return Buffer.byteLength(
    `<skill name="${name}" location="${location}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`,
    "utf8"
  );
}

describe("prepareSkillTurn", () => {
  it("returns a zero-selection plan with the current effective runtime snapshot", () => {
    const visible = candidate({ name: "visible" });
    const explicit = candidate({ name: "manual", explicitOnly: true });
    const diagnostic: CatalogSkillDiagnostic = {
      code: "pi_warning",
      level: "warning",
      message: "warning",
      path: visible.canonicalPath
    };
    const current = snapshot([
      { ...visible, diagnostics: [diagnostic] },
      explicit,
      candidate({ name: "off", status: "disabled" })
    ]);

    const plan = prepareSkillTurn(current, []);

    expect(plan.selections).toEqual([]);
    expect(plan.blocks).toEqual([]);
    expect(plan.runtime.effectiveRevision).toBe("effective-1");
    expect(plan.runtime.loadResult.skills.map((skill) => skill.name)).toEqual([
      "visible",
      "manual"
    ]);
    expect(plan.runtime.loadResult.diagnostics).toEqual([
      { type: "warning", message: "warning", path: visible.canonicalPath }
    ] satisfies ResourceDiagnostic[]);
  });

  it("keeps canonical selection order and deduplicates by first path before validation", () => {
    const a = candidate({ name: "a" });
    const b = candidate({ name: "b" });
    const plan = prepareSkillTurn(snapshot([a, b]), [selection(b), selection(a), selection(b)]);

    expect(plan.selections).toEqual([selection(b), selection(a)]);
    expect(plan.blocks[0]).toContain('name="b"');
    expect(plan.blocks[1]).toContain('name="a"');

    expect(() =>
      prepareSkillTurn(snapshot([a]), [{ name: "wrong", path: a.canonicalPath }, selection(a)])
    ).toThrowError(
      expect.objectContaining({
        invalidSelections: [{ name: "wrong", path: a.canonicalPath, reason: "name_mismatch" }]
      })
    );
  });

  it("reports every invalid reason without name or stale-path rebinding", () => {
    const disabled = candidate({ name: "same", status: "disabled" });
    const successor = candidate({
      name: "same",
      canonicalPath: "/tmp/successor/SKILL.md",
      status: "effective"
    });
    const invalid = invalidCandidate({ canonicalPath: "/tmp/invalid/SKILL.md" });
    const shadowed = candidate({ name: "shadowed", status: "shadowed" });
    const tooLarge = candidate({
      name: "large",
      explicitEligible: false,
      rawContent: null,
      diagnostics: [{ code: "too_large", level: "warning", message: "large" }]
    });
    const unsupported = candidate({
      name: "unsupported",
      explicitEligible: false,
      rawContent: null,
      diagnostics: [{ code: "unsupported_identifier", level: "error", message: "unsupported" }]
    });

    try {
      prepareSkillTurn(snapshot([disabled, successor, invalid, shadowed, tooLarge, unsupported]), [
        { name: "missing", path: "/tmp/missing/SKILL.md" },
        selection(disabled),
        { name: "invalid", path: invalid.canonicalPath },
        selection(shadowed),
        { name: "wrong", path: successor.canonicalPath },
        selection(tooLarge),
        selection(unsupported)
      ]);
      throw new Error("expected precondition failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillPreconditionError);
      expect((error as SkillPreconditionError).invalidSelections).toEqual([
        { name: "missing", path: "/tmp/missing/SKILL.md", reason: "missing" },
        { ...selection(disabled), reason: "disabled" },
        { name: "invalid", path: invalid.canonicalPath, reason: "invalid" },
        { ...selection(shadowed), reason: "shadowed" },
        { name: "wrong", path: successor.canonicalPath, reason: "name_mismatch" },
        { ...selection(tooLarge), reason: "too_large" },
        { ...selection(unsupported), reason: "unsupported_identifier" }
      ]);
    }
  });

  it("allows explicit-only effective skills and builds blocks from snapshot rawContent", () => {
    const explicit = candidate({
      name: "manual",
      explicitOnly: true,
      rawContent: "---\r\nname: manual\r\ndescription: Manual\r\n---\r\nPinned body"
    });

    const plan = prepareSkillTurn(snapshot([explicit]), [selection(explicit)]);

    expect(plan.blocks).toEqual([
      '<skill name="manual" location="/tmp/manual/SKILL.md">\n' +
        "References are relative to /tmp/manual.\n\nPinned body\n</skill>"
    ]);
    expect(plan.runtime.loadResult.skills[0]?.disableModelInvocation).toBe(true);
  });

  it("escapes all XML 1.0 attribute entities and text entities", () => {
    const special = candidate({
      name: `a&"<>'b`,
      canonicalPath: `/tmp/a&"<>'b/SKILL.md`,
      canonicalBaseDir: `/tmp/a&"<>'b`,
      rawContent: "Body & <tag> >"
    });

    const plan = prepareSkillTurn(snapshot([special]), [selection(special)]);

    expect(plan.blocks.join("\n\n")).toBe(
      '<skill name="a&amp;&quot;&lt;&gt;&apos;b" location="/tmp/a&amp;&quot;&lt;&gt;&apos;b/SKILL.md">\n' +
        "References are relative to /tmp/a&amp;\"&lt;&gt;'b.\n\nBody &amp; &lt;tag&gt; &gt;\n</skill>"
    );
  });

  it("fails closed on XML controls in identifiers or body text", () => {
    const badPath = candidate({ name: "path", canonicalPath: "/tmp/bad\u0001/SKILL.md" });
    const badBody = candidate({ name: "body", rawContent: "Body\u0001" });

    for (const item of [badPath, badBody]) {
      expect(() => prepareSkillTurn(snapshot([item]), [selection(item)])).toThrowError(
        expect.objectContaining({
          invalidSelections: [{ ...selection(item), reason: "unsupported_identifier" }]
        })
      );
    }
  });

  it("accepts 16 canonical selections and rejects 17 before building a payload", () => {
    const candidates = Array.from({ length: 17 }, (_, index) =>
      candidate({ name: `skill-${index}` })
    );

    expect(
      prepareSkillTurn(snapshot(candidates), candidates.slice(0, 16).map(selection)).blocks
    ).toHaveLength(16);
    expect(() => prepareSkillTurn(snapshot(candidates), candidates.map(selection))).toThrowError(
      SkillPayloadTooLargeError
    );
    expect(() =>
      prepareSkillTurn(snapshot([candidates[0]!]), Array(17).fill(selection(candidates[0]!)))
    ).toThrowError(SkillPayloadTooLargeError);
  });

  it("allows 16 KiB selection fields and rejects larger UTF-8 name or path fields", () => {
    const fieldLimit = 16 * 1024;
    const exactName = "n".repeat(fieldLimit);
    const exact = candidate({ name: exactName, canonicalPath: "/tmp/exact/SKILL.md" });

    expect(prepareSkillTurn(snapshot([exact]), [selection(exact)]).blocks).toHaveLength(1);

    for (const oversized of [
      candidate({ name: `${exactName}x`, canonicalPath: "/tmp/name/SKILL.md" }),
      candidate({ name: "path", canonicalPath: `/tmp/${"p".repeat(fieldLimit)}é` })
    ]) {
      expect(() => prepareSkillTurn(snapshot([oversized]), [selection(oversized)])).toThrowError(
        SkillPayloadTooLargeError
      );
    }
  });

  it("enforces 512 KiB per block and 2 MiB across blocks using UTF-8 bytes", () => {
    const itemLimit = 512 * 1024;
    const totalLimit = 2 * 1024 * 1024;
    const location = "/tmp/bytes/SKILL.md";
    const baseBytes = blockBytes("bytes", location, "");
    const exact = candidate({
      name: "bytes",
      canonicalPath: location,
      rawContent: "x".repeat(itemLimit - baseBytes)
    });
    expect(blockBytes("bytes", location, exact.rawContent!)).toBe(itemLimit);
    expect(prepareSkillTurn(snapshot([exact]), [selection(exact)]).blocks).toHaveLength(1);

    const over = { ...exact, rawContent: `${exact.rawContent}é` };
    expect(() => prepareSkillTurn(snapshot([over]), [selection(over)])).toThrowError(
      SkillPayloadTooLargeError
    );

    const totalCandidates = Array.from({ length: 5 }, (_, index) => {
      const name = `total-${index}`;
      const itemPath = `/tmp/${name}/SKILL.md`;
      const target =
        index === 4 ? totalLimit - Math.floor(totalLimit / 5) * 4 + 1 : Math.floor(totalLimit / 5);
      return candidate({
        name,
        canonicalPath: itemPath,
        rawContent: "x".repeat(target - blockBytes(name, itemPath, ""))
      });
    });
    expect(() =>
      prepareSkillTurn(snapshot(totalCandidates), totalCandidates.map(selection))
    ).toThrowError(SkillPayloadTooLargeError);
  });
});

describe("stripPiFrontmatter", () => {
  it("matches Pi 0.75.5 newline normalization and frontmatter boundary behavior", () => {
    expect(stripPiFrontmatter("plain\rbody")).toBe("plain\nbody");
    expect(stripPiFrontmatter("---\r\nname: demo\r\n---\r\n\r\nBody\r\n")).toBe("Body");
    expect(stripPiFrontmatter("---\nname: demo\nBody")).toBe("---\nname: demo\nBody");
  });
});
