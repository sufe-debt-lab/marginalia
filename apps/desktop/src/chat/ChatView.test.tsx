import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "./ChatView.js";

async function* events(items: RunEvent[]) {
  for (const e of items) yield e;
}

function makeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listMessages: vi.fn(async () => []),
    createMessage: vi.fn(async (_sid, input) => ({
      id: "u",
      role: input.role,
      content: input.content
    })),
    runChat: vi.fn(async () => events([{ type: "assistant_delta", payload: { text: "hi" } }])),
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
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    }));
  });

  it("consumes pendingPrompt on mount", async () => {
    useAppStore.setState({ pendingPrompt: "hello first" });
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.runChat).toHaveBeenCalled());
    expect(useAppStore.getState().pendingPrompt).toBeNull();
  });

  it("does not auto-send when pendingPrompt is null", async () => {
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.listMessages).toHaveBeenCalled());
    expect(api.runChat).not.toHaveBeenCalled();
  });

  it("retry resends without duplicating the user message", async () => {
    const api = makeApi();
    (api.runChat as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () =>
        events([{ type: "run_failed", payload: { error: "boom" } }])
      )
      .mockImplementationOnce(async () =>
        events([{ type: "assistant_delta", payload: { text: "ok" } }])
      );
    useAppStore.setState({ pendingPrompt: "hello there" });
    render(<ChatView api={api} sessionId="s1" />);

    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(api.runChat).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    expect(screen.getAllByText("hello there")).toHaveLength(1);
  });
});
