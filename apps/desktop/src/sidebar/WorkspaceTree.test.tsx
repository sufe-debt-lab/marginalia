import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    useAppStore.setState((s) => ({
      ...s,
      activeWorkspaceId: null,
      activeSessionId: null,
      view: "new-thread",
      locale: "en",
      pendingTurn: null,
      turnDrafts: {},
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: []
    }));
  });

  it("shows recent sessions by default without clicking", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("collapses and re-expands the session list when the workspace row is clicked", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
    await waitFor(() => screen.getByText("first"));
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    expect(screen.getByText("first").closest("[aria-hidden]")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    expect(screen.getByText("first").closest("[aria-hidden]")).toHaveAttribute(
      "aria-hidden",
      "false"
    );
  });

  it("truncates long session lists to five and reveals the rest via Show more", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i + 1}`,
      workspaceId: "w",
      title: `session ${i + 1}`,
      origin: "ui",
      model: null
    }));
    const api = { listSessions: vi.fn(async () => many) } as unknown as ApiClient;
    render(<WorkspaceTree api={api} workspace={workspace} onDelete={async () => {}} />);
    await waitFor(() => screen.getByText("session 1"));
    expect(screen.getByText("session 5")).toBeInTheDocument();
    expect(screen.queryByText("session 6")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(screen.getByText("session 6")).toBeInTheDocument();
    expect(screen.getByText("session 7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show more/i })).toBeNull();
  });

  it("constrains long workspace names to a single truncated row", () => {
    const longWorkspace = {
      ...workspace,
      name: "Electron Acceptance Workspace With A Very Long Name That Should Not Overflow"
    };

    render(<WorkspaceTree api={fakeApi()} workspace={longWorkspace} onDelete={async () => {}} />);

    const label = screen.getByText(longWorkspace.name);
    expect(label).toHaveAttribute("title", longWorkspace.name);
    expect(label).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(label.closest("button")).toHaveClass("min-w-0");
  });

  it("selecting a session updates store", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
    await waitFor(() => screen.getByText("first"));
    await userEvent.click(screen.getByText("first"));
    expect(useAppStore.getState().activeWorkspaceId).toBe("w");
    expect(useAppStore.getState().activeSessionId).toBe("s1");
    expect(useAppStore.getState().view).toBe("chat");
  });

  it("renders a pin icon when pinned", () => {
    useAppStore.setState((s) => ({ ...s, pinnedWorkspaceIds: ["w"] }));
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
    expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument();
  });

  it("right-click + Pin toggles pin state in store", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
    fireEvent.contextMenu(screen.getByText("demo"));
    await userEvent.click(await screen.findByText(/^pin$/i));
    expect(useAppStore.getState().pinnedWorkspaceIds).toContain("w");
  });
});
