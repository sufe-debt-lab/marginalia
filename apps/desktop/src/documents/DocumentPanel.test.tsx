import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    }))
  } as unknown as ApiClient;
}

describe("DocumentPanel", () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({
      ...s,
      activeWorkspaceId: "w1",
      activeSessionId: "s1",
      view: "chat",
      pendingPrompt: null,
      contextFiles: [],
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

  it("attach to chat adds active tab path to context", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    await screen.findByTestId("doc-tree-fallback");
    await userEvent.click(screen.getByRole("button", { name: /open README.md/i }));
    await waitFor(() => screen.getByRole("button", { name: /attach to chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /attach to chat/i }));
    expect(useAppStore.getState().contextFiles).toContain("README.md");
  });
});
