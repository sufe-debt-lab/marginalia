import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { NewThreadView } from "./NewThreadView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listWorkspaces: vi.fn(async () => [{ id: "w1", name: "alpha", rootDir: "/a" }]),
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

function resetStore() {
  useAppStore.setState((s) => ({
    ...s,
    view: "new-thread",
    locale: "en",
    activeWorkspaceId: "w1",
    activeSessionId: null,
    pendingPrompt: null,
    contextFiles: [],
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

  it("submitting creates session, sets pendingPrompt, switches view to chat", async () => {
    const api = fakeApi();
    render(<NewThreadView api={api} />);
    await waitFor(() => expect(api.listProviders).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello world");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(api.createSession).toHaveBeenCalledWith({ workspaceId: "w1", title: "hello world" })
    );
    expect(useAppStore.getState().activeSessionId).toBe("newSession");
    expect(useAppStore.getState().pendingPrompt).toBe("hello world");
    expect(useAppStore.getState().view).toBe("chat");
  });
});
