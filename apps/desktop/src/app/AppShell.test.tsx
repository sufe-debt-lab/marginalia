import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
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

  it("refreshes the file list on reopen while keeping the current file", async () => {
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1", leftSidebarCollapsed: true });
    const files = [{ path: "notes.md", name: "notes.md", kind: "file" }];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/files")
        ? files
        : url.includes("/files/content")
          ? { path: "notes.md", mime: "text/markdown", text: "# Saved notes", truncated: false }
          : [{ id: "ws-1", name: "Research", rootDir: "/repo" }];
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }
      });
    });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await userEvent.click(await screen.findByRole("button", { name: "Open notes.md" }));
    expect(await screen.findByRole("button", { name: "Attach to chat" })).toBeInTheDocument();
    files.push({ path: "new.md", name: "new.md", kind: "file" });
    await userEvent.click(screen.getByRole("button", { name: /toggle right panel/i }));
    await userEvent.click(screen.getByRole("button", { name: /toggle right panel/i }));
    expect(screen.getByRole("button", { name: "Attach to chat" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open new.md" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved notes" })).toBeInTheDocument();
  });

  it("restores panel width and focus after application fullscreen and Escape", async () => {
    useAppStore.setState({
      view: "chat",
      activeWorkspaceId: "ws-1",
      rightPanelWidth: 420,
      leftSidebarCollapsed: true
    });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    const expand = screen.getByRole("button", { name: "Expand document panel" });
    await userEvent.click(expand);
    const panel = screen.getByRole("dialog", { name: "Document panel" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Restore document panel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Document panel" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document panel" })).toHaveStyle({
      width: "420px"
    });
    expect(expand).toHaveFocus();
  });

  it("includes shadow-root controls in fullscreen focus boundaries", async () => {
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1", leftSidebarCollapsed: true });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await userEvent.click(screen.getByRole("button", { name: "Expand document panel" }));
    const panel = screen.getByRole("dialog", { name: "Document panel" });
    // The file-tree web component renders its tabbable tree item in an open shadow root.
    const tree = document.createElement("div");
    const root = tree.attachShadow({ mode: "open" });
    const item = document.createElement("button");
    item.textContent = "notes.md";
    root.append(item);
    panel.append(tree);
    const filter = screen.getByRole("textbox", { name: /filter/i });
    filter.focus();
    expect(fireEvent.keyDown(filter, { key: "Tab" })).toBe(true);
    expect(filter).toHaveFocus();

    const restore = screen.getByRole("button", { name: "Restore document panel" });
    restore.focus();
    fireEvent.keyDown(restore, { key: "Tab", shiftKey: true });
    expect(root.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: "Tab", composed: true });
    expect(restore).toHaveFocus();
  });

  it("normalizes a previously saved narrow document width when opening", async () => {
    localStorage.setItem(
      "marginalia-app",
      JSON.stringify({ version: 1, state: { rightPanelWidth: 280 } })
    );
    await useAppStore.persist.rehydrate();
    useAppStore.setState({ view: "chat", activeWorkspaceId: "ws-1", leftSidebarCollapsed: true });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.getByRole("complementary", { name: "Document panel" })).toHaveStyle({
      width: "360px"
    });
  });

  it("preserves document width in a narrow window with the widest sidebar", () => {
    useAppStore.setState({
      view: "chat",
      activeWorkspaceId: "ws-1",
      leftSidebarWidth: 480,
      rightPanelWidth: 520
    });
    Object.defineProperty(window, "innerWidth", { value: 960, configurable: true });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    expect(screen.getByRole("complementary", { name: "Document panel" })).toHaveStyle({
      width: "520px"
    });
    const resize = screen
      .getByRole("complementary", { name: "Document panel" })
      .querySelector('[role="separator"]')!;
    fireEvent.pointerDown(resize, { clientX: 555, pointerId: 1 });
    expect(screen.getByRole("complementary", { name: "Document panel" })).toHaveStyle({
      width: "520px"
    });
    fireEvent.pointerUp(resize, { clientX: 555, pointerId: 1 });
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("complementary", { name: "Document panel" })).toHaveStyle({
      width: "520px"
    });
  });

  it("keeps a wide intermediate document width after drag release", async () => {
    global.fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("/workspaces")
              ? [{ id: "ws-1", name: "Research", rootDir: "/repo" }]
              : []
          ),
          { headers: { "content-type": "application/json" } }
        )
    );
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    useAppStore.setState({
      view: "chat",
      activeWorkspaceId: "ws-1",
      leftSidebarWidth: 275,
      rightPanelWidth: 420
    });
    render(<AppShell serverUrl="http://x" capabilityToken="token" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const panel = screen.getByRole("complementary", { name: "Document panel" });
    const handle = panel.querySelector('[role="separator"][aria-orientation="vertical"]')!;
    fireEvent.pointerDown(handle, { clientX: 860, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 380, pointerId: 1 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await waitFor(() => expect(panel).toHaveStyle({ width: "900px" }));
    fireEvent.pointerUp(handle, { clientX: 380, pointerId: 1 });
    expect(panel).toHaveStyle({ width: "900px" });
    expect(useAppStore.getState().rightPanelWidth).toBe(900);
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
