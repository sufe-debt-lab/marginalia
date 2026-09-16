import type { LoadSkillsResult, ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import { hasUnsupportedXmlChar } from "./candidate-loader.js";
import type { SkillCandidate, SkillCatalogSnapshot, SkillDiagnostic } from "./types.js";

/** Raw selections are capped before canonical-path deduplication. */
export const MAX_SKILL_SELECTIONS = 16;
/** Maximum UTF-8 bytes accepted for either selection identity field. */
export const MAX_SKILL_SELECTION_FIELD_BYTES = 16 * 1024;
const MAX_SKILL_TOTAL_BYTES = 2 * 1024 * 1024;

export type SkillSelection = { name: string; path: string };

export type InvalidSelectionReason =
  | "missing"
  | "disabled"
  | "invalid"
  | "shadowed"
  | "name_mismatch"
  | "too_large"
  | "unsupported_identifier";

export type InvalidSkillSelection = SkillSelection & {
  reason: InvalidSelectionReason;
  winnerPath?: string;
};

export type AgentRuntimeSkills = {
  effectiveRevision: string;
  loadResult: LoadSkillsResult;
  /** Frozen Skill bodies; their parent directories bound read-only resource access. */
  contents?: Readonly<Record<string, string>>;
};

export type PreparedSkillTurn = {
  selections: readonly SkillSelection[];
  blocks: readonly string[];
  runtime: AgentRuntimeSkills;
};

export class SkillPreconditionError extends Error {
  readonly code = "skill_precondition_failed";

  constructor(readonly invalidSelections: readonly InvalidSkillSelection[]) {
    super("One or more Skill selections are unavailable");
    this.name = "SkillPreconditionError";
  }
}

export class SkillPayloadTooLargeError extends Error {
  readonly code = "skill_payload_too_large";

  constructor() {
    super("Selected Skill payload is too large");
    this.name = "SkillPayloadTooLargeError";
  }
}

export function stripPiFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized;
  const endIndex = normalized.indexOf("\n---", 3);
  return endIndex === -1 ? normalized : normalized.slice(endIndex + 4).trim();
}

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;");
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toPiDiagnostic(diagnostic: SkillDiagnostic): ResourceDiagnostic {
  return {
    type: diagnostic.collision ? "collision" : diagnostic.level,
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    ...(diagnostic.collision
      ? {
          collision: {
            resourceType: diagnostic.collision.resourceType,
            name: diagnostic.collision.name,
            winnerPath: diagnostic.collision.winnerPath,
            loserPath: diagnostic.collision.loserPath,
            ...(diagnostic.collision.winnerSource === undefined
              ? {}
              : { winnerSource: diagnostic.collision.winnerSource }),
            ...(diagnostic.collision.loserSource === undefined
              ? {}
              : { loserSource: diagnostic.collision.loserSource })
          }
        }
      : {})
  };
}

function cloneSkill(skill: Skill): Skill {
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    sourceInfo: {
      path: skill.sourceInfo.path,
      source: skill.sourceInfo.source,
      scope: skill.sourceInfo.scope,
      origin: skill.sourceInfo.origin,
      ...(skill.sourceInfo.baseDir === undefined ? {} : { baseDir: skill.sourceInfo.baseDir })
    },
    disableModelInvocation: skill.disableModelInvocation
  };
}

function runtimeFromSnapshot(
  snapshot: SkillCatalogSnapshot,
  selected: readonly SkillCandidate[]
): AgentRuntimeSkills {
  const explicitPaths = selected
    .filter((candidate) => candidate.explicitOnly)
    .map((candidate) => candidate.canonicalPath)
    .sort();
  const selectedPaths = new Set(explicitPaths);
  return {
    effectiveRevision: explicitPaths.length
      ? `${snapshot.effectiveRevision}:${JSON.stringify(explicitPaths)}`
      : snapshot.effectiveRevision,
    contents: Object.freeze(
      Object.fromEntries(
        snapshot.candidates
          .filter(
            (candidate) =>
              candidate.effective &&
              (!candidate.explicitOnly || selectedPaths.has(candidate.canonicalPath)) &&
              candidate.rawContent !== null
          )
          .map((candidate) => [candidate.canonicalPath, candidate.rawContent!])
      )
    ),
    loadResult: {
      skills: snapshot.effectiveSkills.map(cloneSkill),
      diagnostics: snapshot.diagnostics.map(toPiDiagnostic)
    }
  };
}

function deduplicateByPath(selections: readonly SkillSelection[]): SkillSelection[] {
  const paths = new Set<string>();
  const result: SkillSelection[] = [];
  for (const selection of selections) {
    if (paths.has(selection.path)) continue;
    paths.add(selection.path);
    result.push({ name: selection.name, path: selection.path });
  }
  return result;
}

function ineligibleReason(candidate: SkillCandidate): InvalidSelectionReason {
  if (candidate.diagnostics.some((diagnostic) => diagnostic.code === "too_large")) {
    return "too_large";
  }
  return "unsupported_identifier";
}

function validateSelection(
  snapshot: SkillCatalogSnapshot,
  selection: SkillSelection
): { candidate: SkillCandidate } | { invalid: InvalidSkillSelection } {
  const candidate = snapshot.candidates.find((item) => item.canonicalPath === selection.path);
  if (!candidate) return { invalid: { ...selection, reason: "missing" } };
  if (candidate.status === "disabled") {
    return { invalid: { ...selection, reason: "disabled" } };
  }
  if (candidate.status === "invalid" || !candidate.skill) {
    return { invalid: { ...selection, reason: "invalid" } };
  }
  if (candidate.status === "shadowed") {
    return {
      invalid: { ...selection, reason: "shadowed", winnerPath: candidate.shadowedBy! }
    };
  }
  if (candidate.skill.name !== selection.name) {
    return { invalid: { ...selection, reason: "name_mismatch" } };
  }
  if (!candidate.explicitEligible || candidate.rawContent === null) {
    return { invalid: { ...selection, reason: ineligibleReason(candidate) } };
  }

  const body = stripPiFrontmatter(candidate.rawContent);
  if (
    [selection.name, selection.path, candidate.canonicalBaseDir].some(
      (value) => hasUnsupportedXmlChar(value) || /[\r\n]/.test(value)
    ) ||
    hasUnsupportedXmlChar(body)
  ) {
    return { invalid: { ...selection, reason: "unsupported_identifier" } };
  }
  return { candidate };
}

function buildSkillBlock(candidate: SkillCandidate): string {
  const skill = candidate.skill!;
  const body = stripPiFrontmatter(candidate.rawContent!);
  return (
    `<skill name="${escapeXmlAttribute(skill.name)}" location="${escapeXmlAttribute(candidate.canonicalPath)}">\n` +
    `References are relative to ${escapeXmlText(candidate.canonicalBaseDir)}.\n\n` +
    `${body}\n</skill>`
  );
}

export function prepareSkillTurn(
  snapshot: SkillCatalogSnapshot,
  selections: readonly SkillSelection[]
): PreparedSkillTurn {
  if (
    selections.length > MAX_SKILL_SELECTIONS ||
    selections.some(
      (selection) =>
        Buffer.byteLength(selection.name, "utf8") > MAX_SKILL_SELECTION_FIELD_BYTES ||
        Buffer.byteLength(selection.path, "utf8") > MAX_SKILL_SELECTION_FIELD_BYTES
    )
  ) {
    throw new SkillPayloadTooLargeError();
  }
  const canonicalSelections = deduplicateByPath(selections);

  const candidates: SkillCandidate[] = [];
  const invalidSelections: InvalidSkillSelection[] = [];
  for (const selection of canonicalSelections) {
    const result = validateSelection(snapshot, selection);
    if ("invalid" in result) invalidSelections.push(result.invalid);
    else candidates.push(result.candidate);
  }
  if (invalidSelections.length > 0) {
    throw new SkillPreconditionError(invalidSelections);
  }

  const blocks = candidates.map(buildSkillBlock);
  if (Buffer.byteLength(blocks.join("\n\n"), "utf8") > MAX_SKILL_TOTAL_BYTES) {
    throw new SkillPayloadTooLargeError();
  }

  return {
    selections: canonicalSelections,
    blocks,
    runtime: runtimeFromSnapshot(snapshot, candidates)
  };
}
