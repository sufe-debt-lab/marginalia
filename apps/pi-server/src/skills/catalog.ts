import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import type { SkillPreference, SkillPreferenceStore } from "../db/skill-preferences.js";
import { loadSkillCandidate } from "./candidate-loader.js";
import { discoverSkillFiles } from "./discovery.js";
import type {
  DiscoveredSkillFile,
  ParsedSkillCandidate,
  SkillCandidate,
  SkillCatalogService,
  SkillCatalogSnapshot,
  SkillDiagnostic,
  SkillDiscoveryOptions,
  SkillStatus
} from "./types.js";

export type {
  SkillCandidate,
  SkillCatalogService,
  SkillCatalogSnapshot,
  SkillStatus
} from "./types.js";

export class SkillCandidateNotFoundError extends Error {
  readonly code = "skill_candidate_not_found";

  constructor() {
    super("Skill candidate not found");
    this.name = "SkillCandidateNotFoundError";
  }
}

export type SkillCatalogDependencies = {
  homeDir: string;
  preferences: SkillPreferenceStore;
  discover?: (options: SkillDiscoveryOptions) => Promise<DiscoveredSkillFile[]>;
  loadCandidate?: (descriptor: DiscoveredSkillFile) => Promise<ParsedSkillCandidate>;
  canonicalizeWorkspaceRoot?: (workspaceRoot: string) => string;
  now?: () => number;
};

type CatalogInput = {
  workspaceId: string | null;
  workspaceRoot: string | null;
};

type RefreshState = {
  generation: number;
  chain: Promise<void>;
  latestSuccess: SkillCatalogSnapshot | null;
};

const GLOBAL_CACHE_KEY = "global";
const CANDIDATE_LOAD_CONCURRENCY = 4;

function defaultCanonicalizeWorkspaceRoot(workspaceRoot: string): string {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return path.resolve(workspaceRoot);
  }
}

function cloneDiagnostic(diagnostic: SkillDiagnostic): SkillDiagnostic {
  return {
    code: diagnostic.code,
    level: diagnostic.level,
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path })
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

function cloneParsedCandidate(candidate: ParsedSkillCandidate): ParsedSkillCandidate {
  return {
    discoveredPath: candidate.discoveredPath,
    sourceRoot: candidate.sourceRoot,
    relativePath: candidate.relativePath,
    source: candidate.source,
    scope: candidate.scope,
    mode: candidate.mode,
    sourcePriority: candidate.sourcePriority,
    ancestorDepth: candidate.ancestorDepth,
    canonicalPath: candidate.canonicalPath,
    canonicalBaseDir: candidate.canonicalBaseDir,
    skill: candidate.skill ? cloneSkill(candidate.skill) : null,
    diagnostics: candidate.diagnostics.map(cloneDiagnostic),
    bytesTotal: candidate.bytesTotal,
    contentHash: candidate.contentHash,
    explicitEligible: candidate.explicitEligible,
    explicitOnly: candidate.explicitOnly,
    rawContent: candidate.rawContent,
    previewContent: candidate.previewContent,
    previewTruncated: candidate.previewTruncated
  };
}

function publishCandidate(
  candidate: ParsedSkillCandidate,
  enabled: boolean,
  status: SkillStatus,
  shadowedBy: string | null = null
): SkillCandidate {
  return {
    ...candidate,
    enabled,
    effective: status === "effective",
    status,
    shadowedBy
  };
}

function reduceCandidates(
  parsedCandidates: readonly ParsedSkillCandidate[],
  preferenceRows: readonly SkillPreference[]
): SkillCandidate[] {
  const firstByCanonicalPath = new Map<string, ParsedSkillCandidate>();
  for (const candidate of parsedCandidates) {
    if (!firstByCanonicalPath.has(candidate.canonicalPath)) {
      firstByCanonicalPath.set(candidate.canonicalPath, candidate);
    }
  }

  const enabledByCanonicalPath = new Map(
    preferenceRows.map((preference) => [preference.skillPath, preference.enabled])
  );
  const winnerByName = new Map<string, SkillCandidate>();
  const candidates: SkillCandidate[] = [];

  for (const input of firstByCanonicalPath.values()) {
    const candidate = cloneParsedCandidate(input);
    const enabled = enabledByCanonicalPath.get(candidate.canonicalPath) ?? true;
    if (!candidate.skill) {
      candidates.push(publishCandidate(candidate, enabled, "invalid"));
      continue;
    }
    if (!enabled) {
      candidates.push(publishCandidate(candidate, enabled, "disabled"));
      continue;
    }
    const winner = winnerByName.get(candidate.skill.name);
    if (winner) {
      candidates.push(publishCandidate(candidate, enabled, "shadowed", winner.canonicalPath));
      continue;
    }
    const published = publishCandidate(candidate, enabled, "effective");
    winnerByName.set(candidate.skill.name, published);
    candidates.push(published);
  }

  return candidates;
}

function diagnosticProjection(diagnostic: SkillDiagnostic) {
  return {
    code: diagnostic.code,
    level: diagnostic.level,
    message: diagnostic.message,
    path: diagnostic.path ?? null
  };
}

function skillProjection(skill: Skill | null) {
  if (!skill) return null;
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
      baseDir: skill.sourceInfo.baseDir ?? null
    },
    disableModelInvocation: skill.disableModelInvocation
  };
}

function catalogProjection(input: CatalogInput, candidates: readonly SkillCandidate[]) {
  return {
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    candidates: candidates.map((candidate) => ({
      discoveredPath: candidate.discoveredPath,
      sourceRoot: candidate.sourceRoot,
      relativePath: candidate.relativePath,
      source: candidate.source,
      scope: candidate.scope,
      mode: candidate.mode,
      sourcePriority: candidate.sourcePriority,
      ancestorDepth: candidate.ancestorDepth,
      canonicalPath: candidate.canonicalPath,
      canonicalBaseDir: candidate.canonicalBaseDir,
      skill: skillProjection(candidate.skill),
      diagnostics: candidate.diagnostics.map(diagnosticProjection),
      bytesTotal: candidate.bytesTotal,
      contentHash: candidate.contentHash,
      explicitEligible: candidate.explicitEligible,
      explicitOnly: candidate.explicitOnly,
      previewContent: candidate.previewContent,
      previewTruncated: candidate.previewTruncated,
      enabled: candidate.enabled,
      effective: candidate.effective,
      status: candidate.status,
      shadowedBy: candidate.shadowedBy
    }))
  };
}

function effectiveProjection(candidates: readonly SkillCandidate[]) {
  return candidates
    .filter((candidate) => candidate.effective && candidate.skill)
    .map((candidate) => ({
      canonicalPath: candidate.canonicalPath,
      contentHash: candidate.contentHash,
      skill: skillProjection(candidate.skill)
    }));
}

function revision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function buildSnapshot(
  input: CatalogInput,
  parsedCandidates: readonly ParsedSkillCandidate[],
  preferenceRows: readonly SkillPreference[],
  refreshedAt: number
): SkillCatalogSnapshot {
  const candidates = reduceCandidates(parsedCandidates, preferenceRows);
  const effectiveSkills = candidates.flatMap((candidate) =>
    candidate.effective && candidate.skill ? [candidate.skill] : []
  );
  const diagnostics = candidates.flatMap((candidate) => candidate.diagnostics);
  return deepFreeze({
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
    catalogRevision: revision(catalogProjection(input, candidates)),
    effectiveRevision: revision(effectiveProjection(candidates)),
    refreshedAt,
    candidates,
    effectiveSkills,
    diagnostics
  });
}

async function loadCandidates(
  descriptors: readonly DiscoveredSkillFile[],
  loadCandidate: (descriptor: DiscoveredSkillFile) => Promise<ParsedSkillCandidate>
): Promise<ParsedSkillCandidate[]> {
  const candidates = new Array<ParsedSkillCandidate>(descriptors.length);
  let nextIndex = 0;
  const failures: unknown[] = [];

  async function worker(): Promise<void> {
    while (failures.length === 0) {
      const index = nextIndex;
      nextIndex += 1;
      const descriptor = descriptors[index];
      if (!descriptor) return;
      try {
        candidates[index] = await loadCandidate(descriptor);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CANDIDATE_LOAD_CONCURRENCY, descriptors.length) }, () => worker())
  );
  if (failures.length > 0) throw failures[0];
  return candidates;
}

export function createSkillCatalogService(
  dependencies: SkillCatalogDependencies
): SkillCatalogService {
  const discover = dependencies.discover ?? discoverSkillFiles;
  const loadCandidate = dependencies.loadCandidate ?? loadSkillCandidate;
  const canonicalizeWorkspaceRoot =
    dependencies.canonicalizeWorkspaceRoot ?? defaultCanonicalizeWorkspaceRoot;
  const now = dependencies.now ?? Date.now;
  const snapshots = new Map<string, SkillCatalogSnapshot>();
  const refreshStates = new Map<string, RefreshState>();

  function normalizeInput(input: CatalogInput): CatalogInput {
    return input.workspaceRoot === null
      ? input
      : { ...input, workspaceRoot: canonicalizeWorkspaceRoot(input.workspaceRoot) };
  }

  function cacheKey(input: CatalogInput): string {
    return input.workspaceRoot === null ? GLOBAL_CACHE_KEY : `workspace:${input.workspaceRoot}`;
  }

  async function build(input: CatalogInput): Promise<SkillCatalogSnapshot> {
    const descriptors = await discover({
      workspaceRoot: input.workspaceRoot,
      homeDir: dependencies.homeDir
    });
    const parsedCandidates = await loadCandidates(descriptors, loadCandidate);
    const preferenceRows = dependencies.preferences.list();
    return buildSnapshot(input, parsedCandidates, preferenceRows, now());
  }

  const catalog: SkillCatalogService = {
    refresh(input) {
      const normalizedInput = normalizeInput(input);
      const key = cacheKey(normalizedInput);
      const state = refreshStates.get(key) ?? {
        generation: 0,
        chain: Promise.resolve(),
        latestSuccess: null
      };
      refreshStates.set(key, state);
      const generation = ++state.generation;
      const pending = state.chain.then(() => build(normalizedInput));
      state.chain = pending.then(
        (snapshot) => {
          state.latestSuccess = snapshot;
          if (generation === state.generation) {
            snapshots.set(key, snapshot);
          }
        },
        () => {
          if (generation === state.generation && state.latestSuccess) {
            snapshots.set(key, state.latestSuccess);
          }
        }
      );
      return pending;
    },

    current(input) {
      return snapshots.get(cacheKey(normalizeInput(input))) ?? null;
    },

    async setEnabled(input) {
      const snapshot = await catalog.refresh(input);
      const candidate = snapshot.candidates.find((item) => item.canonicalPath === input.path);
      if (!candidate) {
        throw new SkillCandidateNotFoundError();
      }
      dependencies.preferences.setEnabled(candidate.canonicalPath, input.enabled);
      return catalog.refresh(input);
    }
  };

  return catalog;
}
