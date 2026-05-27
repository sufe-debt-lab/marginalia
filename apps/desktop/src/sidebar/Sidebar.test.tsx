import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { Sidebar } from "./Sidebar.js";

function fakeApi(): ApiClient {
  return {
    listWorkspaces: vi.fn(async () => [{ id: "w1", name: "alpha", rootDir: "/a" }]),
    createWorkspace: vi.fn(async (input) => ({ id: "new", ...input })),
    deleteWorkspace: vi.fn(async () => {})
  } as unknown as ApiClient;
}

describe("Sidebar", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: []
    });
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      pickWorkspaceDirectory: vi.fn(async () => "/picked/path")
    };
  });

  it("clicking New chat sets view to new-thread", async () => {
    useAppStore.setState({ view: "settings" });
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(useAppStore.getState().view).toBe("new-thread");
  });

  it("clicking Settings sets view to settings", async () => {
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(useAppStore.getState().view).toBe("settings");
  });

  it("lists workspaces from api", async () => {
    render(<Sidebar api={fakeApi()} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
  });

  it("falls back to the first workspace when persisted activeWorkspaceId is missing", async () => {
    useAppStore.setState({ activeWorkspaceId: "deleted" });
    render(<Sidebar api={fakeApi()} />);
    await waitFor(() => expect(useAppStore.getState().activeWorkspaceId).toBe("w1"));
  });

  it("switches language to Chinese", async () => {
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /中文/i }));
    expect(screen.getByRole("button", { name: "新建聊天" })).toBeInTheDocument();
  });

  it("plus button picks a directory and creates a workspace", async () => {
    const api = fakeApi();
    render(<Sidebar api={api} />);
    await waitFor(() => screen.getByText("alpha"));
    await userEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    await waitFor(() => expect(api.createWorkspace).toHaveBeenCalledWith({ name: "path", rootDir: "/picked/path" }));
  });

  it("plus button: when picker cancels, no create call", async () => {
    const api = fakeApi();
    window.marginalia!.pickWorkspaceDirectory = vi.fn(async () => null);
    render(<Sidebar api={api} />);
    await waitFor(() => screen.getByText("alpha"));
    await userEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    expect(api.createWorkspace).not.toHaveBeenCalled();
  });

  it("renders pinned workspaces in a separate group above the rest", async () => {
    useAppStore.setState((s) => ({ ...s, pinnedWorkspaceIds: ["w1"] }));
    const api = {
      listWorkspaces: vi.fn(async () => [
        { id: "w1", name: "alpha", rootDir: "/a" },
        { id: "w2", name: "beta", rootDir: "/b" }
      ]),
      createWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(async () => {})
    } as unknown as ApiClient;
    render(<Sidebar api={api} />);
    await waitFor(() => screen.getByText("alpha"));
    const pinnedHeading = screen.getByText(/^Pinned$/i);
    const beta = screen.getByText("beta");
    // Pinned group (and its items) should render before any non-pinned workspace
    expect(
      pinnedHeading.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
