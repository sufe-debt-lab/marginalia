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
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 240
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
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
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1" });
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
    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(stored.state?.leftSidebarCollapsed).toBe(true);
  });

  it("uses leftSidebarWidth from store", () => {
    useAppStore.setState({ leftSidebarWidth: 320 });
    render(<AppShell serverUrl="http://x" />);
    const aside = screen.getByRole("complementary", { name: /sidebar/i });
    expect(aside).toHaveStyle({ width: "320px" });
  });

  it("uses rightPanelWidth from store in chat view", () => {
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1", rightPanelWidth: 420 });
    render(<AppShell serverUrl="http://x" />);
    const aside = screen.getByRole("complementary", { name: /document panel/i });
    expect(aside).toHaveStyle({ width: "420px" });
  });
});
