import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient, type RunEvent } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "./ChatView.js";

async function* events(items: RunEvent[]) {
  for (const e of items) yield e;
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

    await waitFor(() =>
      expect(screen.getByText("run_failed").parentElement).toHaveTextContent("Selections changed")
    );
    expect(useAppStore.getState().getTurnDraft("session:s1").text).toBe("keep me");
    expect(screen.queryByText("keep me", { selector: "p" })).not.toBeInTheDocument();
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

      await screen.findByText(new RegExp(message));
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

    await screen.findByText(/run ended before starting/);
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

    await screen.findByText(/Retry rejected/);
    expect(
      screen.getByText((_text, node) => node?.textContent === "accepted A", {
        selector: ".whitespace-pre-wrap"
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(api.runChat).toHaveBeenCalledTimes(2);
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
