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
  PublicSkillCatalogSnapshot,
  SkillCandidate,
  SkillCatalogService,
  SkillCatalogSnapshot,
  SkillDiagnostic,
  SkillDiscoveryOptions,
  SkillStatus
} from "./types.js";

export type {
  PublicSkillCatalogSnapshot,
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

export class SkillCatalogBusyError extends Error {
  readonly code = "skill_catalog_busy";

  constructor() {
    super("Skill catalog build queue is full");
    this.name = "SkillCatalogBusyError";
  }
}

export type SkillCatalogDependencies = {
  homeDir: string;
  preferences: SkillPreferenceStore;
  discover?: (options: SkillDiscoveryOptions) => Promise<DiscoveredSkillFile[]>;
  loadCandidate?: (descriptor: DiscoveredSkillFile) => Promise<ParsedSkillCandidate>;
  canonicalizeWorkspaceRoot?: (workspaceRoot: string) => string;
  now?: () => number;
  /** Maximum idle workspace identities retained in memory. Global-only is pinned. */
  maxWorkspaceCacheEntries?: number;
  /** Maximum catalog builds running across all workspace identities. */
  maxConcurrentBuilds?: number;
  /** Maximum distinct catalog builds waiting for a service-wide build slot. */
  maxQueuedBuilds?: number;
  /** Maximum wait for a service-wide build slot before failing closed. */
  queueWaitTimeoutMs?: number;
};

type CatalogInput = {
  workspaceId: string | null;
  workspaceRoot: string | null;
};

type RefreshState = {
  generation: number;
  active: Promise<SkillCatalogSnapshot> | null;
  trailing: {
    input: CatalogInput;
    generation: number;
    promise: Promise<SkillCatalogSnapshot>;
    resolve(snapshot: SkillCatalogSnapshot): void;
    reject(error: unknown): void;
  } | null;
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

export function toPublicSkillCatalogSnapshot(
  snapshot: SkillCatalogSnapshot
): PublicSkillCatalogSnapshot {
  return {
    workspaceId: snapshot.workspaceId,
    catalogRevision: snapshot.catalogRevision,
    effectiveRevision: snapshot.effectiveRevision,
    refreshedAt: snapshot.refreshedAt,
    candidates: snapshot.candidates.map((candidate) => ({
      name: candidate.skill?.name ?? null,
      description: candidate.skill?.description ?? null,
      discoveredPath: candidate.discoveredPath,
      canonicalPath: candidate.canonicalPath,
      source: candidate.source,
      scope: candidate.scope,
      status: candidate.status,
      enabled: candidate.enabled,
      effective: candidate.effective,
      explicitOnly: candidate.explicitOnly,
      explicitEligible: candidate.explicitEligible,
      diagnostics: candidate.diagnostics.map(cloneDiagnostic),
      shadowedBy: candidate.shadowedBy,
      bytesTotal: candidate.bytesTotal
    })),
    diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
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

function collisionDiagnostic(name: string, winnerPath: string, loserPath: string): SkillDiagnostic {
  return {
    code: "pi_collision",
    level: "warning",
    message: `name "${name}" collision`,
    path: loserPath,
    collision: {
      resourceType: "skill",
      name,
      winnerPath,
      loserPath
    }
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
      candidates.push(
        publishCandidate(
          {
            ...candidate,
            diagnostics: [
              ...candidate.diagnostics,
              collisionDiagnostic(
                candidate.skill.name,
                winner.canonicalPath,
                candidate.canonicalPath
              )
            ]
          },
          enabled,
          "shadowed",
          winner.canonicalPath
        )
      );
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
    path: diagnostic.path ?? null,
    collision: diagnostic.collision
      ? {
          resourceType: diagnostic.collision.resourceType,
          name: diagnostic.collision.name,
          winnerPath: diagnostic.collision.winnerPath,
          loserPath: diagnostic.collision.loserPath,
          winnerSource: diagnostic.collision.winnerSource ?? null,
          loserSource: diagnostic.collision.loserSource ?? null
        }
      : null
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
  const maxWorkspaceCacheEntries = Math.max(1, dependencies.maxWorkspaceCacheEntries ?? 20);
  const maxConcurrentBuilds = Math.max(1, Math.floor(dependencies.maxConcurrentBuilds ?? 2));
  const maxQueuedBuilds = Math.max(0, Math.floor(dependencies.maxQueuedBuilds ?? 20));
  const queueWaitTimeoutMs = Math.max(1, Math.floor(dependencies.queueWaitTimeoutMs ?? 30_000));
  const snapshots = new Map<string, SkillCatalogSnapshot>();
  const refreshStates = new Map<string, RefreshState>();
  let activeBuilds = 0;
  const buildWaiters: Array<{ resolve(): void; timer: ReturnType<typeof setTimeout> }> = [];

  async function withBuildSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (activeBuilds >= maxConcurrentBuilds) {
      if (buildWaiters.length >= maxQueuedBuilds) throw new SkillCatalogBusyError();
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve: () => {
            clearTimeout(waiter.timer);
            resolve();
          },
          timer: undefined as unknown as ReturnType<typeof setTimeout>
        };
        waiter.timer = setTimeout(() => {
          const index = buildWaiters.indexOf(waiter);
          if (index < 0) return;
          buildWaiters.splice(index, 1);
          reject(new SkillCatalogBusyError());
        }, queueWaitTimeoutMs);
        waiter.timer.unref?.();
        buildWaiters.push(waiter);
      });
    } else {
      activeBuilds += 1;
    }
    try {
      return await operation();
    } finally {
      const next = buildWaiters.shift();
      if (next) {
        // Transfer this slot directly so a new caller cannot overtake the waiter.
        next.resolve();
      } else {
        activeBuilds -= 1;
      }
    }
  }

  function touchCacheKey(key: string) {
    const state = refreshStates.get(key);
    if (state) {
      refreshStates.delete(key);
      refreshStates.set(key, state);
    }
    const snapshot = snapshots.get(key);
    if (snapshot) {
      snapshots.delete(key);
      snapshots.set(key, snapshot);
    }
  }

  function publishSnapshot(key: string, snapshot: SkillCatalogSnapshot) {
    snapshots.delete(key);
    snapshots.set(key, snapshot);
  }

  function evictIdleWorkspaceCaches() {
    let workspaceCount = [...refreshStates.keys()].filter((key) => key !== GLOBAL_CACHE_KEY).length;
    while (workspaceCount > maxWorkspaceCacheEntries) {
      const oldestIdleKey = [...refreshStates].find(
        ([key, state]) =>
          key !== GLOBAL_CACHE_KEY && state.active === null && state.trailing === null
      )?.[0];
      if (!oldestIdleKey) return;
      refreshStates.delete(oldestIdleKey);
      snapshots.delete(oldestIdleKey);
      workspaceCount -= 1;
    }
  }

  function normalizeInput(input: CatalogInput): CatalogInput {
    return input.workspaceRoot === null
      ? input
      : { ...input, workspaceRoot: canonicalizeWorkspaceRoot(input.workspaceRoot) };
  }

  function cacheKey(input: CatalogInput): string {
    return input.workspaceRoot === null
      ? GLOBAL_CACHE_KEY
      : `workspace:${JSON.stringify([input.workspaceId, input.workspaceRoot])}`;
  }

  async function build(input: CatalogInput): Promise<SkillCatalogSnapshot> {
    return withBuildSlot(async () => {
      const descriptors = await discover({
        workspaceRoot: input.workspaceRoot,
        homeDir: dependencies.homeDir
      });
      const parsedCandidates = await loadCandidates(descriptors, loadCandidate);
      const preferenceRows = dependencies.preferences.list();
      return buildSnapshot(input, parsedCandidates, preferenceRows, now());
    });
  }

  function startBuild(
    key: string,
    state: RefreshState,
    input: CatalogInput,
    generation: number
  ): Promise<SkillCatalogSnapshot> {
    const completed = build(input).then(
      (snapshot) => {
        state.latestSuccess = snapshot;
        if (generation === state.generation) publishSnapshot(key, snapshot);
        return snapshot;
      },
      (error) => {
        if (generation === state.generation && state.latestSuccess) {
          publishSnapshot(key, state.latestSuccess);
        }
        throw error;
      }
    );
    const finalized = completed.finally(() => {
      if (state.active === finalized) state.active = null;
      const trailing = state.trailing;
      state.trailing = null;
      if (trailing) {
        startBuild(key, state, trailing.input, trailing.generation).then(
          trailing.resolve,
          trailing.reject
        );
        return;
      }
      touchCacheKey(key);
      evictIdleWorkspaceCaches();
    });
    state.active = finalized;
    return finalized;
  }

  const catalog: SkillCatalogService = {
    refresh(input) {
      const normalizedInput = normalizeInput(input);
      const key = cacheKey(normalizedInput);
      const state = refreshStates.get(key) ?? {
        generation: 0,
        active: null,
        trailing: null,
        latestSuccess: null
      };
      if (!refreshStates.has(key)) refreshStates.set(key, state);
      touchCacheKey(key);
      if (!state.active) {
        const pending = startBuild(key, state, normalizedInput, ++state.generation);
        evictIdleWorkspaceCaches();
        return pending;
      }
      if (state.trailing) {
        state.trailing.input = normalizedInput;
        state.trailing.generation = ++state.generation;
        return state.trailing.promise;
      }

      let resolve!: (snapshot: SkillCatalogSnapshot) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<SkillCatalogSnapshot>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      state.trailing = {
        input: normalizedInput,
        generation: ++state.generation,
        promise,
        resolve,
        reject
      };
      return promise;
    },

    current(input) {
      const key = cacheKey(normalizeInput(input));
      const snapshot = snapshots.get(key) ?? null;
      if (snapshot) touchCacheKey(key);
      return snapshot;
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
