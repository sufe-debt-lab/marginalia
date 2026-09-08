import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { DocumentPanel } from "./DocumentPanel.js";

afterEach(() => cleanup());

function fakeApi(): ApiClient {
  return {
    listFiles: vi.fn(async () => [
      { path: "README.md", name: "README.md", kind: "file" as const },
      { path: "src/App.tsx", name: "App.tsx", kind: "file" as const }
    ]),
    readDocument: vi.fn(async (_w, p) => ({
      path: p,
      mime: "text/markdown",
      text: "# Hi",
      truncated: false
    })),
    rawDocumentUrl: vi.fn((_w, p) => `http://127.0.0.1:3000/raw/${encodeURIComponent(p)}`)
  } as unknown as ApiClient;
}

describe("DocumentPanel", () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      ...s,
      activeWorkspaceId: "w1",
      activeSessionId: "s1",
      view: "chat",
      pendingTurn: null,
      turnDrafts: {},
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    }));
  });

  it("shows the file tree by default when no tabs are open", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    const fallback = await screen.findByTestId("doc-tree-fallback");
    expect(fallback).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open README.md/i })).toBeInTheDocument();
  });

  it("clicking a file in the tree opens a tab", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    await screen.findByTestId("doc-tree-fallback");
    await userEvent.click(screen.getByRole("button", { name: /open README.md/i }));
    // tab 出现（用 basename "README.md"）
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0));
  });

  it("clicking a folder only expands — never opens a tab", async () => {
    const api = fakeApi();
    render(<DocumentPanel api={api} workspaceId="w1" />);
    await screen.findByTestId("doc-tree-fallback");
    await userEvent.click(screen.getByRole("button", { name: /open src$/i }));
    // No viewer / attach button → folder did not open as a tab
    expect(screen.queryByRole("button", { name: /attach to chat/i })).toBeNull();
    expect(api.readDocument).not.toHaveBeenCalled();
  });

  it("lets the tree/content split width be dragged", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    await screen.findByTestId("doc-tree-fallback");
    await userEvent.click(screen.getByRole("button", { name: /open README.md/i }));
    await waitFor(() => screen.getByRole("button", { name: /attach to chat/i }));

    const separators = screen.getAllByRole("separator");
    const treeResizeHandle = separators[separators.length - 1];
    expect(treeResizeHandle).toBeDefined();
    if (!treeResizeHandle) throw new Error("Tree resize handle not found");
    fireEvent.pointerDown(treeResizeHandle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(treeResizeHandle, { clientX: 160, pointerId: 1 });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    fireEvent.pointerUp(treeResizeHandle, { clientX: 160, pointerId: 1 });

    expect(screen.getByTestId("doc-tree-fallback").parentElement?.parentElement).toHaveStyle({
      width: "300px"
    });
  });

  it("filters the tree by the filter input", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" workspaceName="demo" />);
    await screen.findByTestId("doc-tree-fallback");
    expect(screen.getByRole("button", { name: /open README.md/i })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /filter files/i }), "App");
    expect(screen.queryByRole("button", { name: /open README.md/i })).toBeNull();
    expect(screen.getByRole("button", { name: /open src\/App.tsx/i })).toBeInTheDocument();
  });

  it("shows the workspace breadcrumb in the empty tab bar", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" workspaceName="demo" />);
    await screen.findByTestId("doc-tree-fallback");
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("attach to chat adds active tab path to context", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    await screen.findByTestId("doc-tree-fallback");
    await userEvent.click(screen.getByRole("button", { name: /open README.md/i }));
    await waitFor(() => screen.getByRole("button", { name: /attach to chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /attach to chat/i }));
    expect(useAppStore.getState().getTurnDraft("session:s1").contextFiles).toContain("README.md");
  });
});
