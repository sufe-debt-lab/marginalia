import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { WorkspaceTree } from "./WorkspaceTree.js";

function fakeApi(): ApiClient {
  return {
    listSessions: vi.fn(async () => [
      { id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null },
      { id: "s2", workspaceId: "w", title: "second", origin: "ui", model: null }
    ])
  } as unknown as ApiClient;
}

const workspace: Workspace = { id: "w", name: "demo", rootDir: "/x" };

describe("WorkspaceTree", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activeWorkspaceId: null,
      activeSessionId: null,
      view: "new-thread",
      locale: "en",
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("renders workspace name and expands to show sessions on click", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("selecting a session updates store", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    await waitFor(() => screen.getByText("first"));
    await userEvent.click(screen.getByText("first"));
    expect(useAppStore.getState().activeWorkspaceId).toBe("w");
    expect(useAppStore.getState().activeSessionId).toBe("s1");
    expect(useAppStore.getState().view).toBe("chat");
  });
});
