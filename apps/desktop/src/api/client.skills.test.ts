import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ApiClient,
  type SkillCandidate,
  type SkillCatalogSnapshot,
  type SkillSelection
} from "./client.js";

afterEach(() => vi.unstubAllGlobals());

const snapshot = {
  workspaceId: "workspace / &",
  catalogRevision: "catalog-1",
  effectiveRevision: "effective-1",
  refreshedAt: 1_721_321_200_000,
  candidates: [
    {
      name: "pdf",
      description: "Work with PDFs",
      discoveredPath: "/workspace/.marginalia/skills/pdf/SKILL.md",
      canonicalPath: "/canonical/pdf/SKILL.md",
      source: "workspace_marginalia",
      scope: "workspace",
      status: "effective",
      enabled: true,
      effective: true,
      explicitOnly: false,
      explicitEligible: true,
      shadowedBy: null,
      bytesTotal: 128,
      diagnostics: []
    }
  ],
  diagnostics: [
    {
      code: "resource_collision",
      level: "warning",
      message: "Skill pdf is shadowed",
      path: "/loser/pdf/SKILL.md",
      collision: {
        resourceType: "skill",
        name: "pdf",
        winnerPath: "/canonical/pdf/SKILL.md",
        loserPath: "/loser/pdf/SKILL.md",
        winnerSource: "workspace_marginalia",
        loserSource: "user_pi"
      }
    }
  ]
} satisfies SkillCatalogSnapshot;

function stubJson(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => Response.json(payload, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiClient Skills API", () => {
  it("mirrors the public server Skill source contract", () => {
    expectTypeOf<SkillCandidate["source"]>().toEqualTypeOf<
      | "workspace_marginalia"
      | "workspace_pi"
      | "ancestor_agents"
      | "user_marginalia"
      | "user_pi"
      | "user_agents"
    >();
  });

  it("lists a workspace catalog with an encoded workspace query and bearer", async () => {
    const fetchMock = stubJson(snapshot);
    const api = new ApiClient("http://server", "secret-token");

    await expect(api.listSkills("workspace / &")).resolves.toEqual(snapshot);

    const query = new URLSearchParams({ workspaceId: "workspace / &" });
    expect(fetchMock).toHaveBeenCalledWith(`http://server/skills?${query}`, {
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      }
    });
  });

  it("omits the workspace query for the global catalog", async () => {
    const fetchMock = stubJson({ ...snapshot, workspaceId: null });
    const api = new ApiClient("http://server", "secret-token");

    await api.listSkills(null);

    expect(fetchMock).toHaveBeenCalledWith("http://server/skills", expect.anything());
  });

  it("sends an exact state patch with the bearer", async () => {
    const fetchMock = stubJson(snapshot);
    const api = new ApiClient("http://server", "secret-token");

    await api.setSkillEnabled({
      path: "/canonical/pdf/SKILL.md",
      enabled: false,
      workspaceId: "workspace / &"
    });

    expect(fetchMock).toHaveBeenCalledWith("http://server/skills/state", {
      method: "PATCH",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        path: "/canonical/pdf/SKILL.md",
        enabled: false,
        workspaceId: "workspace / &"
      })
    });
  });

  it("omits a null workspace from the exact state patch", async () => {
    const fetchMock = stubJson({ ...snapshot, workspaceId: null });
    const api = new ApiClient("http://server", "secret-token");

    await api.setSkillEnabled({
      path: "/canonical/pdf/SKILL.md",
      enabled: true,
      workspaceId: null
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      path: "/canonical/pdf/SKILL.md",
      enabled: true
    });
  });

  it("reads encoded Skill content with the bearer", async () => {
    const content = {
      path: "/canonical/pdf & notes/SKILL.md",
      content: "# PDF",
      truncated: false,
      bytesTotal: 5
    };
    const fetchMock = stubJson(content);
    const api = new ApiClient("http://server", "secret-token");

    await expect(
      api.readSkillContent({ path: content.path, workspaceId: "workspace / &" })
    ).resolves.toEqual(content);

    const query = new URLSearchParams({
      path: content.path,
      workspaceId: "workspace / &"
    });
    expect(fetchMock).toHaveBeenCalledWith(`http://server/skills/content?${query}`, {
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      }
    });
  });

  it("preserves ordered selections in the run request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('data: {"type":"run_completed","payload":{}}\n\n', {
          headers: { "content-type": "text/event-stream" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = new ApiClient("http://server", "secret-token");
    const skills = [
      { name: "pdf", path: "/canonical/pdf/SKILL.md" },
      { name: "slides", path: "/canonical/slides/SKILL.md" }
    ] satisfies SkillSelection[];

    await api.runChat("s1", {
      providerId: "p1",
      message: "summarize",
      skills
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).skills).toEqual(skills);
  });

  it("preserves the full 409 Skill precondition error", async () => {
    const body = {
      error: "skill_precondition_failed",
      message: "One or more Skill selections are unavailable",
      catalogRevision: "catalog-2",
      invalidSelections: [
        {
          name: "pdf",
          path: "/old",
          reason: "shadowed",
          winnerPath: "/canonical/pdf/SKILL.md"
        }
      ]
    };
    stubJson(body, 409);
    const api = new ApiClient("http://server", "secret-token");

    await expect(
      api.runChat("s1", {
        providerId: "p1",
        message: "summarize",
        skills: [{ name: "pdf", path: "/old" }]
      })
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "One or more Skill selections are unavailable",
      status: 409,
      code: "skill_precondition_failed",
      details: body
    });
  });

  it("preserves a 413 run error without inventing details", async () => {
    const body = { error: "skill_payload_too_large" };
    stubJson(body, 413);
    const api = new ApiClient("http://server", "secret-token");

    await expect(
      api.runChat("s1", { providerId: "p1", message: "summarize" })
    ).rejects.toMatchObject({
      name: "ApiError",
      message: "skill_payload_too_large",
      status: 413,
      code: "skill_payload_too_large",
      details: body
    });
  });
});
