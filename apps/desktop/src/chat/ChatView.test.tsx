import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ApiClient,
  type RunEvent,
  type SkillCandidate,
  type SkillCatalogSnapshot
} from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "./ChatView.js";

async function* events(items: RunEvent[]) {
  for (const e of items) yield e;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const textDelta = (delta: string): RunEvent => ({
  type: "agent_event",
  payload: {
    event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta } }
  }
});
const agentEvent = (event: unknown): RunEvent => ({ type: "agent_event", payload: { event } });
const messageStart = (): RunEvent =>
  agentEvent({ type: "message_start", message: { role: "assistant" } });
const messageEnd = (stopReason = "stop"): RunEvent =>
  agentEvent({ type: "message_end", message: { stopReason } });
const runCompleted = (): RunEvent => ({ type: "run_completed", payload: {} });

function skillCandidate(name: string, path: string): SkillCandidate {
  return {
    name,
    description: `${name} description`,
    discoveredPath: path,
    canonicalPath: path,
    source: "workspace_marginalia",
    scope: "workspace",
    status: "effective",
    enabled: true,
    effective: true,
    explicitOnly: false,
    explicitEligible: true,
    shadowedBy: null,
    bytesTotal: 10,
    diagnostics: []
  };
}

function skillSnapshot(candidates: SkillCandidate[]): SkillCatalogSnapshot {
  return {
    workspaceId: "w1",
    catalogRevision: "catalog",
    effectiveRevision: "effective",
    refreshedAt: 1,
    candidates,
    diagnostics: []
  };
}

function makeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listMessages: vi.fn(async () => []),
    listApprovals: vi.fn(async () => []),
    createMessage: vi.fn(async (_sid, input) => ({
      id: "u",
      role: input.role,
      content: input.content
    })),
    runChat: vi.fn(async () =>
      events([{ type: "run_started", payload: {} }, textDelta("hi"), runCompleted()])
    ),
    listSkills: vi.fn(async () => ({
      workspaceId: "w1",
      catalogRevision: "catalog",
      effectiveRevision: "effective",
      refreshedAt: 1,
      candidates: [],
      diagnostics: []
    })),
    searchFiles: vi.fn(async () => [])
  } as unknown as ApiClient;
}

describe("ChatView", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState((s) => ({
      ...s,
      view: "chat",
      settingsEntryTab: "general",
      settingsEntryRevision: 0,
      activeWorkspaceId: "w1",
      activeSessionId: "s1",
      turnDrafts: {},
      pendingTurn: null,
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    }));
  });

  it("claims and sends a matching pending turn, clearing its draft only on run_started", async () => {
    useAppStore.getState().setTurnText("session:s1", "hello first");
    useAppStore.getState().addTurnSkill("session:s1", { name: "pdf", path: "/skills/pdf" });
    useAppStore.getState().setPendingTurn({
      sessionId: "s1",
      turn: {
        text: "hello first",
        contextFiles: [],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }
    });
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.runChat).toHaveBeenCalled());
    expect(useAppStore.getState().pendingTurn).toBeNull();
    expect(useAppStore.getState().getTurnDraft("session:s1")).toEqual({
      text: "",
      contextFiles: [],
      skills: []
    });
    expect(
      await screen.findByText((_text, node) => node?.textContent === "$pdf\n\nhello first", {
        selector: ".whitespace-pre-wrap"
      })
    ).toBeInTheDocument();
  });

  it("does not claim or auto-send a pending turn for another session", async () => {
    useAppStore.getState().setPendingTurn({
      sessionId: "other",
      turn: { text: "not yours", contextFiles: [], skills: [] }
    });
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.listMessages).toHaveBeenCalled());
    expect(api.runChat).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingTurn?.sessionId).toBe("other");
  });

  it("retry resends the complete accepted turn without duplicating the user message", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([
          { type: "run_started", payload: {} },
          { type: "run_failed", payload: { error: "boom" } }
        ])
      )
      .mockImplementationOnce(async () =>
        events([{ type: "run_started", payload: {} }, textDelta("ok"), runCompleted()])
      );
    useAppStore.getState().setTurnText("session:s1", "hello there");
    useAppStore.getState().addTurnContextFile("session:s1", "/docs/a.md");
    useAppStore.getState().addTurnSkill("session:s1", { name: "pdf", path: "/skills/pdf" });
    useAppStore.getState().setPendingTurn({
      sessionId: "s1",
      turn: {
        text: "hello there",
        contextFiles: ["/docs/a.md"],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }
    });
    render(<ChatView api={api} sessionId="s1" />);

    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    useAppStore.getState().setTurnText("session:s1", "next draft");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(api.runChat).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    expect(
      screen.getAllByText((_text, node) => node?.textContent === "$pdf\n\nhello there", {
        selector: ".whitespace-pre-wrap"
      })
    ).toHaveLength(1);
    expect(api.runChat).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({
        message: "hello there",
        contextFiles: ["/docs/a.md"],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }),
      expect.anything()
    );
    expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("next draft");
  });

  it("does not clear edits made while waiting for run_started", async () => {
    let accept: (() => void) | null = null;
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
      events([
        await new Promise<RunEvent>((resolve) => {
          accept = () => resolve({ type: "run_started", payload: {} });
        }),
        runCompleted()
      ])
    );
    useAppStore.getState().setTurnText("session:s1", "first");
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(api.runChat).toHaveBeenCalledTimes(1));
    await userEvent.clear(screen.getByRole("textbox", { name: /message/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "later edit");
    await act(async () => accept?.());

    await waitFor(() =>
      expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("later edit")
    );
  });

  it("keeps the session draft and appends nothing when HTTP rejects before run_started", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError("Selections changed", 409, "skill_precondition_failed", {})
    );
    useAppStore.getState().setTurnText("session:s1", "keep me");
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Selected Skills changed");
    expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
    expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("keep me");
    expect(screen.queryByText("keep me", { selector: "p" })).not.toBeInTheDocument();
  });

  it("repairs canonical Skill preconditions without clearing or rebinding the turn", async () => {
    const pdfPath = "/old/pdf";
    const reviewPath = "/old/review";
    const validPath = "/skills/valid";
    const initial = skillSnapshot([
      skillCandidate("pdf", pdfPath),
      skillCandidate("review", reviewPath),
      skillCandidate("valid", validPath)
    ]);
    const recovered = { ...initial, catalogRevision: "recovered" };
    const api = makeApi();
    (api.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(recovered);
    (api.runChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError("Selections changed", 409, "skill_precondition_failed", {
        invalidSelections: [
          { name: "pdf", path: pdfPath, reason: "missing" },
          { name: "review", path: reviewPath, reason: "disabled" }
        ]
      })
    );
    const store = useAppStore.getState();
    store.setTurnText("session:s1", "keep the complete turn");
    store.addTurnContextFile("session:s1", "/docs/a.md");
    store.addTurnSkill("session:s1", { name: "pdf", path: pdfPath });
    store.addTurnSkill("session:s1", { name: "review", path: reviewPath });
    store.addTurnSkill("session:s1", { name: "valid", path: validPath });
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Selected Skills changed");
    expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retry$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId(`skill-chip-${pdfPath}`)).toHaveAttribute("data-invalid", "true");
    expect(screen.getByTestId(`skill-chip-${reviewPath}`)).toHaveAttribute("data-invalid", "true");
    expect(screen.getByTestId(`skill-chip-${validPath}`)).toHaveAttribute("data-invalid", "false");
    expect(useAppStore.getState().getTurnDraft("session:s1")).toEqual({
      text: "keep the complete turn",
      contextFiles: ["/docs/a.md"],
      skills: [
        { name: "pdf", path: pdfPath },
        { name: "review", path: reviewPath },
        { name: "valid", path: validPath }
      ]
    });

    await userEvent.click(screen.getByRole("button", { name: "Open Skills settings" }));
    expect(useAppStore.getState().view).toBe("settings");
    expect(
      (useAppStore.getState() as unknown as { settingsEntryTab?: string }).settingsEntryTab
    ).toBe("skills");
    expect(useAppStore.getState().getTurnDraft("session:s1").contextFiles).toEqual(["/docs/a.md"]);
    useAppStore.getState().setView("chat");

    await userEvent.click(screen.getByRole("button", { name: "Remove unavailable Skill pdf" }));
    expect(useAppStore.getState().getTurnDraft("session:s1").skills).toEqual([
      { name: "review", path: reviewPath },
      { name: "valid", path: validPath }
    ]);
    expect(screen.queryByTestId(`skill-chip-${pdfPath}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`skill-chip-${reviewPath}`)).toHaveAttribute("data-invalid", "true");

    await userEvent.click(screen.getByRole("button", { name: "Refresh Skills" }));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(useAppStore.getState().getTurnDraft("session:s1").skills).toEqual([
      { name: "review", path: reviewPath },
      { name: "valid", path: validPath }
    ]);
    expect(screen.getByTestId(`skill-chip-${reviewPath}`)).toHaveAttribute("data-invalid", "false");
  });

  it("does not let an older blocked refresh clear a newer blocked response", async () => {
    const path = "/skills/renamed";
    const refresh = deferred<SkillCatalogSnapshot>();
    const api = makeApi();
    (api.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(skillSnapshot([skillCandidate("old-name", path)]))
      .mockReturnValueOnce(refresh.promise);
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        new ApiError("Old selection changed", 409, "skill_precondition_failed", {
          invalidSelections: [{ name: "old-name", path, reason: "name_mismatch" }]
        })
      )
      .mockRejectedValueOnce(
        new ApiError("New selection changed", 409, "skill_precondition_failed", {
          invalidSelections: [{ name: "new-name", path, reason: "disabled" }]
        })
      );
    const store = useAppStore.getState();
    store.setTurnText("session:s1", "keep this turn");
    store.addTurnSkill("session:s1", { name: "old-name", path });
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByRole("button", { name: "Remove unavailable Skill old-name" });

    await userEvent.click(screen.getByRole("button", { name: "Refresh Skills" }));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
    useAppStore.getState().replaceTurnSkills("session:s1", [{ name: "new-name", path }]);
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByRole("button", { name: "Remove unavailable Skill new-name" });

    await act(async () => refresh.resolve(skillSnapshot([skillCandidate("new-name", path)])));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh Skills" })).not.toBeDisabled()
    );

    expect(
      screen.getByRole("button", { name: "Remove unavailable Skill new-name" })
    ).toBeInTheDocument();
    expect(screen.getByTestId(`skill-chip-${path}`)).toHaveAttribute("data-invalid", "true");
  });

  it("drops an invalid entry on refresh when its current draft chip is already absent", async () => {
    const path = "/skills/removed-elsewhere";
    const api = makeApi();
    (api.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(skillSnapshot([skillCandidate("removed", path)]))
      .mockResolvedValueOnce(skillSnapshot([]));
    (api.runChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError("Selection removed", 409, "skill_precondition_failed", {
        invalidSelections: [{ name: "removed", path, reason: "missing" }]
      })
    );
    const store = useAppStore.getState();
    store.setTurnText("session:s1", "keep this turn");
    store.addTurnSkill("session:s1", { name: "removed", path });
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByRole("button", { name: "Remove unavailable Skill removed" });

    useAppStore.getState().removeTurnSkill("session:s1", path);
    await userEvent.click(screen.getByRole("button", { name: "Refresh Skills" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(useAppStore.getState().getTurnDraft("session:s1").skills).toEqual([]);
  });

  it.each([
    [new ApiError("Session busy", 409, "session_busy", {}), "This chat is already running"],
    [new ApiError("Unauthorized", 401, "unauthorized", {}), "Reconnect to Marginalia"],
    [
      new ApiError("Payload too large", 413, "skill_payload_too_large", {}),
      "Selected Skill content is too large"
    ],
    [null, "The run ended before it started"]
  ])(
    "keeps a pre-start blocked turn in the Composer without refreshing the catalog",
    async (failure, expectedMessage) => {
      const api = makeApi();
      if (failure) {
        (api.runChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
      } else {
        (api.runChat as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => events([]));
      }
      const store = useAppStore.getState();
      store.setTurnText("session:s1", "blocked draft");
      store.addTurnContextFile("session:s1", "/docs/a.md");
      store.addTurnSkill("session:s1", { name: "pdf", path: "/skills/pdf" });
      render(<ChatView api={api} sessionId="s1" />);
      await screen.findByRole("button", { name: /Minimax · M2.7/i });

      await userEvent.click(screen.getByRole("button", { name: /send/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
      expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Retry$/i })).not.toBeInTheDocument();
      expect(api.listSkills).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().getTurnDraft("session:s1")).toEqual({
        text: "blocked draft",
        contextFiles: ["/docs/a.md"],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      });
    }
  );

  it("claims a first turn only once and preserves the session draft after pre-start failure", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError("Selections changed", 409, "skill_precondition_failed", {
        invalidSelections: [{ name: "pdf", path: "/skills/pdf", reason: "missing" }]
      })
    );
    useAppStore.getState().setTurnText("session:s1", "first blocked turn");
    useAppStore.getState().addTurnSkill("session:s1", {
      name: "pdf",
      path: "/skills/pdf"
    });
    useAppStore.getState().setPendingTurn({
      sessionId: "s1",
      turn: {
        text: "first blocked turn",
        contextFiles: [],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }
    });
    const { rerender } = render(<ChatView api={api} sessionId="s1" />);

    await screen.findByRole("alert");
    rerender(<ChatView api={api} sessionId="s1" />);

    expect(api.runChat).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().pendingTurn).toBeNull();
    expect(useAppStore.getState().getTurnDraft("session:s1")).toEqual({
      text: "first blocked turn",
      contextFiles: [],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
  });

  it.each([
    [401, "Authentication expired"],
    [409, "Selections changed"],
    [413, "Selection too large"]
  ])(
    "does not offer stale retry after an accepted failure followed by pre-start HTTP %i",
    async (status, message) => {
      const api = makeApi();
      (api.runChat as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () =>
          events([
            { type: "run_started", payload: {} },
            { type: "run_failed", payload: { error: "first failed" } }
          ])
        )
        .mockRejectedValueOnce(new ApiError(message, status, "precondition_failed", {}));
      useAppStore.getState().setTurnText("session:s1", "accepted A");
      render(<ChatView api={api} sessionId="s1" />);
      await screen.findByRole("button", { name: /Minimax · M2.7/i });
      await userEvent.click(screen.getByRole("button", { name: /send/i }));
      await screen.findByText(/first failed/);

      await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "draft B");
      await userEvent.click(screen.getByRole("button", { name: /send/i }));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      expect(api.runChat).toHaveBeenCalledTimes(2);
      expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("draft B");
    }
  );

  it("does not offer stale retry after an accepted failure followed by pre-start EOF", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([
          { type: "run_started", payload: {} },
          { type: "run_failed", payload: { error: "first failed" } }
        ])
      )
      .mockImplementationOnce(async () => events([]));
    useAppStore.getState().setTurnText("session:s1", "accepted A");
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/first failed/);

    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "draft B");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await screen.findByText(/run ended before it started/i);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(api.runChat).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("draft B");
  });

  it("retains the accepted attempt when its retry fails before run_started", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([
          { type: "run_started", payload: {} },
          { type: "run_failed", payload: { error: "first failed" } }
        ])
      )
      .mockRejectedValueOnce(new ApiError("Retry rejected", 409, "session_busy", {}));
    useAppStore.getState().setTurnText("session:s1", "accepted A");
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/first failed/);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This chat is already running");
    expect(
      screen.getByText((_text, node) => node?.textContent === "accepted A", {
        selector: ".whitespace-pre-wrap"
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(api.runChat).toHaveBeenCalledTimes(2);
  });

  it("refreshes invalid state against the current matching chip after a stale retry fails", async () => {
    const path = "/skills/renamed";
    const latest = skillSnapshot([skillCandidate("new-name", path)]);
    const api = makeApi();
    (api.listSkills as ReturnType<typeof vi.fn>).mockResolvedValue(latest);
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([
          { type: "run_started", payload: {} },
          { type: "run_failed", payload: { error: "first failed" } }
        ])
      )
      .mockRejectedValueOnce(
        new ApiError("Skill renamed", 409, "skill_precondition_failed", {
          invalidSelections: [{ name: "old-name", path, reason: "name_mismatch" }]
        })
      );
    useAppStore.getState().setTurnText("session:s1", "accepted A");
    useAppStore.getState().addTurnSkill("session:s1", { name: "old-name", path });
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/first failed/);
    useAppStore.getState().addTurnSkill("session:s1", { name: "new-name", path });

    await userEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    await screen.findByText("Selected Skills changed");
    expect(screen.getByTestId(`skill-chip-${path}`)).toHaveAttribute("data-invalid", "true");

    await userEvent.click(screen.getByRole("button", { name: "Refresh Skills" }));

    await waitFor(() =>
      expect(screen.getByTestId(`skill-chip-${path}`)).toHaveAttribute("data-invalid", "false")
    );
    expect(useAppStore.getState().getTurnDraft("session:s1").skills).toEqual([
      { name: "new-name", path }
    ]);
  });

  it("removes every failed-attempt entry only after a multi-bubble retry is accepted", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([
          { type: "run_started", payload: {} },
          messageStart(),
          textDelta("first partial"),
          messageEnd("toolUse"),
          agentEvent({
            type: "tool_execution_end",
            toolCallId: "t1",
            toolName: "read",
            result: "done-result",
            isError: false
          }),
          messageStart(),
          textDelta("second partial"),
          { type: "run_failed", payload: { error: "first failed" } }
        ])
      )
      .mockImplementationOnce(async () =>
        events([{ type: "run_started", payload: {} }, textDelta("retry answer"), runCompleted()])
      );
    useAppStore.getState().setTurnText("session:s1", "accepted A");
    render(<ChatView api={api} sessionId="s1" />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText(/first failed/);
    expect(screen.getByText("first partial")).toBeInTheDocument();
    expect(screen.getByText("second partial")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await screen.findByText("retry answer");
    expect(screen.queryByText("first partial")).not.toBeInTheDocument();
    expect(screen.queryByText("second partial")).not.toBeInTheDocument();
    expect(
      screen.getAllByText((_text, node) => node?.textContent === "accepted A", {
        selector: ".whitespace-pre-wrap"
      })
    ).toHaveLength(1);
  });
});
