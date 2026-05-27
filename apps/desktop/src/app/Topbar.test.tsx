import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { Topbar } from "./Topbar.js";

describe("Topbar", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("renders a title from the active session or workspace name", () => {
    render(<Topbar title="my-workspace" />);
    expect(screen.getByText("my-workspace")).toBeInTheDocument();
  });

  it("toggles left sidebar", async () => {
    render(<Topbar title="" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle left sidebar/i }));
    expect(useAppStore.getState().leftSidebarCollapsed).toBe(true);
  });

  it("toggles right panel only when view is chat", async () => {
    render(<Topbar title="" />);
    expect(screen.queryByRole("button", { name: /toggle right panel/i })).toBeNull();
    useAppStore.setState({ view: "chat" });
    cleanup();
    render(<Topbar title="" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle right panel/i }));
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
  });
});
