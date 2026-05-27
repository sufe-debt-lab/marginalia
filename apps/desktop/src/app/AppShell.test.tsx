import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
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
      rightPanelCollapsed: false
    });
    global.fetch = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn()
    };
  });

  it("renders sidebar and main while right panel is hidden outside chat", () => {
    render(<AppShell serverUrl="http://x" />);
    expect(screen.getByRole("complementary", { name: /sidebar/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /document panel/i })).toBeNull();
  });

  it("shows right panel when view is chat", () => {
    useAppStore.setState({ view: "chat" });
    render(<AppShell serverUrl="http://x" />);
    expect(screen.getByRole("complementary", { name: /document panel/i })).toBeInTheDocument();
  });

  it("hides sidebar when leftSidebarCollapsed", () => {
    useAppStore.setState({ leftSidebarCollapsed: true });
    render(<AppShell serverUrl="http://x" />);
    expect(screen.queryByRole("complementary", { name: /sidebar/i })).toBeNull();
  });

  it("toggle persists to localStorage", async () => {
    render(<AppShell serverUrl="http://x" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle left sidebar/i }));
    const stored = JSON.parse(localStorage.getItem("my-cowork-app") || "{}");
    expect(stored.state?.leftSidebarCollapsed).toBe(true);
  });
});
