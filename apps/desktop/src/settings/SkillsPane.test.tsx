import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiClient,
  SkillCandidate,
  SkillCatalogSnapshot,
  SkillSource,
  SkillStatus
} from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { SkillsPane } from "./SkillsPane.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function candidate(input: {
  name: string | null;
  description: string | null;
  discoveredPath: string;
  canonicalPath?: string;
  source?: SkillSource;
  status: SkillStatus;
  enabled?: boolean;
  explicitOnly?: boolean;
  warning?: boolean;
}): SkillCandidate {
  return {
    name: input.name,
    description: input.description,
    discoveredPath: input.discoveredPath,
    canonicalPath: input.canonicalPath ?? input.discoveredPath,
    source: input.source ?? "workspace_marginalia",
    scope: input.source?.startsWith("user_") ? "user" : "workspace",
    status: input.status,
    enabled: input.enabled ?? input.status !== "disabled",
    effective: input.status === "effective",
    explicitOnly: input.explicitOnly ?? false,
    explicitEligible: true,
    shadowedBy: input.status === "shadowed" ? "/winner/SKILL.md" : null,
    bytesTotal: 256,
    diagnostics: input.warning
      ? [{ code: "pi_warning", level: "warning", message: "Name should be shorter" }]
      : input.status === "invalid"
        ? [{ code: "missing_description", level: "error", message: "Description is required" }]
        : []
  };
}

const candidates = [
  candidate({
    name: "alpha",
    description: "Search by name",
    discoveredPath: "/repo/.marginalia/skills/alpha/SKILL.md",
    canonicalPath: "/real/alpha/SKILL.md",
    status: "effective",
    warning: true
  }),
  candidate({
    name: "beta",
    description: "Unique description needle",
    discoveredPath: "/repo/.pi/skills/beta/SKILL.md",
    status: "shadowed",
    source: "workspace_pi",
    explicitOnly: true
  }),
  candidate({
    name: "gamma",
    description: "Disabled candidate",
    discoveredPath: "/discovered/needle/gamma/SKILL.md",
    status: "disabled",
    enabled: false,
    source: "ancestor_agents"
  }),
  candidate({
    name: null,
    description: null,
    discoveredPath: "/user/invalid/SKILL.md",
    canonicalPath: "/canonical/needle/invalid/SKILL.md",
    status: "invalid",
    enabled: true,
    source: "user_agents"
  })
] satisfies SkillCandidate[];

function snapshot(
  workspaceId: string | null,
  catalogRevision = "catalog-1",
  nextCandidates = candidates
): SkillCatalogSnapshot {
  return {
    workspaceId,
    catalogRevision,
    effectiveRevision: `effective-${catalogRevision}`,
    refreshedAt: 1,
    candidates: nextCandidates,
    diagnostics: []
  };
}

function fakeApi(initial = snapshot("w1")): ApiClient {
  return {
    listSkills: vi.fn(async () => initial),
    setSkillEnabled: vi.fn(async () => initial),
    readSkillContent: vi.fn(async ({ path }) => ({
      path,
      content: `server content for ${path}`,
      truncated: false,
      bytesTotal: 256
    }))
  } as unknown as ApiClient;
}

describe("SkillsPane", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.setState({ locale: "en" });
  });

  it("refreshes a workspace catalog and shows every status, independent badges, and paths", async () => {
    const api = fakeApi();
    render(<SkillsPane api={api} workspace={{ id: "w1", name: "Research" }} />);

    await waitFor(() => expect(api.listSkills).toHaveBeenCalledWith("w1"));
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Effective")).toBeInTheDocument();
    expect(screen.getByText("Enabled · Shadowed")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();

    const alpha = screen.getByTestId("skill-row-/real/alpha/SKILL.md");
    expect(within(alpha).getByText("Warning")).toBeInTheDocument();
    expect(within(alpha).queryByText("Explicit only")).toBeNull();
    const beta = screen.getByTestId("skill-row-/repo/.pi/skills/beta/SKILL.md");
    expect(within(beta).getByText("Explicit only")).toBeInTheDocument();
    expect(within(beta).queryByText("Warning")).toBeNull();

    expect(screen.getByText("Workspace Marginalia")).toBeInTheDocument();
    await userEvent.click(within(alpha).getByRole("button", { name: /view details/i }));
    expect(screen.getAllByText("/repo/.marginalia/skills/alpha/SKILL.md")).not.toHaveLength(0);
    expect(screen.getByText("/real/alpha/SKILL.md")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /alpha/i })).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("button", { name: /create|import|install|edit|uninstall/i })
    ).toBeNull();
  });

  it("searches name, description, discovered path, and canonical path", async () => {
    const api = fakeApi();
    render(<SkillsPane api={api} workspace={{ id: "w1", name: "Research" }} />);
    const search = await screen.findByRole("searchbox", { name: /search skills/i });

    for (const [query, expected] of [
      ["alpha", "alpha"],
      ["unique description needle", "beta"],
      ["/discovered/needle", "gamma"],
      ["/canonical/needle", "Unknown Skill"]
    ] as const) {
      await userEvent.clear(search);
      await userEvent.type(search, query);
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(1);
    }
  });

  it("loads invalid candidate content lazily and reports server truncation", async () => {
    const api = fakeApi();
    (api.readSkillContent as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/canonical/needle/invalid/SKILL.md",
      content: "---\nname: broken\n---",
      truncated: true,
      bytesTotal: 999_999
    });
    render(<SkillsPane api={api} workspace={{ id: "w1", name: "Research" }} />);
    const invalid = await screen.findByTestId("skill-row-/canonical/needle/invalid/SKILL.md");
    expect(api.readSkillContent).not.toHaveBeenCalled();

    await userEvent.click(within(invalid).getByRole("button", { name: /view details/i }));

    await waitFor(() =>
      expect(api.readSkillContent).toHaveBeenCalledWith({
        path: "/canonical/needle/invalid/SKILL.md",
        workspaceId: "w1"
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "PRE" && element.textContent === "---\nname: broken\n---"
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/preview truncated/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /unknown skill/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("keeps toggle state server-authoritative and offers retry after failure", async () => {
    const toggle = deferred<SkillCatalogSnapshot>();
    const api = fakeApi();
    (api.setSkillEnabled as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(toggle.promise)
      .mockRejectedValueOnce(new Error("disk busy"));
    render(<SkillsPane api={api} workspace={{ id: "w1", name: "Research" }} />);
    const control = await screen.findByRole("switch", { name: /alpha/i });

    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("switch", { name: /beta/i })).toBeDisabled();
    const disabled = candidate({
      name: "alpha",
      description: "Search by name",
      discoveredPath: "/repo/.marginalia/skills/alpha/SKILL.md",
      canonicalPath: "/real/alpha/SKILL.md",
      status: "disabled",
      enabled: false
    });
    await act(async () => toggle.resolve(snapshot("w1", "catalog-2", [disabled])));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /alpha/i })).toHaveAttribute(
        "aria-checked",
        "false"
      )
    );

    const disabledControl = screen.getByRole("switch", { name: /alpha/i });
    await userEvent.click(disabledControl);
    expect(disabledControl).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByText(/skills could not be updated/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
  });

  it("supports manual refresh and retrying an initial global-only failure", async () => {
    const api = fakeApi(snapshot(null));
    (api.listSkills as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(snapshot(null))
      .mockResolvedValueOnce(snapshot(null, "manual"));
    render(<SkillsPane api={api} workspace={null} />);

    expect(await screen.findByText("Global Skills")).toBeInTheDocument();
    expect(await screen.findByText(/skills could not be refreshed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(3));
    expect(api.listSkills).toHaveBeenLastCalledWith(null);
  });

  it("ignores content responses for an older row or workspace", async () => {
    const alphaContent = deferred<{
      path: string;
      content: string;
      truncated: boolean;
      bytesTotal: number;
    }>();
    const betaContent = deferred<{
      path: string;
      content: string;
      truncated: boolean;
      bytesTotal: number;
    }>();
    const api = fakeApi();
    (api.listSkills as ReturnType<typeof vi.fn>).mockImplementation(async (workspaceId) =>
      snapshot(workspaceId ?? null)
    );
    (api.readSkillContent as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(alphaContent.promise)
      .mockReturnValueOnce(betaContent.promise);
    const { rerender } = render(
      <SkillsPane api={api} workspace={{ id: "w1", name: "Research" }} />
    );
    const alpha = await screen.findByTestId("skill-row-/real/alpha/SKILL.md");
    await userEvent.click(within(alpha).getByRole("button", { name: /view details/i }));
    const beta = screen.getByTestId("skill-row-/repo/.pi/skills/beta/SKILL.md");
    await userEvent.click(within(beta).getByRole("button", { name: /view details/i }));

    await act(async () =>
      betaContent.resolve({
        path: "/repo/.pi/skills/beta/SKILL.md",
        content: "beta server content",
        truncated: false,
        bytesTotal: 20
      })
    );
    expect(await screen.findByText("beta server content")).toBeInTheDocument();
    await act(async () =>
      alphaContent.resolve({
        path: "/real/alpha/SKILL.md",
        content: "stale alpha content",
        truncated: false,
        bytesTotal: 20
      })
    );
    expect(screen.queryByText("stale alpha content")).toBeNull();

    const oldWorkspaceContent = deferred<{
      path: string;
      content: string;
      truncated: boolean;
      bytesTotal: number;
    }>();
    (api.readSkillContent as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      oldWorkspaceContent.promise
    );
    await userEvent.click(within(alpha).getByRole("button", { name: /view details/i }));
    rerender(<SkillsPane api={api} workspace={{ id: "w2", name: "Other" }} />);
    await waitFor(() => expect(api.listSkills).toHaveBeenLastCalledWith("w2"));
    await act(async () =>
      oldWorkspaceContent.resolve({
        path: "/real/alpha/SKILL.md",
        content: "stale workspace content",
        truncated: false,
        bytesTotal: 20
      })
    );
    expect(screen.queryByText("stale workspace content")).toBeNull();
  });
});
