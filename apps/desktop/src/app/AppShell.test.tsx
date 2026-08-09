import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "new-thread",
      settingsEntryTab: "general",
      settingsEntryRevision: 0,
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingTurn: null,
      turnDrafts: {},
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 238
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
      getPiServerStatus: vi.fn(async () => ({
        status: "ready" as const,
        url: "http://127.0.0.1:4312",
        capabilityToken: "test-token"
      })),
      restartPiServer: vi.fn(async () => ({
        status: "ready" as const,
        url: "http://127.0.0.1:4312",
        capabilityToken: "test-token"
      }))
    };
  });

  it("renders sidebar and main while right panel is hidden outside chat", () => {
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.getByRole("complementary", { name: /sidebar/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /document panel/i })).toBeNull();
  });

  it("shows right panel when view is chat", () => {
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1" });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.getByRole("complementary", { name: /document panel/i })).toBeInTheDocument();
  });

  it("collapses sidebar to zero width but keeps it mounted for the slide animation", () => {
    useAppStore.setState({ leftSidebarCollapsed: true });
    const { container } = render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.queryByRole("complementary", { name: /sidebar/i })).toBeNull();
    const aside = container.querySelector('aside[aria-label="Sidebar"]');
    expect(aside).not.toBeNull();
    expect(aside).toHaveStyle({ width: "0px" });
    expect(aside).toHaveAttribute("aria-hidden", "true");
  });

  it("does not mount sidebar content while collapsed at startup (no eager fetching)", () => {
    useAppStore.setState({ leftSidebarCollapsed: true });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.queryByRole("button", { name: /new chat/i, hidden: true })).toBeNull();
  });

  it("toggle persists to localStorage", async () => {
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle left sidebar/i }));
    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(stored.state?.leftSidebarCollapsed).toBe(true);
  });

  it("uses leftSidebarWidth from store", () => {
    useAppStore.setState({ leftSidebarWidth: 320 });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    const aside = screen.getByRole("complementary", { name: /sidebar/i });
    expect(aside).toHaveStyle({ width: "320px" });
  });

  it("uses rightPanelWidth from store in chat view", () => {
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1", rightPanelWidth: 420 });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    const aside = screen.getByRole("complementary", { name: /document panel/i });
    expect(aside).toHaveStyle({ width: "420px" });
  });

  it("passes only an active workspace resolved from the loaded workspace list to Skills", async () => {
    useAppStore.setState({ view: "settings", activeWorkspaceId: "ws-1" });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/workspaces")) {
        return new Response(JSON.stringify([{ id: "ws-1", name: "Research", rootDir: "/repo" }]), {
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/skills")) {
        return new Response(
          JSON.stringify({
            workspaceId: "ws-1",
            catalogRevision: "catalog-1",
            effectiveRevision: "effective-1",
            refreshedAt: 1,
            candidates: [],
            diagnostics: []
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await userEvent.click(screen.getByRole("tab", { name: /^skills$/i }));

    expect(await screen.findAllByText("Research")).not.toHaveLength(0);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://x/skills?workspaceId=ws-1",
        expect.objectContaining({ headers: expect.any(Object) })
      )
    );
  });

  it("opens the requested Skills settings pane without losing the active session draft", async () => {
    useAppStore.setState({
      view: "settings",
      activeWorkspaceId: "ws-1",
      activeSessionId: "session-1",
      turnDrafts: {
        "session:session-1": {
          text: "keep this draft",
          contextFiles: ["/repo/spec.md"],
          skills: [{ name: "review", path: "/skills/review/SKILL.md" }]
        }
      },
      settingsEntryTab: "skills"
    } as Parameters<typeof useAppStore.setState>[0]);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/workspaces")) {
        return new Response(JSON.stringify([{ id: "ws-1", name: "Research", rootDir: "/repo" }]), {
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/skills")) {
        return new Response(
          JSON.stringify({
            workspaceId: "ws-1",
            catalogRevision: "catalog-1",
            effectiveRevision: "effective-1",
            refreshedAt: 1,
            candidates: [],
            diagnostics: []
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });

    render(<AppShell serverUrl="http://x" capabilityToken="token" />);

    expect(await screen.findByText("Disk Skills")).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://x/skills?workspaceId=ws-1",
        expect.objectContaining({ headers: expect.any(Object) })
      )
    );
    expect(useAppStore.getState().getTurnDraft("session:session-1")).toEqual({
      text: "keep this draft",
      contextFiles: ["/repo/spec.md"],
      skills: [{ name: "review", path: "/skills/review/SKILL.md" }]
    });

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByText("Locale, startup behavior and local storage.")
    ).toBeInTheDocument();
  });

  it("reopens General from the normal Settings entry after an in-view tab change", async () => {
    useAppStore.setState({ view: "settings", settingsEntryTab: "general" });

    render(<AppShell serverUrl="http://x" capabilityToken="token" />);

    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(await screen.findByText("Disk Skills")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByText("Locale, startup behavior and local storage.")
    ).toBeInTheDocument();
  });

  it("falls back to global-only Skills when the active workspace id is stale", async () => {
    useAppStore.setState({
      view: "settings",
      activeWorkspaceId: "stale",
      leftSidebarCollapsed: true
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/workspaces")) {
        return new Response(JSON.stringify([{ id: "ws-1", name: "Research", rootDir: "/repo" }]), {
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/skills")) {
        return new Response(
          JSON.stringify({
            workspaceId: null,
            catalogRevision: "global-1",
            effectiveRevision: "global-effective-1",
            refreshedAt: 1,
            candidates: [],
            diagnostics: []
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await userEvent.click(screen.getByRole("tab", { name: /^skills$/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://x/skills",
        expect.objectContaining({ headers: expect.any(Object) })
      )
    );
  });
});
