import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  loadSkills,
  type LoadSkillsResult,
  type ResourceDiagnostic
} from "@earendil-works/pi-coding-agent";
import {
  SKILL_EXPLICIT_BYTES,
  SKILL_PREVIEW_BYTES,
  type DiscoveredSkillFile,
  type ParsedSkillCandidate,
  type SkillDiagnostic
} from "./types.js";

export { SKILL_EXPLICIT_BYTES, SKILL_PREVIEW_BYTES } from "./types.js";
export type { ParsedSkillCandidate } from "./types.js";

export type CandidateLoaderDeps = {
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  parse(path: string): LoadSkillsResult;
};

const MAX_STABLE_READ_ATTEMPTS = 3;

const defaultDeps: CandidateLoaderDeps = {
  realpath: (filePath) => fs.realpath(filePath),
  readFile: (filePath) => fs.readFile(filePath),
  parse: (filePath) =>
    loadSkills({
      cwd: path.dirname(filePath),
      agentDir: path.dirname(filePath),
      skillPaths: [filePath],
      includeDefaults: false
    })
};

function hash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function piDiagnostic(diagnostic: ResourceDiagnostic): SkillDiagnostic {
  return {
    code: `pi_${diagnostic.type}`,
    level: diagnostic.type === "error" ? "error" : "warning",
    message: diagnostic.message,
    ...(diagnostic.path ? { path: diagnostic.path } : {})
  };
}

function decodeUtf8WithinByteBudget(
  input: Buffer,
  byteBudget: number
): { content: string; truncated: boolean } {
  const decoded = input.toString("utf8");
  if (Buffer.byteLength(decoded, "utf8") <= byteBudget) {
    return { content: decoded, truncated: false };
  }

  const prefix: string[] = [];
  let bytesUsed = 0;
  for (const char of decoded) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytesUsed + charBytes > byteBudget) {
      return { content: prefix.join(""), truncated: true };
    }
    prefix.push(char);
    bytesUsed += charBytes;
  }

  return { content: prefix.join(""), truncated: false };
}

function failureCandidate(
  descriptor: DiscoveredSkillFile,
  code: string,
  message: string,
  canonicalPath = descriptor.discoveredPath
): ParsedSkillCandidate {
  return {
    ...descriptor,
    canonicalPath,
    canonicalBaseDir: path.dirname(canonicalPath),
    skill: null,
    diagnostics: [{ code, level: "error", message, path: canonicalPath }],
    bytesTotal: 0,
    contentHash: "",
    explicitEligible: false,
    explicitOnly: false,
    rawContent: null,
    previewContent: "",
    previewTruncated: false
  };
}

function parsedCandidate(
  descriptor: DiscoveredSkillFile,
  canonicalPath: string,
  content: Buffer,
  parsed: LoadSkillsResult
): ParsedSkillCandidate {
  const parsedSkill = parsed.skills[0] ?? null;
  const canonicalBaseDir = path.dirname(canonicalPath);
  const diagnostics = parsed.diagnostics.map(piDiagnostic);
  const tooLarge = content.byteLength > SKILL_EXPLICIT_BYTES;
  const unsupportedIdentifier = Boolean(
    parsedSkill && [parsedSkill.name, canonicalPath, canonicalBaseDir].some(hasUnsupportedXmlChar)
  );

  if (tooLarge) {
    diagnostics.push({
      code: "too_large",
      level: "warning",
      message: `Skill content exceeds ${SKILL_EXPLICIT_BYTES} bytes`,
      path: canonicalPath
    });
  }
  if (unsupportedIdentifier) {
    diagnostics.push({
      code: "unsupported_identifier",
      level: "error",
      message: "Skill identifier contains a character unsupported by XML 1.0",
      path: canonicalPath
    });
  }

  const explicitEligible = parsedSkill !== null && !tooLarge && !unsupportedIdentifier;
  const preview = decodeUtf8WithinByteBudget(content, SKILL_PREVIEW_BYTES);
  const rawContent = explicitEligible
    ? decodeUtf8WithinByteBudget(content, SKILL_EXPLICIT_BYTES).content
    : null;
  return {
    ...descriptor,
    canonicalPath,
    canonicalBaseDir,
    skill: parsedSkill,
    diagnostics,
    bytesTotal: content.byteLength,
    contentHash: hash(content),
    explicitEligible,
    explicitOnly: parsedSkill?.disableModelInvocation ?? false,
    rawContent,
    previewContent: preview.content,
    previewTruncated: preview.truncated
  };
}

export function hasUnsupportedXmlChar(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) continue;
    if (codePoint >= 0x20 && codePoint <= 0xd7ff) continue;
    if (codePoint >= 0xe000 && codePoint <= 0xfffd) continue;
    if (codePoint >= 0x10000 && codePoint <= 0x10ffff) continue;
    return true;
  }
  return false;
}

export async function loadSkillCandidate(
  descriptor: DiscoveredSkillFile,
  deps: CandidateLoaderDeps = defaultDeps
): Promise<ParsedSkillCandidate> {
  let lastCanonicalPath = descriptor.discoveredPath;

  for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt += 1) {
    let canonicalPathA: string;
    try {
      canonicalPathA = await deps.realpath(descriptor.discoveredPath);
      lastCanonicalPath = canonicalPathA;
    } catch (error) {
      return failureCandidate(
        descriptor,
        "realpath_failed",
        `Failed to resolve Skill path: ${errorMessage(error)}`
      );
    }

    let contentA: Buffer;
    try {
      contentA = await deps.readFile(canonicalPathA);
    } catch (error) {
      return failureCandidate(
        descriptor,
        "read_failed",
        `Failed to read Skill file: ${errorMessage(error)}`,
        canonicalPathA
      );
    }

    let parsed: LoadSkillsResult;
    try {
      parsed = deps.parse(canonicalPathA);
    } catch (error) {
      return failureCandidate(
        descriptor,
        "parse_failed",
        `Failed to parse Skill file: ${errorMessage(error)}`,
        canonicalPathA
      );
    }

    let canonicalPathB: string;
    try {
      canonicalPathB = await deps.realpath(descriptor.discoveredPath);
      lastCanonicalPath = canonicalPathB;
    } catch (error) {
      return failureCandidate(
        descriptor,
        "realpath_failed",
        `Failed to resolve Skill path: ${errorMessage(error)}`,
        canonicalPathA
      );
    }

    let contentB: Buffer;
    try {
      contentB = await deps.readFile(canonicalPathB);
    } catch (error) {
      return failureCandidate(
        descriptor,
        "read_failed",
        `Failed to read Skill file: ${errorMessage(error)}`,
        canonicalPathB
      );
    }

    if (canonicalPathA === canonicalPathB && hash(contentA) === hash(contentB)) {
      return parsedCandidate(descriptor, canonicalPathB, contentB, parsed);
    }
  }

  return failureCandidate(
    descriptor,
    "unstable_file",
    `Skill file did not stabilize after ${MAX_STABLE_READ_ATTEMPTS} attempts`,
    lastCanonicalPath
  );
}
