import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import { createTestApp as createApp } from "./test-app.js";
import { migrate } from "../src/db/migrations.js";
import { createWorkspace } from "../src/db/repositories.js";
import { SkillCandidateNotFoundError } from "../src/skills/catalog.js";
import type {
  SkillCandidate,
  SkillCatalogService,
  SkillCatalogSnapshot
} from "../src/skills/types.js";

const dbs: Database.Database[] = [];
const loopbackAccess = {
  bearer: "secret",
  allowedOrigins: new Set(["null", "http://127.0.0.1:5173"])
};
const authorizedHeaders = {
  authorization: "Bearer secret",
  origin: "http://127.0.0.1:5173"
};

function candidate(canonicalPath: string, overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    discoveredPath: `/discovered${canonicalPath}`,
    sourceRoot: "/internal/source-root",
    relativePath: "demo/SKILL.md",
    source: "user_marginalia",
    scope: "user",
    mode: "pi",
    sourcePriority: 4,
    ancestorDepth: 0,
    canonicalPath,
    canonicalBaseDir: "/canonical/demo",
    skill: {
      name: "demo",
      description: "Demo skill",
      filePath: canonicalPath,
      baseDir: "/canonical/demo",
      sourceInfo: {
        path: canonicalPath,
        source: "path",
        scope: "temporary",
        origin: "top-level",
        baseDir: "/canonical/demo"
      },
      disableModelInvocation: false
    },
    diagnostics: [
      {
        code: "demo_warning",
        level: "warning",
        message: "Demo warning",
        path: canonicalPath
      }
    ],
    bytesTotal: 42,
    contentHash: "private-content-hash",
    explicitEligible: true,
    explicitOnly: false,
    rawContent: "private rawContent and internal bytes",
    previewContent: "# Demo\nPreview",
    previewTruncated: false,
    enabled: true,
    effective: true,
    status: "effective",
    shadowedBy: null,
    ...overrides
  };
}

function snapshot(
  candidates: readonly SkillCandidate[],
  overrides: Partial<SkillCatalogSnapshot> = {}
): SkillCatalogSnapshot {
  return {
    workspaceId: null,
    workspaceRoot: null,
    catalogRevision: "catalog-1",
    effectiveRevision: "effective-1",
    refreshedAt: 1_000,
    candidates,
    effectiveSkills: candidates.flatMap((item) =>
      item.effective && item.skill ? [item.skill] : []
    ),
    diagnostics: candidates.flatMap((item) => item.diagnostics),
    ...overrides
  };
}

function fakeCatalog(initial: SkillCatalogSnapshot): SkillCatalogService {
  return {
    refresh: vi.fn(async () => initial),
    current: vi.fn(() => initial),
    setEnabled: vi.fn(async () => initial)
  };
}

function setup(initial = snapshot([candidate("/canonical/demo/SKILL.md")])) {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const catalog = fakeCatalog(initial);
  const app = createApp({
    db,
    agentClient: new FakeAgentClient(),
    loopbackAccess,
    skillCatalog: catalog
  });
  return { app, catalog, db };
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

describe("Skills loopback access", () => {
  const requests = [
    {
      name: "snapshot",
      path: "/skills",
      init: { headers: { origin: "http://127.0.0.1:5173" } }
    },
    {
      name: "content",
      path: "/skills/content?path=%2Fcanonical%2Fdemo%2FSKILL.md",
      init: { headers: { origin: "http://127.0.0.1:5173" } }
    },
    {
      name: "state",
      path: "/skills/state",
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
        body: "{"
      }
    }
  ] as const;

  it.each(requests)(
    "rejects a missing token before reading $name input",
    async ({ path, init }) => {
      const { app, catalog } = setup();

      const response = await app.request(path, init);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
      expect(catalog.refresh).not.toHaveBeenCalled();
      expect(catalog.setEnabled).not.toHaveBeenCalled();
    }
  );

  it("rejects a wrong token", async () => {
    const { app, catalog } = setup();

    const response = await app.request("/skills", {
      headers: { authorization: "Bearer wrong", origin: "http://127.0.0.1:5173" }
    });

    expect(response.status).toBe(401);
    expect(catalog.refresh).not.toHaveBeenCalled();
  });

  it("rejects an untrusted Origin before catalog access", async () => {
    const { app, catalog } = setup();

    const response = await app.request("/skills?workspaceId=unknown", {
      headers: { ...authorizedHeaders, origin: "https://evil.example" }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "origin_forbidden" });
    expect(catalog.refresh).not.toHaveBeenCalled();
  });

  it.each(["null", "http://127.0.0.1:5173"])(
    "accepts bearer authorization from allowed Origin %s",
    async (origin) => {
      const { app } = setup();

      const response = await app.request("/skills", {
        headers: { ...authorizedHeaders, origin }
      });

      expect(response.status).toBe(200);
    }
  );
});

describe("GET /skills", () => {
  it("refreshes global-only discovery on every call and returns a whitelisted public DTO", async () => {
    const known = candidate("/canonical/demo/SKILL.md");
    const { app, catalog } = setup(snapshot([known]));

    const first = await app.request("/skills", { headers: authorizedHeaders });
    const second = await app.request("/skills", { headers: authorizedHeaders });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(catalog.refresh).toHaveBeenNthCalledWith(1, {
      workspaceId: null,
      workspaceRoot: null
    });
    expect(catalog.refresh).toHaveBeenNthCalledWith(2, {
      workspaceId: null,
      workspaceRoot: null
    });
    const body = await first.json();
    expect(body).toMatchObject({
      workspaceId: null,
      catalogRevision: "catalog-1",
      effectiveRevision: "effective-1",
      candidates: [
        {
          name: "demo",
          description: "Demo skill",
          discoveredPath: known.discoveredPath,
          canonicalPath: known.canonicalPath,
          source: "user_marginalia",
          scope: "user",
          status: "effective",
          enabled: true,
          effective: true,
          explicitOnly: false,
          explicitEligible: true,
          diagnostics: known.diagnostics,
          shadowedBy: null,
          bytesTotal: 42
        }
      ]
    });
    expect(Object.keys(body.candidates[0]).sort()).toEqual(
      [
        "bytesTotal",
        "canonicalPath",
        "description",
        "diagnostics",
        "discoveredPath",
        "effective",
        "enabled",
        "explicitEligible",
        "explicitOnly",
        "name",
        "scope",
        "shadowedBy",
        "source",
        "status"
      ].sort()
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("rawContent");
    expect(serialized).not.toContain("contentHash");
    expect(serialized).not.toContain("effectiveSkills");
    expect(serialized).not.toContain("previewContent");
    expect(serialized).not.toContain("private rawContent");
  });

  it("uses only the server-owned root for a known workspace", async () => {
    const { app, catalog, db } = setup();
    const workspace = createWorkspace(db, {
      name: "Docs",
      rootDir: "/server-owned/workspace"
    });

    const response = await app.request(`/skills?workspaceId=${workspace.id}`, {
      headers: authorizedHeaders
    });

    expect(response.status).toBe(200);
    expect(catalog.refresh).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspaceRoot: "/server-owned/workspace"
    });
  });

  it("returns 404 for an unknown workspace without refreshing", async () => {
    const { app, catalog } = setup();

    const response = await app.request("/skills?workspaceId=missing", {
      headers: authorizedHeaders
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "workspace not found" });
    expect(catalog.refresh).not.toHaveBeenCalled();
  });
});

describe("GET /skills/content", () => {
  it.each([
    {
      label: "invalid preview",
      known: candidate("/canonical/invalid/SKILL.md", {
        skill: null,
        status: "invalid",
        effective: false,
        previewContent: "invalid frontmatter",
        previewTruncated: false,
        bytesTotal: 19
      }),
      expected: {
        path: "/canonical/invalid/SKILL.md",
        content: "invalid frontmatter",
        truncated: false,
        bytesTotal: 19
      }
    },
    {
      label: "truncated preview",
      known: candidate("/canonical/large/SKILL.md", {
        previewContent: "preview prefix",
        previewTruncated: true,
        bytesTotal: 300_000,
        rawContent: null
      }),
      expected: {
        path: "/canonical/large/SKILL.md",
        content: "preview prefix",
        truncated: true,
        bytesTotal: 300_000
      }
    }
  ])("returns current snapshot content for $label", async ({ known, expected }) => {
    const { app, catalog } = setup(snapshot([known]));

    const response = await app.request(
      `/skills/content?path=${encodeURIComponent(known.canonicalPath)}`,
      { headers: authorizedHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
    expect(catalog.refresh).toHaveBeenCalledOnce();
  });

  it.each(["/unknown/SKILL.md", "/etc/passwd"])(
    "returns 404 without reading non-member path %s",
    async (requestedPath) => {
      const { app } = setup();

      const response = await app.request(
        `/skills/content?path=${encodeURIComponent(requestedPath)}`,
        { headers: authorizedHeaders }
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "skill not found" });
    }
  );

  it("returns 404 when a path belongs to another workspace snapshot", async () => {
    const workspaceAPath = "/workspace-a/.marginalia/skills/demo/SKILL.md";
    const workspaceBPath = "/workspace-b/.marginalia/skills/demo/SKILL.md";
    const { app, catalog, db } = setup();
    const workspaceA = createWorkspace(db, { name: "A", rootDir: "/workspace-a" });
    const workspaceB = createWorkspace(db, { name: "B", rootDir: "/workspace-b" });
    vi.mocked(catalog.refresh).mockImplementation(async (input) =>
      snapshot(
        [candidate(input.workspaceId === workspaceA.id ? workspaceAPath : workspaceBPath)],
        input
      )
    );

    const response = await app.request(
      `/skills/content?workspaceId=${workspaceB.id}&path=${encodeURIComponent(workspaceAPath)}`,
      { headers: authorizedHeaders }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "skill not found" });
    expect(catalog.refresh).toHaveBeenCalledWith({
      workspaceId: workspaceB.id,
      workspaceRoot: "/workspace-b"
    });
  });
});

describe("PATCH /skills/state", () => {
  it("rejects non-boolean enabled without changing a preference", async () => {
    const { app, catalog } = setup();

    const response = await app.request("/skills/state", {
      method: "PATCH",
      headers: { ...authorizedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ path: "/canonical/demo/SKILL.md", enabled: "false" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid request" });
    expect(catalog.setEnabled).not.toHaveBeenCalled();
  });

  it("delegates exact membership toggle and returns the post-preference revision", async () => {
    const known = candidate("/canonical/demo/SKILL.md");
    const updated = snapshot([{ ...known, enabled: false, effective: false, status: "disabled" }], {
      catalogRevision: "catalog-2",
      effectiveRevision: "effective-2",
      refreshedAt: 2_000
    });
    const { app, catalog, db } = setup(snapshot([known]));
    const workspace = createWorkspace(db, {
      name: "Docs",
      rootDir: "/server-owned/workspace"
    });
    vi.mocked(catalog.setEnabled).mockResolvedValue(updated);

    const response = await app.request("/skills/state", {
      method: "PATCH",
      headers: { ...authorizedHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        path: known.canonicalPath,
        enabled: false,
        workspaceId: workspace.id
      })
    });

    expect(response.status).toBe(200);
    expect(catalog.setEnabled).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspaceRoot: "/server-owned/workspace",
      path: known.canonicalPath,
      enabled: false
    });
    await expect(response.json()).resolves.toMatchObject({
      catalogRevision: "catalog-2",
      effectiveRevision: "effective-2",
      candidates: [{ canonicalPath: known.canonicalPath, enabled: false }]
    });
  });

  it.each(["/unknown/SKILL.md", "/etc/passwd"])(
    "maps typed non-member failure for %s to 404",
    async (requestedPath) => {
      const { app, catalog } = setup();
      vi.mocked(catalog.setEnabled).mockRejectedValue(new SkillCandidateNotFoundError());

      const response = await app.request("/skills/state", {
        method: "PATCH",
        headers: { ...authorizedHeaders, "content-type": "application/json" },
        body: JSON.stringify({ path: requestedPath, enabled: false })
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "skill not found" });
    }
  );
});

describe("Skills internal failures", () => {
  it("returns a generic 500 without leaking catalog paths or byte details", async () => {
    const { app, catalog } = setup();
    vi.mocked(catalog.refresh).mockRejectedValue(
      new Error("failed reading /private/skill/SKILL.md after 524288 bytes")
    );

    const response = await app.request("/skills", { headers: authorizedHeaders });

    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toBe('{"error":"skills unavailable"}');
    expect(serialized).not.toContain("/private/skill/SKILL.md");
    expect(serialized).not.toContain("524288");
  });
});
