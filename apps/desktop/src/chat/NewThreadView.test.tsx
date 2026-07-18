import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Provider } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { NewThreadView } from "./NewThreadView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listWorkspaces: vi.fn(async () => [{ id: "w1", name: "alpha", rootDir: "/a" }]),
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async (input: { workspaceId: string; title: string }) => ({
      id: "newSession",
      workspaceId: input.workspaceId,
      title: input.title,
      origin: "ui",
      model: null
    })),
    searchFiles: vi.fn(async () => []),
    getBranch: vi.fn(async () => null)
  } as unknown as ApiClient;
}

function apiWithProviders(providers: Provider[]): ApiClient {
  return { ...fakeApi(), listProviders: vi.fn(async () => providers) } as unknown as ApiClient;
}

function resetStore() {
  useAppStore.setState((s) => ({
    ...s,
    view: "new-thread",
    locale: "en",
    activeWorkspaceId: "w1",
    activeSessionId: null,
    turnDrafts: {},
    pendingTurn: null,
    composerProviderId: null,
    composerModel: null,
    leftSidebarCollapsed: false,
    rightPanelCollapsed: false
  }));
}

describe("NewThreadView", () => {
  beforeEach(() => {
    cleanup();
    resetStore();
  });

  it("renders hero title", async () => {
    render(<NewThreadView api={fakeApi()} />);
    await screen.findByText(/what should we build/i);
  });

  it("excludes disabled providers from the model picker and default selection", async () => {
    const api = apiWithProviders([
      { id: "p0", name: "DisabledCo", defaultModel: "x", enabled: false },
      { id: "p1", name: "Minimax", defaultModel: "M2.7", enabled: true }
    ]);
    render(<NewThreadView api={api} />);
    // default lands on the enabled provider, not the disabled first entry
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    expect(screen.queryByText("DisabledCo")).not.toBeInTheDocument();
  });

  it("ignores a stored provider id that is no longer enabled", async () => {
    const api = apiWithProviders([
      { id: "p0", name: "DisabledCo", defaultModel: "x", enabled: false },
      { id: "p1", name: "Minimax", defaultModel: "M2.7", enabled: true }
    ]);
    useAppStore.setState({ composerProviderId: "p0", composerModel: "x" });
    render(<NewThreadView api={api} />);
    // falls back to the enabled provider instead of the stale stored selection
    await screen.findByRole("button", { name: /Minimax · M2.7/i });
    expect(screen.queryByText("DisabledCo")).not.toBeInTheDocument();
  });

  it("moves the complete workspace draft only after creating the session", async () => {
    const api = fakeApi();
    const store = useAppStore.getState();
    store.setTurnText("new:w1", "hello world");
    store.addTurnContextFile("new:w1", "/docs/a.md");
    store.addTurnSkill("new:w1", { name: "pdf", path: "/skills/pdf" });
    render(<NewThreadView api={api} />);
    await waitFor(() => expect(api.listProviders).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveValue("hello world");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(api.createSession).toHaveBeenCalledWith({ workspaceId: "w1", title: "hello world" })
    );
    expect(useAppStore.getState().activeSessionId).toBe("newSession");
    expect(useAppStore.getState().getTurnDraft("new:w1")).toEqual({
      text: "",
      contextFiles: [],
      skills: []
    });
    expect(useAppStore.getState().getTurnDraft("session:newSession")).toEqual({
      text: "hello world",
      contextFiles: ["/docs/a.md"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
    expect(useAppStore.getState().pendingTurn).toEqual({
      sessionId: "newSession",
      turn: {
        text: "hello world",
        contextFiles: ["/docs/a.md"],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }
    });
    expect(useAppStore.getState().view).toBe("chat");
  });

  it("keeps the workspace draft when session creation fails", async () => {
    const api = fakeApi();
    (api.createSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    useAppStore.getState().setTurnText("new:w1", "keep me");
    render(<NewThreadView api={api} />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    expect(useAppStore.getState().getTurnDraft("new:w1").text).toBe("keep me");
    expect(useAppStore.getState().pendingTurn).toBeNull();
    expect(useAppStore.getState().view).toBe("new-thread");
  });

  it("hands off only the clicked snapshot and preserves edits made while creating", async () => {
    const api = fakeApi();
    let finishCreate: ((session: Awaited<ReturnType<ApiClient["createSession"]>>) => void) | null =
      null;
    (api.createSession as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        })
    );
    useAppStore.getState().setTurnText("new:w1", "first");
    render(<NewThreadView api={api} />);
    await screen.findByRole("button", { name: /Minimax · M2.7/i });

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    await userEvent.clear(screen.getByRole("textbox", { name: /message/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "later edit");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(api.createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCreate?.({
        id: "newSession",
        workspaceId: "w1",
        title: "first",
        origin: "ui",
        model: null
      });
    });

    await waitFor(() => expect(useAppStore.getState().view).toBe("chat"));
    expect(useAppStore.getState().pendingTurn?.turn.text).toBe("first");
    expect(useAppStore.getState().getTurnDraft("session:newSession").text).toBe("first");
    expect(useAppStore.getState().getTurnDraft("new:w1").text).toBe("later edit");
  });
});
